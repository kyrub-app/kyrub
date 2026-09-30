import { createHash } from 'node:crypto';
import { FieldValue, type DocumentData } from 'firebase-admin/firestore';
import {
  buildPurchaseReceiptInventoryPlan,
  type PurchaseReceiptInventoryMovementLine,
} from '../../shared/purchaseReceiptInventory.js';
import {
  normalizeStorePurchase,
  normalizeStorePurchaseReceipt,
  storePurchasePath,
  storePurchaseReceiptPath,
} from '../../shared/storePurchases.js';
import { parseInventoryCatalogRecords } from '../../shared/inventoryConsumption.js';
import { adminDb } from '../firebaseAdmin.js';
import { resolveCanonicalInventoryAuthorityInTransaction } from './canonicalInventoryAuthorityService.js';

const MAX_RECENT_MOVEMENTS = 20;
const MAX_RECENT_MOVEMENT_LINES = 12;
const LEDGER_COLLECTION = 'inventoryPurchaseReceipts';

export type PurchaseReceiptInventoryApplicationStatus = 'applied' | 'duplicate';

export interface PurchaseReceiptInventoryApplicationResult {
  status: PurchaseReceiptInventoryApplicationStatus;
  storeId: string;
  purchaseId: string;
  receiptId: string;
  movementId: string;
  resultingPurchaseStatus: 'partially_received' | 'received';
}

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const validPathId = (value: string): boolean =>
  Boolean(value) && value !== '.' && value !== '..' && !value.includes('/');

const ledgerIdFor = (storeId: string, receiptId: string): string =>
  createHash('sha256')
    .update(`${storeId}:${receiptId}`)
    .digest('hex');

const movementIdFor = (storeId: string, receiptId: string): string =>
  `movement-${createHash('sha256')
    .update(`${storeId}:${receiptId}:purchase_receipt`)
    .digest('hex')
    .slice(0, 40)}`;

const sourceKindFor = (
  sourceAuthority: string
): 'supplier_invoice' | 'inventory_intake_text' =>
  sourceAuthority === 'supplier_document'
    ? 'supplier_invoice'
    : 'inventory_intake_text';

const recentMovementsFrom = (
  inventoryData: DocumentData | undefined
): Record<string, unknown>[] =>
  Array.isArray(inventoryData?.recentInventoryMovements)
    ? inventoryData.recentInventoryMovements.filter(
        (value: unknown): value is Record<string, unknown> =>
          Boolean(value) && typeof value === 'object' && !Array.isArray(value)
      )
    : [];

const recentLineFrom = (line: PurchaseReceiptInventoryMovementLine) => ({
  itemId: line.inventoryItemId,
  name: line.name,
  unit: line.unit,
  quantityDelta: line.quantityDelta,
  previousQuantity: line.previousQuantity,
  resultingQuantity: line.resultingQuantity,
  documentedUnitCostMinor: line.documentedUnitCostMinor,
});

export const applyConfirmedPurchaseReceiptToInventory = async (
  storeIdValue: string,
  receiptIdValue: string
): Promise<PurchaseReceiptInventoryApplicationResult> => {
  const storeId = clean(storeIdValue);
  const receiptId = clean(receiptIdValue);
  if (!validPathId(storeId) || !validPathId(receiptId)) {
    throw new Error('PURCHASE_RECEIPT_INVENTORY_SCOPE_INVALID');
  }

  const receiptReference = adminDb.doc(
    storePurchaseReceiptPath(storeId, receiptId)
  );
  const ledgerReference = adminDb.doc(
    `${LEDGER_COLLECTION}/${ledgerIdFor(storeId, receiptId)}`
  );

  return adminDb.runTransaction(async transaction => {
    const receiptSnapshot = await transaction.get(receiptReference);
    if (!receiptSnapshot.exists) {
      throw new Error('PURCHASE_RECEIPT_NOT_FOUND');
    }
    const receipt = normalizeStorePurchaseReceipt(receiptSnapshot.data());
    if (receipt.id !== receiptId || receipt.storeId !== storeId) {
      throw new Error('PURCHASE_RECEIPT_INVENTORY_SCOPE_INVALID');
    }
    if (receipt.status !== 'confirmed') {
      throw new Error('PURCHASE_RECEIPT_NOT_CONFIRMED');
    }

    const purchaseReference = adminDb.doc(
      storePurchasePath(storeId, receipt.purchaseId)
    );
    const [purchaseSnapshot, ledgerSnapshot] = await Promise.all([
      transaction.get(purchaseReference),
      transaction.get(ledgerReference),
    ]);

    if (!purchaseSnapshot.exists) {
      throw new Error('PURCHASE_RECEIPT_PURCHASE_NOT_FOUND');
    }
    const purchase = normalizeStorePurchase(purchaseSnapshot.data());
    if (
      purchase.id !== receipt.purchaseId
      || purchase.storeId !== storeId
      || purchase.supplierId !== receipt.supplierId
    ) {
      throw new Error('STORE_PURCHASE_RECEIPT_SCOPE_INVALID');
    }

    if (ledgerSnapshot.exists) {
      const ledger = ledgerSnapshot.data();
      if (
        clean(ledger?.storeId) !== storeId
        || clean(ledger?.purchaseId) !== purchase.id
        || clean(ledger?.receiptId) !== receipt.id
      ) {
        throw new Error('PURCHASE_RECEIPT_INVENTORY_IDEMPOTENCY_CONFLICT');
      }
      const resultingPurchaseStatus = clean(ledger?.resultingPurchaseStatus);
      if (
        resultingPurchaseStatus !== 'partially_received'
        && resultingPurchaseStatus !== 'received'
      ) {
        throw new Error('PURCHASE_RECEIPT_INVENTORY_LEDGER_INVALID');
      }
      return {
        status: 'duplicate',
        storeId,
        purchaseId: purchase.id,
        receiptId: receipt.id,
        movementId: clean(ledger?.movementId),
        resultingPurchaseStatus,
      };
    }

    const inventoryAuthority = await resolveCanonicalInventoryAuthorityInTransaction(
      transaction,
      storeId
    );
    const inventoryReference = adminDb.doc(
      inventoryAuthority.inventoryDocumentPath
    );
    const receiptsQuery = adminDb
      .collection(`stores/${storeId}/purchaseReceipts`)
      .where('purchaseId', '==', purchase.id);
    const [inventorySnapshot, purchaseReceiptSnapshots] = await Promise.all([
      transaction.get(inventoryReference),
      transaction.get(receiptsQuery),
    ]);
    const inventoryData = inventorySnapshot.data();
    const catalog = parseInventoryCatalogRecords(
      inventoryData?.catalog ?? inventoryData?.inventoryCatalog
    );
    const confirmedReceipts = purchaseReceiptSnapshots.docs.map(document =>
      normalizeStorePurchaseReceipt(document.data())
    );
    const plan = buildPurchaseReceiptInventoryPlan({
      purchase,
      receipt,
      confirmedReceipts,
      catalog,
    });

    const now = new Date().toISOString();
    const movementId = movementIdFor(storeId, receipt.id);
    const movementReference = inventoryReference
      .collection('movements')
      .doc(movementId);
    const sourceKind = sourceKindFor(receipt.sourceAuthority);
    const sourceLabel = `Recebimento · Compra ${purchase.id}`;
    const movementLines = plan.movementLines.map(recentLineFrom);
    const recentMovement = {
      id: movementId,
      kind: 'intake' as const,
      mode: 'increment' as const,
      sourceKind,
      sourceLabel,
      entryCount: movementLines.length,
      createdAt: now,
      lines: movementLines.slice(0, MAX_RECENT_MOVEMENT_LINES),
      linesTruncated: movementLines.length > MAX_RECENT_MOVEMENT_LINES,
    };
    const nextRecentMovements = [
      recentMovement,
      ...recentMovementsFrom(inventoryData).filter(
        movement => clean(movement.id) !== movementId
      ),
    ].slice(0, MAX_RECENT_MOVEMENTS);
    const lastMovement = {
      id: movementId,
      movementId,
      kind: 'intake' as const,
      sourceKind,
      sourceLabel,
      entryCount: movementLines.length,
      storeId,
      supplierId: receipt.supplierId,
      purchaseId: purchase.id,
      purchaseReceiptId: receipt.id,
      confirmedAt: FieldValue.serverTimestamp(),
    };

    transaction.set(
      inventoryReference,
      {
        ownerId: inventoryAuthority.ownerUserId,
        catalog: plan.resultingCatalog.map(item => ({
          ...item,
          updatedAt: plan.movementLines.some(
            line => line.inventoryItemId === item.id
          ) ? now : item.updatedAt,
        })),
        inventoryCatalog: plan.resultingCatalog.map(item => ({
          ...item,
          updatedAt: plan.movementLines.some(
            line => line.inventoryItemId === item.id
          ) ? now : item.updatedAt,
        })),
        recentInventoryMovements: nextRecentMovements,
        recentInventoryMovementCount: nextRecentMovements.length,
        lastInventoryMovement: lastMovement,
        lastInventoryIntake: lastMovement,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    transaction.create(movementReference, {
      schemaVersion: 1,
      id: movementId,
      ownerId: inventoryAuthority.ownerUserId,
      actionType: 'purchase_receipt_inventory',
      mode: 'increment',
      kind: 'intake',
      reason: 'purchase_receipt',
      sourceKind,
      sourceLabel,
      origin: 'automation',
      storeId,
      supplierId: receipt.supplierId,
      purchaseId: purchase.id,
      purchaseReceiptId: receipt.id,
      sourceAuthority: receipt.sourceAuthority,
      sourceReference: receipt.sourceReference,
      lines: movementLines,
      entryCount: movementLines.length,
      createdAt: FieldValue.serverTimestamp(),
    });

    transaction.create(ledgerReference, {
      schemaVersion: 1,
      status: 'applied',
      storeId,
      supplierId: receipt.supplierId,
      purchaseId: purchase.id,
      receiptId: receipt.id,
      movementId,
      resultingPurchaseStatus: plan.resultingPurchaseStatus,
      inventoryAuthorityOwnerUserId: inventoryAuthority.ownerUserId,
      inventoryAuthority: inventoryAuthority.authority,
      inventoryDocumentPath: inventoryAuthority.inventoryDocumentPath,
      canonicalStoreId: inventoryAuthority.canonicalStoreId,
      receiptConfirmedAt: receipt.confirmedAt,
      lineCount: movementLines.length,
      createdAt: FieldValue.serverTimestamp(),
    });

    transaction.update(purchaseReference, {
      status: plan.resultingPurchaseStatus,
      updatedAt: now,
    });

    return {
      status: 'applied',
      storeId,
      purchaseId: purchase.id,
      receiptId: receipt.id,
      movementId,
      resultingPurchaseStatus: plan.resultingPurchaseStatus,
    };
  });
};
