import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import type {
  KyrubAiAdjustInventoryProposal,
  KyrubInventoryAdjustmentEntry,
  KyrubInventoryUnit,
} from '../../shared/kyrubActions.js';
import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';
import { adminDb } from '../firebaseAdmin.js';
import { KyrubActionExecutionError } from './actionExecutionService.js';

type InventoryItemRecord = {
  id: string;
  name: string;
  sku: string;
  unit: KyrubInventoryUnit;
  quantity: number;
  minimumQuantity: number;
  purchaseCost: number;
};

const MAX_ENTRIES = 60;
const MAX_NAME = 180;

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

const normalizeEntry = (value: unknown): KyrubInventoryAdjustmentEntry => {
  if (!isRecord(value)) {
    throw new KyrubActionExecutionError(400, 'INVALID_INVENTORY_ENTRY', 'Um dos itens da entrada de estoque é inválido.');
  }
  const name = cleanText(value.name, MAX_NAME);
  const quantity = typeof value.quantity === 'number' && Number.isFinite(value.quantity)
    ? value.quantity
    : 0;
  const unit = value.unit;
  const purchaseCost = typeof value.purchaseCost === 'number' && Number.isFinite(value.purchaseCost)
    ? Math.max(0, value.purchaseCost)
    : undefined;

  if (!name || quantity <= 0 || !isUnit(unit)) {
    throw new KyrubActionExecutionError(400, 'INVALID_INVENTORY_ENTRY', 'Revise nome, quantidade e unidade dos itens antes de confirmar.');
  }
  return { name, quantity, unit, ...(purchaseCost !== undefined ? { purchaseCost } : {}) };
};

const normalizeProposal = (value: unknown): KyrubAiAdjustInventoryProposal => {
  if (!isRecord(value) || value.type !== 'adjust_inventory') {
    throw new KyrubActionExecutionError(400, 'UNSUPPORTED_ACTION', 'Esta solicitação não é uma entrada de estoque válida.');
  }
  const id = cleanText(value.id, 120);
  const entries = Array.isArray(value.entries)
    ? value.entries.slice(0, MAX_ENTRIES).map(normalizeEntry)
    : [];
  if (!id || value.mode !== 'increment' || entries.length === 0 || value.requiresConfirmation !== true) {
    throw new KyrubActionExecutionError(400, 'INVALID_ACTION', 'A entrada de estoque precisa ser revisada antes da confirmação.');
  }
  const source = isRecord(value.source) ? value.source : {};
  const kind = source.kind === 'supplier_invoice'
    ? 'supplier_invoice'
    : 'inventory_intake_text';
  const label = cleanText(source.label, 180);

  return {
    id,
    type: 'adjust_inventory',
    mode: 'increment',
    entries,
    source: { kind, ...(label ? { label } : {}) },
    requiresConfirmation: true,
    origin: 'kyrubia',
    risk: 'medium',
    inputProvenance: 'document_content',
    impact: { entityCount: entries.length, reversibility: 'limited' },
  };
};

const normalizeInventoryItem = (value: unknown): InventoryItemRecord | null => {
  if (!isRecord(value)) return null;
  const id = cleanText(value.id, 180);
  const name = cleanText(value.name, MAX_NAME);
  const unit = value.unit;
  if (!id || !name || !isUnit(unit)) return null;
  return {
    id,
    name,
    sku: cleanText(value.sku, 120),
    unit,
    quantity: typeof value.quantity === 'number' && Number.isFinite(value.quantity)
      ? Math.max(0, value.quantity)
      : 0,
    minimumQuantity: typeof value.minimumQuantity === 'number' && Number.isFinite(value.minimumQuantity)
      ? Math.max(0, value.minimumQuantity)
      : 0,
    purchaseCost: typeof value.purchaseCost === 'number' && Number.isFinite(value.purchaseCost)
      ? Math.max(0, value.purchaseCost)
      : 0,
  };
};

const deterministicItemId = (uid: string, entry: KyrubInventoryAdjustmentEntry): string =>
  `inv-${createHash('sha256')
    .update(`${uid}:${normalizeName(entry.name)}:${entry.unit}`)
    .digest('hex')
    .slice(0, 24)}`;

const receiptIdFor = (uid: string, proposalId: string): string =>
  `inventory-${createHash('sha256')
    .update(`${uid}:${proposalId}`)
    .digest('hex')
    .slice(0, 40)}`;

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
    throw new KyrubActionExecutionError(401, 'AUTH_REQUIRED', 'Faça login novamente antes de confirmar a entrada de estoque.');
  }
  const actor = await verifyFirebaseIdToken(token);
  if (!isRecord(rawRequest) || rawRequest.confirmed !== true) {
    throw new KyrubActionExecutionError(409, 'CONFIRMATION_REQUIRED', 'Revise e confirme a entrada antes de alterar o estoque.');
  }

  const proposal = normalizeProposal(rawRequest.proposal);
  const inventoryRef = adminDb.doc(`users/${actor.uid}/private_store/inventory`);
  const receiptId = receiptIdFor(actor.uid, proposal.id);
  const receiptRef = adminDb.doc(`kyrub_action_receipts/${receiptId}`);

  const status = await adminDb.runTransaction(async transaction => {
    const [inventorySnapshot, receiptSnapshot] = await Promise.all([
      transaction.get(inventoryRef),
      transaction.get(receiptRef),
    ]);

    if (receiptSnapshot.exists) return 'already_applied' as const;

    const current = inventorySnapshot.data() as Record<string, unknown> | undefined;
    const rawCatalog = Array.isArray(current?.inventoryCatalog)
      ? current?.inventoryCatalog
      : Array.isArray(current?.catalog)
        ? current?.catalog
        : [];
    const catalog = (rawCatalog as unknown[])
      .map(normalizeInventoryItem)
      .filter((item): item is InventoryItemRecord => Boolean(item));

    for (const entry of proposal.entries) {
      const key = `${normalizeName(entry.name)}::${entry.unit}`;
      const existingIndex = catalog.findIndex(item =>
        `${normalizeName(item.name)}::${item.unit}` === key
      );
      if (existingIndex >= 0) {
        const existing = catalog[existingIndex];
        catalog[existingIndex] = {
          ...existing,
          quantity: existing.quantity + entry.quantity,
          ...(entry.purchaseCost !== undefined ? { purchaseCost: entry.purchaseCost } : {}),
        };
      } else {
        catalog.push({
          id: deterministicItemId(actor.uid, entry),
          name: entry.name,
          sku: '',
          unit: entry.unit,
          quantity: entry.quantity,
          minimumQuantity: 0,
          purchaseCost: entry.purchaseCost ?? 0,
        });
      }
    }

    transaction.set(inventoryRef, {
      inventoryCatalog: catalog,
      catalog,
      updatedAt: FieldValue.serverTimestamp(),
      lastInventoryIntake: {
        id: proposal.id,
        sourceKind: proposal.source.kind,
        sourceLabel: proposal.source.label ?? '',
        entryCount: proposal.entries.length,
        confirmedAt: FieldValue.serverTimestamp(),
      },
    }, { merge: true });

    transaction.set(receiptRef, {
      schemaVersion: 1,
      executionId: receiptId,
      actionId: proposal.id,
      actionType: 'adjust_inventory',
      actorUid: actor.uid,
      origin: 'kyrubia',
      inputProvenance: 'document_content',
      targetType: 'inventory',
      targetId: actor.uid,
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
