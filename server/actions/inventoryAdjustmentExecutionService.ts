import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import type {
  KyrubInventoryAdjustmentMode,
  KyrubInventoryAdjustmentSourceKind,
  KyrubInventoryMovementKind,
  KyrubInventoryUnit,
} from '../../shared/kyrubActions.js';
import {
  normalizeExactInventoryItemId,
  type KyrubExactInventoryAdjustmentEntry,
  type KyrubExactInventoryAdjustmentProposal,
} from '../../shared/exactInventoryAdjustment.js';
import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';
import { adminDb } from '../firebaseAdmin.js';
import { KyrubActionExecutionError } from './actionExecutionService.js';

type InventoryItemRecord = {
  id: string;
  name: string;
  unit: KyrubInventoryUnit;
  currentQuantity: number;
  minimumQuantity: number;
  purchaseCost: number;
  supplier: string;
  updatedAt: string;
};

type InventoryMovementLine = {
  itemId: string;
  name: string;
  unit: KyrubInventoryUnit;
  quantityDelta: number;
  previousQuantity: number;
  resultingQuantity: number;
  purchaseCost?: number;
};

type RecentInventoryMovement = {
  id: string;
  kind: KyrubInventoryMovementKind;
  mode: KyrubInventoryAdjustmentMode;
  sourceKind: KyrubInventoryAdjustmentSourceKind;
  sourceLabel: string;
  entryCount: number;
  createdAt: string;
  lines: InventoryMovementLine[];
  linesTruncated: boolean;
};

const MAX_ENTRIES = 60;
const MAX_NAME = 180;
const MAX_RECENT_MOVEMENTS = 20;
const MAX_RECENT_MOVEMENT_LINES = 12;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const cleanText = (value: unknown, maximum: number): string =>
  typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, maximum)
    : '';

const bearerToken = (authorization: string): string =>
  /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim() ?? '';

const normalizeName = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const isUnit = (value: unknown): value is KyrubInventoryUnit =>
  value === 'un' || value === 'kg' || value === 'g' || value === 'l' || value === 'ml';

const isMode = (value: unknown): value is KyrubInventoryAdjustmentMode =>
  value === 'increment' || value === 'decrement' || value === 'set';

const isMovementKind = (value: unknown): value is KyrubInventoryMovementKind =>
  value === 'intake' || value === 'outflow' || value === 'loss' || value === 'correction';

const normalizeSourceKind = (
  value: unknown,
  mode: KyrubInventoryAdjustmentMode
): KyrubInventoryAdjustmentSourceKind => {
  if (
    value === 'supplier_invoice' ||
    value === 'inventory_intake_text' ||
    value === 'manual_outflow' ||
    value === 'loss_report' ||
    value === 'physical_count'
  ) return value;
  if (mode === 'set') return 'physical_count';
  if (mode === 'decrement') return 'manual_outflow';
  return 'inventory_intake_text';
};

const movementKindFor = (
  mode: KyrubInventoryAdjustmentMode,
  sourceKind: KyrubInventoryAdjustmentSourceKind
): KyrubInventoryMovementKind => {
  if (mode === 'set') return 'correction';
  if (mode === 'decrement') {
    return sourceKind === 'loss_report' ? 'loss' : 'outflow';
  }
  return 'intake';
};

const normalizeEntry = (
  value: unknown,
  mode: KyrubInventoryAdjustmentMode
): KyrubExactInventoryAdjustmentEntry => {
  if (!isRecord(value)) {
    throw new KyrubActionExecutionError(
      400,
      'INVALID_INVENTORY_ENTRY',
      'Um dos itens da movimentação de estoque é inválido.'
    );
  }
  const name = cleanText(value.name, MAX_NAME);
  const quantity = typeof value.quantity === 'number' && Number.isFinite(value.quantity)
    ? value.quantity
    : Number.NaN;
  const unit = value.unit;
  const purchaseCost = typeof value.purchaseCost === 'number' && Number.isFinite(value.purchaseCost)
    ? Math.max(0, value.purchaseCost)
    : undefined;
  const quantityValid = mode === 'set' ? quantity >= 0 : quantity > 0;
  const hasInventoryItemId = value.inventoryItemId !== undefined && value.inventoryItemId !== null;
  const inventoryItemId = normalizeExactInventoryItemId(value.inventoryItemId);

  if (hasInventoryItemId && !inventoryItemId) {
    throw new KyrubActionExecutionError(
      400,
      'INVALID_INVENTORY_ITEM_ID',
      'O identificador canônico do item de estoque é inválido.'
    );
  }

  if (!name || !quantityValid || !isUnit(unit)) {
    throw new KyrubActionExecutionError(
      400,
      'INVALID_INVENTORY_ENTRY',
      mode === 'set'
        ? 'Revise nome, saldo contado e unidade antes de confirmar a correção.'
        : 'Revise nome, quantidade e unidade antes de confirmar a movimentação.'
    );
  }

  return {
    ...(inventoryItemId ? { inventoryItemId } : {}),
    name,
    quantity,
    unit,
    ...(mode === 'increment' && purchaseCost !== undefined ? { purchaseCost } : {}),
  };
};

const normalizeProposal = (value: unknown): KyrubExactInventoryAdjustmentProposal => {
  if (!isRecord(value) || value.type !== 'adjust_inventory') {
    throw new KyrubActionExecutionError(
      400,
      'UNSUPPORTED_ACTION',
      'Esta solicitação não é uma movimentação de estoque válida.'
    );
  }
  const id = cleanText(value.id, 120);
  const mode = value.mode;
  if (!id || !isMode(mode) || value.requiresConfirmation !== true) {
    throw new KyrubActionExecutionError(
      400,
      'INVALID_ACTION',
      'A movimentação de estoque precisa ser revisada antes da confirmação.'
    );
  }
  const entries = Array.isArray(value.entries)
    ? value.entries.slice(0, MAX_ENTRIES).map(entry => normalizeEntry(entry, mode))
    : [];
  if (entries.length === 0) {
    throw new KyrubActionExecutionError(
      400,
      'INVALID_ACTION',
      'Inclua pelo menos um insumo válido antes de confirmar a movimentação.'
    );
  }

  const source = isRecord(value.source) ? value.source : {};
  const sourceKind = normalizeSourceKind(source.kind, mode);
  const movementKind = movementKindFor(mode, sourceKind);
  const label = cleanText(source.label, 180);
  const inputProvenance = sourceKind === 'supplier_invoice'
    ? 'document_content' as const
    : 'user_intent' as const;

  return {
    id,
    type: 'adjust_inventory',
    mode,
    movementKind,
    entries,
    source: { kind: sourceKind, ...(label ? { label } : {}) },
    requiresConfirmation: true,
    origin: 'kyrubia',
    risk: 'medium',
    inputProvenance,
    impact: { entityCount: entries.length, reversibility: 'limited' },
  };
};

const normalizeInventoryItem = (value: unknown): InventoryItemRecord | null => {
  if (!isRecord(value)) return null;
  const id = cleanText(value.id, 180);
  const name = cleanText(value.name, MAX_NAME);
  const unit = value.unit;
  const currentQuantity = typeof value.currentQuantity === 'number' && Number.isFinite(value.currentQuantity)
    ? Math.max(0, value.currentQuantity)
    : null;
  const minimumQuantity = typeof value.minimumQuantity === 'number' && Number.isFinite(value.minimumQuantity)
    ? Math.max(0, value.minimumQuantity)
    : null;
  if (!id || !name || !isUnit(unit) || currentQuantity === null || minimumQuantity === null) {
    return null;
  }
  return {
    id,
    name,
    unit,
    currentQuantity,
    minimumQuantity,
    purchaseCost: typeof value.purchaseCost === 'number' && Number.isFinite(value.purchaseCost)
      ? Math.max(0, value.purchaseCost)
      : 0,
    supplier: cleanText(value.supplier, 160),
    updatedAt: cleanText(value.updatedAt, 80),
  };
};

const normalizeMovementLine = (value: unknown): InventoryMovementLine | null => {
  if (!isRecord(value)) return null;
  const itemId = cleanText(value.itemId, 180);
  const name = cleanText(value.name, MAX_NAME);
  const unit = value.unit;
  const quantityDelta = typeof value.quantityDelta === 'number' && Number.isFinite(value.quantityDelta)
    ? value.quantityDelta
    : null;
  const previousQuantity = typeof value.previousQuantity === 'number' && Number.isFinite(value.previousQuantity)
    ? Math.max(0, value.previousQuantity)
    : null;
  const resultingQuantity = typeof value.resultingQuantity === 'number' && Number.isFinite(value.resultingQuantity)
    ? Math.max(0, value.resultingQuantity)
    : null;
  if (
    !itemId || !name || !isUnit(unit) || quantityDelta === null ||
    previousQuantity === null || resultingQuantity === null
  ) return null;
  return {
    itemId,
    name,
    unit,
    quantityDelta,
    previousQuantity,
    resultingQuantity,
  };
};

const normalizeRecentMovement = (value: unknown): RecentInventoryMovement | null => {
  if (!isRecord(value)) return null;
  const id = cleanText(value.id, 180);
  const kind = value.kind;
  const mode = value.mode;
  const sourceKind = value.sourceKind;
  const createdAt = cleanText(value.createdAt, 80);
  if (!id || !isMovementKind(kind) || !isMode(mode) || !createdAt) return null;
  const normalizedSourceKind = normalizeSourceKind(sourceKind, mode);
  const lines = Array.isArray(value.lines)
    ? value.lines
        .map(normalizeMovementLine)
        .filter((line): line is InventoryMovementLine => Boolean(line))
        .slice(0, MAX_RECENT_MOVEMENT_LINES)
    : [];
  return {
    id,
    kind,
    mode,
    sourceKind: normalizedSourceKind,
    sourceLabel: cleanText(value.sourceLabel, 180),
    entryCount: typeof value.entryCount === 'number' && Number.isFinite(value.entryCount)
      ? Math.max(0, Math.trunc(value.entryCount))
      : lines.length,
    createdAt,
    lines,
    linesTruncated: value.linesTruncated === true,
  };
};

const deterministicItemId = (uid: string, entry: KyrubExactInventoryAdjustmentEntry): string =>
  `inv-${createHash('sha256')
    .update(`${uid}:${normalizeName(entry.name)}:${entry.unit}`)
    .digest('hex')
    .slice(0, 24)}`;

const receiptIdFor = (uid: string, proposalId: string): string =>
  `inventory-${createHash('sha256')
    .update(`${uid}:${proposalId}`)
    .digest('hex')
    .slice(0, 40)}`;

const movementIdFor = (
  uid: string,
  proposalId: string,
  movementKind: KyrubInventoryMovementKind
): string =>
  `movement-${createHash('sha256')
    .update(`${uid}:${proposalId}:${movementKind}`)
    .digest('hex')
    .slice(0, 40)}`;

const resultingQuantityFor = (
  mode: KyrubInventoryAdjustmentMode,
  currentQuantity: number,
  requestedQuantity: number,
  name: string
): number => {
  if (mode === 'increment') return currentQuantity + requestedQuantity;
  if (mode === 'set') return requestedQuantity;
  if (requestedQuantity > currentQuantity) {
    throw new KyrubActionExecutionError(
      409,
      'INSUFFICIENT_INVENTORY',
      `Não há saldo suficiente de ${name} para essa saída. Estoque atual: ${currentQuantity}.`
    );
  }
  return currentQuantity - requestedQuantity;
};

export const isKyrubInventoryAdjustmentExecutionRequest = (value: unknown): boolean => {
  if (!isRecord(value) || value.confirmed !== true || !isRecord(value.proposal)) return false;
  return value.proposal.type === 'adjust_inventory';
};

export const executeAuthorizedKyrubInventoryAdjustment = async (
  authorization: string,
  rawRequest: unknown
) => {
  const token = bearerToken(authorization);
  if (!token) {
    throw new KyrubActionExecutionError(
      401,
      'AUTH_REQUIRED',
      'Faça login novamente antes de confirmar a movimentação de estoque.'
    );
  }
  const actor = await verifyFirebaseIdToken(token);
  if (!isRecord(rawRequest) || rawRequest.confirmed !== true) {
    throw new KyrubActionExecutionError(
      409,
      'CONFIRMATION_REQUIRED',
      'Revise e confirme a movimentação antes de alterar o estoque.'
    );
  }

  const proposal = normalizeProposal(rawRequest.proposal);
  const movementKind = proposal.movementKind ?? movementKindFor(proposal.mode, proposal.source.kind);
  const inventoryRef = adminDb.doc(`users/${actor.uid}/private_store/inventory`);
  const receiptId = receiptIdFor(actor.uid, proposal.id);
  const receiptRef = adminDb.doc(`kyrub_action_receipts/${receiptId}`);
  const movementId = movementIdFor(actor.uid, proposal.id, movementKind);
  const movementRef = inventoryRef.collection('movements').doc(movementId);

  const status = await adminDb.runTransaction(async transaction => {
    const [inventorySnapshot, receiptSnapshot] = await Promise.all([
      transaction.get(inventoryRef),
      transaction.get(receiptRef),
    ]);

    if (receiptSnapshot.exists) return 'already_applied' as const;

    const current = inventorySnapshot.data() as Record<string, unknown> | undefined;
    const rawCatalog = Array.isArray(current?.inventoryCatalog)
      ? current.inventoryCatalog
      : Array.isArray(current?.catalog)
        ? current.catalog
        : [];
    const catalog = (rawCatalog as unknown[])
      .map(normalizeInventoryItem)
      .filter((item): item is InventoryItemRecord => Boolean(item));
    const recentMovements = Array.isArray(current?.recentInventoryMovements)
      ? current.recentInventoryMovements
          .map(normalizeRecentMovement)
          .filter((movement): movement is RecentInventoryMovement => Boolean(movement))
      : [];
    const now = new Date().toISOString();
    const movementLines: InventoryMovementLine[] = [];

    for (const entry of proposal.entries) {
      const exactInventoryItemId = entry.inventoryItemId ?? '';
      const key = `${normalizeName(entry.name)}::${entry.unit}`;
      const existingIndex = exactInventoryItemId
        ? catalog.findIndex(item => item.id === exactInventoryItemId)
        : catalog.findIndex(item => `${normalizeName(item.name)}::${item.unit}` === key);

      if (exactInventoryItemId && existingIndex < 0) {
        throw new KyrubActionExecutionError(
          409,
          'INVENTORY_ITEM_ID_NOT_FOUND',
          `O item canônico ${exactInventoryItemId} não está disponível no estoque privado. Nenhum item será escolhido por nome.`
        );
      }

      if (existingIndex < 0) {
        if (proposal.mode !== 'increment') {
          throw new KyrubActionExecutionError(
            409,
            'INVENTORY_ITEM_NOT_FOUND',
            `${entry.name} não está cadastrado no estoque privado para essa movimentação.`
          );
        }
        const itemId = deterministicItemId(actor.uid, entry);
        catalog.push({
          id: itemId,
          name: entry.name,
          unit: entry.unit,
          currentQuantity: entry.quantity,
          minimumQuantity: 0,
          purchaseCost: entry.purchaseCost ?? 0,
          supplier: proposal.source.label ?? '',
          updatedAt: now,
        });
        movementLines.push({
          itemId,
          name: entry.name,
          unit: entry.unit,
          quantityDelta: entry.quantity,
          previousQuantity: 0,
          resultingQuantity: entry.quantity,
          ...(entry.purchaseCost !== undefined ? { purchaseCost: entry.purchaseCost } : {}),
        });
        continue;
      }

      const existing = catalog[existingIndex];
      if (
        exactInventoryItemId &&
        (normalizeName(existing.name) !== normalizeName(entry.name) || existing.unit !== entry.unit)
      ) {
        throw new KyrubActionExecutionError(
          409,
          'INVENTORY_ITEM_IDENTITY_MISMATCH',
          `O item canônico ${exactInventoryItemId} não corresponde ao nome/unidade revisados. Atualize a leitura do estoque antes de confirmar.`
        );
      }

      const resultingQuantity = resultingQuantityFor(
        proposal.mode,
        existing.currentQuantity,
        entry.quantity,
        existing.name
      );
      const quantityDelta = resultingQuantity - existing.currentQuantity;
      catalog[existingIndex] = {
        ...existing,
        currentQuantity: resultingQuantity,
        ...(proposal.mode === 'increment' && entry.purchaseCost !== undefined
          ? { purchaseCost: entry.purchaseCost }
          : {}),
        ...(proposal.mode === 'increment' && proposal.source.label && !existing.supplier
          ? { supplier: proposal.source.label }
          : {}),
        updatedAt: now,
      };
      movementLines.push({
        itemId: existing.id,
        name: existing.name,
        unit: existing.unit,
        quantityDelta,
        previousQuantity: existing.currentQuantity,
        resultingQuantity,
        ...(proposal.mode === 'increment' && entry.purchaseCost !== undefined
          ? { purchaseCost: entry.purchaseCost }
          : {}),
      });
    }

    const recentMovement: RecentInventoryMovement = {
      id: movementId,
      kind: movementKind,
      mode: proposal.mode,
      sourceKind: proposal.source.kind,
      sourceLabel: proposal.source.label ?? '',
      entryCount: movementLines.length,
      createdAt: now,
      lines: movementLines.slice(0, MAX_RECENT_MOVEMENT_LINES),
      linesTruncated: movementLines.length > MAX_RECENT_MOVEMENT_LINES,
    };
    const nextRecentMovements = [
      recentMovement,
      ...recentMovements.filter(movement => movement.id !== movementId),
    ].slice(0, MAX_RECENT_MOVEMENTS);

    const lastMovement = {
      id: proposal.id,
      movementId,
      kind: movementKind,
      sourceKind: proposal.source.kind,
      sourceLabel: proposal.source.label ?? '',
      entryCount: proposal.entries.length,
      confirmedAt: FieldValue.serverTimestamp(),
    };
    const inventoryPatch: Record<string, unknown> = {
      ownerId: actor.uid,
      inventoryCatalog: catalog,
      catalog,
      recentInventoryMovements: nextRecentMovements,
      recentInventoryMovementCount: nextRecentMovements.length,
      updatedAt: FieldValue.serverTimestamp(),
      lastInventoryMovement: lastMovement,
    };
    if (movementKind === 'intake') {
      inventoryPatch.lastInventoryIntake = lastMovement;
    }

    transaction.set(inventoryRef, inventoryPatch, { merge: true });

    transaction.set(movementRef, {
      schemaVersion: 1,
      id: movementId,
      ownerId: actor.uid,
      proposalId: proposal.id,
      actionType: 'adjust_inventory',
      mode: proposal.mode,
      kind: movementKind,
      reason: proposal.source.kind,
      sourceLabel: proposal.source.label ?? '',
      origin: 'kyrubia',
      lines: movementLines,
      entryCount: movementLines.length,
      createdAt: FieldValue.serverTimestamp(),
    });

    transaction.set(receiptRef, {
      schemaVersion: 1,
      executionId: receiptId,
      actionId: proposal.id,
      actionType: 'adjust_inventory',
      actorUid: actor.uid,
      origin: 'kyrubia',
      inputProvenance: proposal.inputProvenance ?? 'user_intent',
      targetType: 'inventory',
      targetId: actor.uid,
      movementId,
      movementKind,
      result: 'success',
      createdAt: FieldValue.serverTimestamp(),
    });
    return 'success' as const;
  });

  return {
    actionId: proposal.id,
    type: proposal.type,
    status,
    entityId: actor.uid,
    origin: 'kyrubia' as const,
    idempotencyKey: `kyrubia:adjust_inventory:${actor.uid}:${proposal.id}`,
  };
};