import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import type {
  KyrubAiSetProductCompositionProposal,
  KyrubInventoryUnit,
  KyrubProductCompositionKind,
  KyrubProductCompositionLine,
} from '../../shared/kyrubActions.js';
import {
  calculateCompositionAvailableStock,
  parseInventoryCatalogRecords,
  parseInventoryCompositionRecords,
} from '../../shared/inventoryConsumption.js';
import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';
import { adminDb } from '../firebaseAdmin.js';
import { KyrubActionExecutionError } from './actionExecutionService.js';

type ProductRecord = {
  id: string;
  name: string;
  isService: boolean;
};

const MAX_LINES = 40;
const MAX_TEXT = 180;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const cleanText = (value: unknown, maximum = MAX_TEXT): string =>
  typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, maximum)
    : '';

const bearerToken = (authorization: string): string =>
  /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim() ?? '';

const isInventoryUnit = (value: unknown): value is KyrubInventoryUnit =>
  value === 'un' || value === 'kg' || value === 'g' || value === 'l' || value === 'ml';

const isCompositionKind = (value: unknown): value is KyrubProductCompositionKind =>
  value === 'recipe' || value === 'bundle';

const normalizeLine = (value: unknown): KyrubProductCompositionLine => {
  if (!isRecord(value)) {
    throw new KyrubActionExecutionError(400, 'INVALID_COMPOSITION_LINE', 'Um componente da ficha técnica é inválido.');
  }
  const inventoryItemId = cleanText(value.inventoryItemId, 128);
  const inventoryItemName = cleanText(value.inventoryItemName);
  const quantity = typeof value.quantity === 'number' && Number.isFinite(value.quantity)
    ? value.quantity
    : 0;
  const unit = value.unit;
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(inventoryItemId) || !inventoryItemName || quantity <= 0 || !isInventoryUnit(unit)) {
    throw new KyrubActionExecutionError(400, 'INVALID_COMPOSITION_LINE', 'Revise insumo, quantidade e unidade da ficha técnica.');
  }
  return { inventoryItemId, inventoryItemName, quantity, unit };
};

const normalizeProposal = (value: unknown): KyrubAiSetProductCompositionProposal => {
  if (!isRecord(value) || value.type !== 'set_product_composition') {
    throw new KyrubActionExecutionError(400, 'UNSUPPORTED_ACTION', 'Esta solicitação não é uma ficha técnica válida.');
  }
  const id = cleanText(value.id, 120);
  const productId = cleanText(value.productId, 128);
  const productName = cleanText(value.productName);
  const kind = value.kind;
  const yieldQuantity = typeof value.yieldQuantity === 'number' && Number.isFinite(value.yieldQuantity)
    ? value.yieldQuantity
    : 0;
  const lines = Array.isArray(value.lines)
    ? value.lines.slice(0, MAX_LINES).map(normalizeLine)
    : [];
  const uniqueIds = new Set(lines.map(line => line.inventoryItemId));

  if (
    !id ||
    !/^[a-zA-Z0-9_-]{1,128}$/.test(productId) ||
    !productName ||
    !isCompositionKind(kind) ||
    yieldQuantity <= 0 ||
    lines.length === 0 ||
    uniqueIds.size !== lines.length ||
    value.requiresConfirmation !== true
  ) {
    throw new KyrubActionExecutionError(400, 'INVALID_ACTION', 'A ficha técnica precisa ser revisada antes da confirmação.');
  }

  return {
    id,
    type: 'set_product_composition',
    productId,
    productName,
    kind,
    yieldQuantity,
    lines,
    requiresConfirmation: true,
    origin: 'kyrubia',
    risk: 'medium',
    inputProvenance: 'user_intent',
    impact: { entityCount: lines.length, reversibility: 'limited' },
  };
};

const normalizeProducts = (value: unknown): ProductRecord[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap(candidate => {
    if (!isRecord(candidate)) return [];
    const id = cleanText(candidate.id, 128);
    const name = cleanText(candidate.name);
    if (!id || !name) return [];
    return [{ id, name, isService: candidate.isService === true }];
  });
};

const receiptIdFor = (uid: string, proposalId: string): string =>
  `composition-${createHash('sha256').update(`${uid}:${proposalId}`).digest('hex').slice(0, 40)}`;

export const isKyrubProductCompositionExecutionRequest = (value: unknown): boolean =>
  isRecord(value) && value.confirmed === true && isRecord(value.proposal) && value.proposal.type === 'set_product_composition';

export const executeAuthorizedKyrubProductComposition = async (
  authorization: string,
  rawRequest: unknown
) => {
  const token = bearerToken(authorization);
  if (!token) {
    throw new KyrubActionExecutionError(401, 'AUTH_REQUIRED', 'Faça login novamente antes de confirmar a ficha técnica.');
  }
  const actor = await verifyFirebaseIdToken(token);
  if (!isRecord(rawRequest) || rawRequest.confirmed !== true) {
    throw new KyrubActionExecutionError(409, 'CONFIRMATION_REQUIRED', 'Revise e confirme a ficha técnica antes de gravá-la.');
  }

  const proposal = normalizeProposal(rawRequest.proposal);
  const tenantRef = adminDb.doc(`tenants/${actor.uid}`);
  const inventoryRef = adminDb.doc(`users/${actor.uid}/private_store/inventory`);
  const receiptId = receiptIdFor(actor.uid, proposal.id);
  const receiptRef = adminDb.doc(`kyrub_action_receipts/${receiptId}`);

  const result = await adminDb.runTransaction(async transaction => {
    const [tenantSnapshot, inventorySnapshot, receiptSnapshot] = await Promise.all([
      transaction.get(tenantRef),
      transaction.get(inventoryRef),
      transaction.get(receiptRef),
    ]);

    if (receiptSnapshot.exists) {
      return { status: 'already_applied' as const, availableStock: null };
    }

    const tenantData = tenantSnapshot.data() as Record<string, unknown> | undefined;
    const products = normalizeProducts(tenantData?.publicProducts);
    const product = products.find(item => item.id === proposal.productId);
    if (!product) {
      throw new KyrubActionExecutionError(409, 'PRODUCT_NOT_FOUND', 'O produto selecionado não existe mais no catálogo da sua loja.');
    }
    if (product.isService) {
      throw new KyrubActionExecutionError(409, 'SERVICE_COMPOSITION_NOT_ALLOWED', 'Serviços não usam ficha técnica de consumo de estoque neste fluxo.');
    }
    if (product.name.trim().toLocaleLowerCase('pt-BR') !== proposal.productName.trim().toLocaleLowerCase('pt-BR')) {
      throw new KyrubActionExecutionError(409, 'PRODUCT_CHANGED', 'O produto foi alterado desde a proposta. Revise a ficha técnica novamente.');
    }

    const inventoryData = inventorySnapshot.data() as Record<string, unknown> | undefined;
    const catalog = parseInventoryCatalogRecords(
      Array.isArray(inventoryData?.inventoryCatalog)
        ? inventoryData?.inventoryCatalog
        : inventoryData?.catalog
    );
    const catalogById = new Map(catalog.map(item => [item.id, item]));

    for (const line of proposal.lines) {
      const item = catalogById.get(line.inventoryItemId);
      if (!item) {
        throw new KyrubActionExecutionError(409, 'INVENTORY_ITEM_NOT_FOUND', `${line.inventoryItemName} não existe mais no estoque privado.`);
      }
      if (item.unit !== line.unit || item.name.trim().toLocaleLowerCase('pt-BR') !== line.inventoryItemName.trim().toLocaleLowerCase('pt-BR')) {
        throw new KyrubActionExecutionError(409, 'INVENTORY_ITEM_CHANGED', `${line.inventoryItemName} foi alterado desde a proposta. Revise a ficha técnica novamente.`);
      }
    }

    const currentCompositions = parseInventoryCompositionRecords(
      inventoryData?.compositions ?? inventoryData?.productCompositions
    );
    const now = new Date().toISOString();
    const composition = {
      kind: proposal.kind,
      yieldQuantity: proposal.yieldQuantity,
      lines: proposal.lines.map(line => ({
        inventoryItemId: line.inventoryItemId,
        quantity: line.quantity,
      })),
      updatedAt: now,
    };
    const nextCompositions = {
      ...currentCompositions,
      [proposal.productId]: composition,
    };
    const availableStock = calculateCompositionAvailableStock(
      composition,
      catalog
    );

    transaction.set(inventoryRef, {
      ownerId: actor.uid,
      compositions: nextCompositions,
      updatedAt: FieldValue.serverTimestamp(),
      lastCompositionUpdate: {
        actionId: proposal.id,
        productId: proposal.productId,
        productName: product.name,
        lineCount: proposal.lines.length,
        yieldQuantity: proposal.yieldQuantity,
        availableStock,
        confirmedAt: FieldValue.serverTimestamp(),
      },
    }, { merge: true });

    transaction.set(receiptRef, {
      schemaVersion: 1,
      executionId: receiptId,
      actionId: proposal.id,
      actionType: 'set_product_composition',
      actorUid: actor.uid,
      origin: 'kyrubia',
      inputProvenance: 'user_intent',
      targetType: 'product_composition',
      targetId: proposal.productId,
      result: 'success',
      createdAt: FieldValue.serverTimestamp(),
    });

    return { status: 'success' as const, availableStock };
  });

  return {
    actionId: proposal.id,
    type: proposal.type,
    status: result.status,
    entityId: proposal.productId,
    origin: 'kyrubia' as const,
    idempotencyKey: `kyrubia:set_product_composition:${actor.uid}:${proposal.id}`,
    availableStock: result.availableStock,
  };
};
