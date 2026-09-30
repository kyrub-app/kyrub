import { adminDb } from '../firebaseAdmin.js';
import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';
import { inventoryDocumentPathForOwner } from './canonicalInventoryAuthorityService.js';

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const bearerToken = (authorization: string): string =>
  /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim() ?? '';

const requiredId = (value: unknown, code: string): string => {
  const id = clean(value);
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw new Error(code);
  return id;
};

const requireCanonicalStoreOwner = async (
  authorization: string,
  storeIdValue: unknown
): Promise<{ storeId: string; ownerUserId: string }> => {
  const token = bearerToken(authorization);
  if (!token) throw new Error('AUTH_REQUIRED');
  const identity = await verifyFirebaseIdToken(token);
  const storeId = requiredId(storeIdValue, 'STORE_INVENTORY_MOVEMENTS_STORE_REQUIRED');
  const memberSnapshot = await adminDb
    .doc(`stores/${storeId}/members/${identity.uid}`)
    .get();
  const member = memberSnapshot.data();
  if (
    !memberSnapshot.exists
    || clean(member?.userId) !== identity.uid
    || member?.role !== 'owner'
    || member?.status !== 'active'
  ) {
    throw new Error('STORE_INVENTORY_MOVEMENTS_FORBIDDEN');
  }
  return { storeId, ownerUserId: identity.uid };
};

const finite = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const isoDate = (value: unknown): string => {
  if (typeof value === 'string' && Number.isFinite(Date.parse(value))) {
    return new Date(value).toISOString();
  }
  if (value && typeof value === 'object') {
    const candidate = value as { toDate?: () => Date; seconds?: number; _seconds?: number };
    if (typeof candidate.toDate === 'function') {
      const date = candidate.toDate();
      return Number.isFinite(date.getTime()) ? date.toISOString() : '';
    }
    const seconds = finite(candidate.seconds) ?? finite(candidate._seconds);
    if (seconds !== null) {
      const date = new Date(seconds * 1000);
      return Number.isFinite(date.getTime()) ? date.toISOString() : '';
    }
  }
  return '';
};

export type StoreInventoryMovementKind = 'intake' | 'outflow' | 'loss' | 'correction';

export type StoreInventoryMovementLine = {
  itemId: string;
  name: string;
  unit: string;
  quantityDelta: number;
  previousQuantity: number | null;
  resultingQuantity: number | null;
};

export type StoreInventoryMovementView = {
  id: string;
  kind: StoreInventoryMovementKind;
  mode: 'increment' | 'decrement' | 'set' | '';
  reason: string;
  actionType: string;
  sourceKind: string;
  sourceLabel: string;
  origin: string;
  createdAt: string;
  entryCount: number;
  orderId: string;
  purchaseId: string;
  purchaseReceiptId: string;
  supplierId: string;
  lines: StoreInventoryMovementLine[];
};

const movementKind = (value: unknown): StoreInventoryMovementKind | null =>
  value === 'intake' || value === 'outflow' || value === 'loss' || value === 'correction'
    ? value
    : null;

const movementMode = (value: unknown): StoreInventoryMovementView['mode'] =>
  value === 'increment' || value === 'decrement' || value === 'set' ? value : '';

const normalizeLine = (value: unknown): StoreInventoryMovementLine | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const itemId = clean(record.itemId) || clean(record.inventoryItemId);
  const name = clean(record.name);
  const unit = clean(record.unit);
  const quantityDelta = finite(record.quantityDelta);
  if (!itemId || !name || !unit || quantityDelta === null) return null;
  return {
    itemId,
    name,
    unit,
    quantityDelta,
    previousQuantity: finite(record.previousQuantity),
    resultingQuantity: finite(record.resultingQuantity),
  };
};

export const normalizeStoreInventoryMovement = (
  documentId: string,
  value: unknown
): StoreInventoryMovementView | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const kind = movementKind(record.kind);
  const createdAt = isoDate(record.createdAt);
  if (!kind || !createdAt) return null;
  const lines = Array.isArray(record.lines)
    ? record.lines
        .map(normalizeLine)
        .filter((line): line is StoreInventoryMovementLine => Boolean(line))
    : [];
  const entryCount = finite(record.entryCount);
  return {
    id: clean(record.id) || documentId,
    kind,
    mode: movementMode(record.mode),
    reason: clean(record.reason),
    actionType: clean(record.actionType),
    sourceKind: clean(record.sourceKind),
    sourceLabel: clean(record.sourceLabel),
    origin: clean(record.origin),
    createdAt,
    entryCount: entryCount === null ? lines.length : Math.max(0, Math.trunc(entryCount)),
    orderId: clean(record.orderId),
    purchaseId: clean(record.purchaseId),
    purchaseReceiptId: clean(record.purchaseReceiptId),
    supplierId: clean(record.supplierId),
    lines,
  };
};

export type StoreInventoryMovementOverview = {
  storeId: string;
  movements: StoreInventoryMovementView[];
  summary: {
    total: number;
    intake: number;
    outflow: number;
    loss: number;
    correction: number;
  };
};

export const listAuthorizedStoreInventoryMovements = async (
  authorization: string,
  storeIdValue: unknown
): Promise<StoreInventoryMovementOverview> => {
  const { storeId, ownerUserId } = await requireCanonicalStoreOwner(
    authorization,
    storeIdValue
  );
  const inventoryPath = inventoryDocumentPathForOwner(ownerUserId);
  const snapshot = await adminDb
    .collection(`${inventoryPath}/movements`)
    .orderBy('createdAt', 'desc')
    .limit(120)
    .get();
  const movements = snapshot.docs
    .map(document => normalizeStoreInventoryMovement(document.id, document.data()))
    .filter((movement): movement is StoreInventoryMovementView => Boolean(movement));
  const summary = movements.reduce(
    (current, movement) => {
      current.total += 1;
      current[movement.kind] += 1;
      return current;
    },
    { total: 0, intake: 0, outflow: 0, loss: 0, correction: 0 }
  );
  return { storeId, movements, summary };
};
