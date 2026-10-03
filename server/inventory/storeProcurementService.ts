import { randomUUID } from 'node:crypto';
import { adminDb } from '../firebaseAdmin.js';
import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';
import {
  buildManualStoreSupplier,
  buildStorePurchaseDraft,
  buildStorePurchaseReceiptDraft,
  canTransitionStorePurchaseReceiptStatus,
  canTransitionStorePurchaseStatus,
  deriveStorePurchaseReceivingProgress,
  normalizeStorePurchase,
  normalizeStorePurchaseReceipt,
  normalizeStoreSupplier,
  storePurchasePath,
  storePurchaseReceiptPath,
  storeSupplierPath,
  type StorePurchase,
  type StorePurchaseLine,
  type StorePurchaseReceipt,
  type StorePurchaseReceiptLine,
  type StoreSupplier,
} from '../../shared/storePurchases.js';
import { parseInventoryCatalogRecords } from '../../shared/inventoryConsumption.js';
import { inventoryDocumentPathForOwner } from './canonicalInventoryAuthorityService.js';
import { applyConfirmedPurchaseReceiptToInventory } from './purchaseReceiptInventoryService.js';

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const bearerToken = (authorization: string): string =>
  /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim() ?? '';

const idFor = (prefix: string): string =>
  `${prefix}-${randomUUID().replaceAll('-', '')}`;

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
  const storeId = requiredId(storeIdValue, 'STORE_PROCUREMENT_STORE_REQUIRED');
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
    throw new Error('STORE_PROCUREMENT_FORBIDDEN');
  }
  return { storeId, ownerUserId: identity.uid };
};

const parseSupplierSafe = (value: unknown): StoreSupplier | null => {
  try { return normalizeStoreSupplier(value); } catch { return null; }
};
const parsePurchaseSafe = (value: unknown): StorePurchase | null => {
  try { return normalizeStorePurchase(value); } catch { return null; }
};
const parseReceiptSafe = (value: unknown): StorePurchaseReceipt | null => {
  try { return normalizeStorePurchaseReceipt(value); } catch { return null; }
};

export type StoreProcurementOverview = {
  storeId: string;
  suppliers: StoreSupplier[];
  purchases: Array<StorePurchase & {
    receivingState: 'not_started' | 'partially_received' | 'received';
    receivedReceiptCount: number;
  }>;
  receipts: StorePurchaseReceipt[];
};

export const listAuthorizedStoreProcurement = async (
  authorization: string,
  storeIdValue: unknown
): Promise<StoreProcurementOverview> => {
  const { storeId } = await requireCanonicalStoreOwner(authorization, storeIdValue);
  const [supplierSnapshot, purchaseSnapshot, receiptSnapshot] = await Promise.all([
    adminDb.collection(`stores/${storeId}/suppliers`).limit(200).get(),
    adminDb.collection(`stores/${storeId}/purchases`).limit(200).get(),
    adminDb.collection(`stores/${storeId}/purchaseReceipts`).limit(300).get(),
  ]);

  const suppliers = supplierSnapshot.docs
    .map(document => parseSupplierSafe(document.data()))
    .filter((value): value is StoreSupplier => Boolean(value))
    .sort((left, right) => left.displayName.localeCompare(right.displayName, 'pt-BR'));
  const receipts = receiptSnapshot.docs
    .map(document => parseReceiptSafe(document.data()))
    .filter((value): value is StorePurchaseReceipt => Boolean(value))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const receiptsByPurchase = new Map<string, StorePurchaseReceipt[]>();
  for (const receipt of receipts) {
    const current = receiptsByPurchase.get(receipt.purchaseId) ?? [];
    current.push(receipt);
    receiptsByPurchase.set(receipt.purchaseId, current);
  }
  const purchases = purchaseSnapshot.docs
    .map(document => parsePurchaseSafe(document.data()))
    .filter((value): value is StorePurchase => Boolean(value))
    .map(purchase => {
      const progress = deriveStorePurchaseReceivingProgress({
        purchase,
        receipts: receiptsByPurchase.get(purchase.id) ?? [],
      });
      return {
        ...purchase,
        receivingState: progress.state,
        receivedReceiptCount: progress.confirmedReceiptCount,
      };
    })
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));

  return { storeId, suppliers, purchases, receipts };
};

const requireSupplier = async (storeId: string, supplierIdValue: unknown): Promise<StoreSupplier> => {
  const supplierId = requiredId(supplierIdValue, 'STORE_PROCUREMENT_SUPPLIER_REQUIRED');
  const snapshot = await adminDb.doc(storeSupplierPath(storeId, supplierId)).get();
  if (!snapshot.exists) throw new Error('STORE_PROCUREMENT_SUPPLIER_NOT_FOUND');
  const supplier = normalizeStoreSupplier(snapshot.data());
  if (supplier.storeId !== storeId) throw new Error('STORE_PROCUREMENT_SUPPLIER_SCOPE_INVALID');
  return supplier;
};

const normalizedDraftLines = (
  value: unknown,
  catalog: ReturnType<typeof parseInventoryCatalogRecords>
): StorePurchaseLine[] => {
  if (!Array.isArray(value) || value.length === 0 || value.length > 200) {
    throw new Error('STORE_PROCUREMENT_PURCHASE_LINES_INVALID');
  }
  const inventoryById = new Map(catalog.map(item => [item.id, item]));
  const seen = new Set<string>();
  return value.map((candidate, index) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new Error('STORE_PROCUREMENT_PURCHASE_LINES_INVALID');
    }
    const line = candidate as Record<string, unknown>;
    const inventoryItemId = requiredId(
      line.inventoryItemId,
      'STORE_PROCUREMENT_INVENTORY_ITEM_REQUIRED'
    );
    if (seen.has(inventoryItemId)) throw new Error('STORE_PROCUREMENT_PURCHASE_LINE_DUPLICATE');
    seen.add(inventoryItemId);
    const item = inventoryById.get(inventoryItemId);
    if (!item) throw new Error('STORE_PROCUREMENT_INVENTORY_ITEM_NOT_FOUND');
    const quantity = Number(line.orderedQuantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error('STORE_PROCUREMENT_ORDERED_QUANTITY_INVALID');
    }
    if (clean(line.unit) && clean(line.unit) !== item.unit) {
      throw new Error('STORE_PROCUREMENT_INVENTORY_UNIT_MISMATCH');
    }
    const rawCost = line.quotedUnitCostMinor;
    const quotedUnitCostMinor = rawCost === undefined || rawCost === null || rawCost === ''
      ? null
      : Number(rawCost);
    if (
      quotedUnitCostMinor !== null
      && (!Number.isSafeInteger(quotedUnitCostMinor) || quotedUnitCostMinor < 0)
    ) throw new Error('STORE_PROCUREMENT_QUOTED_UNIT_COST_INVALID');
    return {
      id: `line-${index + 1}-${inventoryItemId}`,
      inventoryItemId,
      name: item.name,
      unit: item.unit as StorePurchaseLine['unit'],
      orderedQuantity: quantity,
      quotedUnitCostMinor,
    };
  });
};

export const createAuthorizedStoreSupplier = async (
  authorization: string,
  input: Record<string, unknown>
): Promise<StoreSupplier> => {
  const { storeId, ownerUserId } = await requireCanonicalStoreOwner(authorization, input.storeId);
  const supplier = buildManualStoreSupplier({
    id: idFor('supplier'),
    storeId,
    displayName: clean(input.displayName),
    contactName: clean(input.contactName),
    email: clean(input.email),
    phone: clean(input.phone),
    notes: clean(input.notes),
    createdByUserId: ownerUserId,
  });
  await adminDb.doc(storeSupplierPath(storeId, supplier.id)).create(supplier);
  return supplier;
};

export const createAuthorizedStorePurchaseDraft = async (
  authorization: string,
  input: Record<string, unknown>
): Promise<StorePurchase> => {
  const { storeId, ownerUserId } = await requireCanonicalStoreOwner(authorization, input.storeId);
  const supplier = await requireSupplier(storeId, input.supplierId);
  if (supplier.status !== 'active') throw new Error('STORE_PROCUREMENT_SUPPLIER_INACTIVE');
  const inventorySnapshot = await adminDb
    .doc(inventoryDocumentPathForOwner(ownerUserId))
    .get();
  const inventoryData = inventorySnapshot.data();
  const catalog = parseInventoryCatalogRecords(
    inventoryData?.catalog ?? inventoryData?.inventoryCatalog
  );
  const purchase = buildStorePurchaseDraft({
    id: idFor('purchase'),
    storeId,
    supplierId: supplier.id,
    lines: normalizedDraftLines(input.lines, catalog),
    sourceAuthority: 'store_owner_manual',
    createdByUserId: ownerUserId,
  });
  await adminDb.doc(storePurchasePath(storeId, purchase.id)).create(purchase);
  return purchase;
};

export const orderAuthorizedStorePurchase = async (
  authorization: string,
  input: Record<string, unknown>
): Promise<StorePurchase> => {
  const { storeId } = await requireCanonicalStoreOwner(authorization, input.storeId);
  const purchaseId = requiredId(input.purchaseId, 'STORE_PROCUREMENT_PURCHASE_REQUIRED');
  const reference = adminDb.doc(storePurchasePath(storeId, purchaseId));
  return adminDb.runTransaction(async transaction => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists) throw new Error('STORE_PROCUREMENT_PURCHASE_NOT_FOUND');
    const purchase = normalizeStorePurchase(snapshot.data());
    if (purchase.storeId !== storeId || purchase.id !== purchaseId) {
      throw new Error('STORE_PROCUREMENT_PURCHASE_SCOPE_INVALID');
    }
    if (!canTransitionStorePurchaseStatus(purchase.status, 'ordered')) {
      throw new Error('STORE_PROCUREMENT_PURCHASE_TRANSITION_INVALID');
    }
    if (purchase.status === 'ordered') return purchase;
    const now = new Date().toISOString();
    const next = normalizeStorePurchase({
      ...purchase,
      status: 'ordered',
      orderedAt: now,
      updatedAt: now,
    });
    transaction.set(reference, next, { merge: false });
    return next;
  });
};

const normalizeReceiptDraftLines = (
  value: unknown,
  purchase: StorePurchase,
  confirmedReceipts: StorePurchaseReceipt[]
): StorePurchaseReceiptLine[] => {
  if (!Array.isArray(value) || value.length === 0 || value.length > purchase.lines.length) {
    throw new Error('STORE_PROCUREMENT_RECEIPT_LINES_INVALID');
  }
  const progress = deriveStorePurchaseReceivingProgress({ purchase, receipts: confirmedReceipts });
  const remainingByLine = new Map(
    progress.lines.map(line => [line.purchaseLineId, line.remainingQuantity])
  );
  const purchaseLineById = new Map(purchase.lines.map(line => [line.id, line]));
  const seen = new Set<string>();
  return value.map(candidate => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new Error('STORE_PROCUREMENT_RECEIPT_LINES_INVALID');
    }
    const line = candidate as Record<string, unknown>;
    const purchaseLineId = requiredId(line.purchaseLineId, 'STORE_PROCUREMENT_PURCHASE_LINE_REQUIRED');
    if (seen.has(purchaseLineId)) throw new Error('STORE_PROCUREMENT_RECEIPT_LINE_DUPLICATE');
    seen.add(purchaseLineId);
    const purchaseLine = purchaseLineById.get(purchaseLineId);
    if (!purchaseLine) throw new Error('STORE_PROCUREMENT_PURCHASE_LINE_NOT_FOUND');
    const quantity = Number(line.receivedQuantity);
    const remaining = remainingByLine.get(purchaseLineId) ?? 0;
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > remaining + Number.EPSILON) {
      throw new Error('STORE_PROCUREMENT_RECEIVED_QUANTITY_INVALID');
    }
    const rawCost = line.documentedUnitCostMinor;
    const documentedUnitCostMinor = rawCost === undefined || rawCost === null || rawCost === ''
      ? null
      : Number(rawCost);
    if (
      documentedUnitCostMinor !== null
      && (!Number.isSafeInteger(documentedUnitCostMinor) || documentedUnitCostMinor < 0)
    ) throw new Error('STORE_PROCUREMENT_DOCUMENTED_UNIT_COST_INVALID');
    return {
      purchaseLineId,
      inventoryItemId: purchaseLine.inventoryItemId,
      unit: purchaseLine.unit,
      receivedQuantity: quantity,
      documentedUnitCostMinor,
    };
  });
};

export const createAuthorizedStorePurchaseReceiptDraft = async (
  authorization: string,
  input: Record<string, unknown>
): Promise<StorePurchaseReceipt> => {
  const { storeId, ownerUserId } = await requireCanonicalStoreOwner(authorization, input.storeId);
  const purchaseId = requiredId(input.purchaseId, 'STORE_PROCUREMENT_PURCHASE_REQUIRED');
  const purchaseReference = adminDb.doc(storePurchasePath(storeId, purchaseId));
  const purchaseSnapshot = await purchaseReference.get();
  if (!purchaseSnapshot.exists) throw new Error('STORE_PROCUREMENT_PURCHASE_NOT_FOUND');
  const purchase = normalizeStorePurchase(purchaseSnapshot.data());
  if (purchase.storeId !== storeId || purchase.id !== purchaseId) {
    throw new Error('STORE_PROCUREMENT_PURCHASE_SCOPE_INVALID');
  }
  if (purchase.status !== 'ordered' && purchase.status !== 'partially_received') {
    throw new Error('STORE_PROCUREMENT_PURCHASE_NOT_RECEIVABLE');
  }
  const receiptSnapshots = await adminDb
    .collection(`stores/${storeId}/purchaseReceipts`)
    .where('purchaseId', '==', purchaseId)
    .get();
  const receipts = receiptSnapshots.docs.map(document =>
    normalizeStorePurchaseReceipt(document.data())
  );
  const receipt = buildStorePurchaseReceiptDraft({
    id: idFor('receipt'),
    storeId,
    purchaseId,
    supplierId: purchase.supplierId,
    lines: normalizeReceiptDraftLines(input.lines, purchase, receipts),
    sourceAuthority: 'store_owner_manual',
    sourceReference: clean(input.sourceReference),
    createdByUserId: ownerUserId,
  });
  await adminDb.doc(storePurchaseReceiptPath(storeId, receipt.id)).create(receipt);
  return receipt;
};

export const confirmAuthorizedStorePurchaseReceipt = async (
  authorization: string,
  input: Record<string, unknown>
) => {
  const { storeId } = await requireCanonicalStoreOwner(authorization, input.storeId);
  const receiptId = requiredId(input.receiptId, 'STORE_PROCUREMENT_RECEIPT_REQUIRED');
  const receiptReference = adminDb.doc(storePurchaseReceiptPath(storeId, receiptId));

  await adminDb.runTransaction(async transaction => {
    const receiptSnapshot = await transaction.get(receiptReference);
    if (!receiptSnapshot.exists) throw new Error('STORE_PROCUREMENT_RECEIPT_NOT_FOUND');
    const receipt = normalizeStorePurchaseReceipt(receiptSnapshot.data());
    if (receipt.storeId !== storeId || receipt.id !== receiptId) {
      throw new Error('STORE_PROCUREMENT_RECEIPT_SCOPE_INVALID');
    }
    if (receipt.status === 'confirmed') return;
    if (!canTransitionStorePurchaseReceiptStatus(receipt.status, 'confirmed')) {
      throw new Error('STORE_PROCUREMENT_RECEIPT_TRANSITION_INVALID');
    }
    const purchaseReference = adminDb.doc(storePurchasePath(storeId, receipt.purchaseId));
    const purchaseSnapshot = await transaction.get(purchaseReference);
    if (!purchaseSnapshot.exists) throw new Error('STORE_PROCUREMENT_PURCHASE_NOT_FOUND');
    const purchase = normalizeStorePurchase(purchaseSnapshot.data());
    if (purchase.status !== 'ordered' && purchase.status !== 'partially_received') {
      throw new Error('STORE_PROCUREMENT_PURCHASE_NOT_RECEIVABLE');
    }
    const receiptsQuery = adminDb
      .collection(`stores/${storeId}/purchaseReceipts`)
      .where('purchaseId', '==', purchase.id);
    const receiptSnapshots = await transaction.get(receiptsQuery);
    const others = receiptSnapshots.docs
      .filter(document => document.id !== receiptId)
      .map(document => normalizeStorePurchaseReceipt(document.data()));
    const now = new Date().toISOString();
    const confirmed = normalizeStorePurchaseReceipt({
      ...receipt,
      status: 'confirmed',
      confirmedAt: now,
      updatedAt: now,
    });
    deriveStorePurchaseReceivingProgress({
      purchase,
      receipts: [...others, confirmed],
    });
    transaction.set(receiptReference, confirmed, { merge: false });
  });

  return applyConfirmedPurchaseReceiptToInventory(storeId, receiptId);
};

export const executeAuthorizedStoreProcurementAction = async (
  authorization: string,
  body: unknown
): Promise<unknown> => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('STORE_PROCUREMENT_REQUEST_INVALID');
  }
  const input = body as Record<string, unknown>;
  const action = clean(input.action);
  if (action === 'create_supplier') return createAuthorizedStoreSupplier(authorization, input);
  if (action === 'create_purchase_draft') return createAuthorizedStorePurchaseDraft(authorization, input);
  if (action === 'order_purchase') return orderAuthorizedStorePurchase(authorization, input);
  if (action === 'create_receipt_draft') return createAuthorizedStorePurchaseReceiptDraft(authorization, input);
  if (action === 'confirm_receipt') return confirmAuthorizedStorePurchaseReceipt(authorization, input);
  throw new Error('STORE_PROCUREMENT_ACTION_UNSUPPORTED');
};
