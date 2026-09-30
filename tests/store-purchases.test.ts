import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import {
  buildPurchaseReceiptInventoryPlan,
} from '../shared/purchaseReceiptInventory';
import type { InventoryCatalogRecord } from '../shared/inventoryConsumption';
import {
  STORE_PROCUREMENT_SCHEMA_VERSION,
  STORE_PURCHASE_CURRENCY,
  buildManualStoreSupplier,
  buildStorePurchaseDraft,
  buildStorePurchaseReceiptDraft,
  canTransitionStorePurchaseReceiptStatus,
  canTransitionStorePurchaseStatus,
  deriveStorePurchaseReceivingProgress,
  normalizeStorePurchase,
  normalizeStorePurchaseReceipt,
  storePurchasePath,
  storePurchaseReceiptPath,
  storeSupplierPath,
  type StorePurchase,
  type StorePurchaseReceipt,
} from '../shared/storePurchases';

const now = '2026-09-30T12:30:00.000Z';

const purchaseDraft = () => buildStorePurchaseDraft({
  id: 'purchase-1',
  storeId: 'store-1',
  supplierId: 'supplier-1',
  lines: [
    {
      id: 'line-flour',
      inventoryItemId: 'ingredient-flour',
      name: 'Farinha',
      unit: 'kg',
      orderedQuantity: 100,
      quotedUnitCostMinor: 1250,
    },
  ],
  sourceAuthority: 'store_owner_manual',
  createdByUserId: 'owner-1',
  now,
});

const orderedPurchase = (): StorePurchase => normalizeStorePurchase({
  ...purchaseDraft(),
  status: 'ordered',
  orderedAt: now,
  updatedAt: now,
});

const partiallyReceivedPurchase = (): StorePurchase => normalizeStorePurchase({
  ...orderedPurchase(),
  status: 'partially_received',
  updatedAt: now,
});

const confirmedReceipt = (
  id: string,
  quantity: number,
  overrides: Partial<StorePurchaseReceipt> = {}
): StorePurchaseReceipt => {
  const draft = buildStorePurchaseReceiptDraft({
    id,
    storeId: 'store-1',
    purchaseId: 'purchase-1',
    supplierId: 'supplier-1',
    lines: [
      {
        purchaseLineId: 'line-flour',
        inventoryItemId: 'ingredient-flour',
        unit: 'kg',
        receivedQuantity: quantity,
        documentedUnitCostMinor: 1250,
      },
    ],
    sourceAuthority: 'store_owner_manual',
    createdByUserId: 'owner-1',
    now,
  });

  return normalizeStorePurchaseReceipt({
    ...draft,
    status: 'confirmed',
    confirmedAt: now,
    updatedAt: now,
    ...overrides,
  });
};

const inventoryCatalog = (
  overrides: Partial<InventoryCatalogRecord> = {}
): InventoryCatalogRecord[] => [{
  id: 'ingredient-flour',
  name: 'Farinha',
  unit: 'kg',
  currentQuantity: 10,
  minimumQuantity: 5,
  purchaseCost: 9.75,
  supplier: 'Fornecedor anterior',
  updatedAt: now,
  ...overrides,
}];

describe('canonical store purchases foundation', () => {
  test('supplier, purchase and receipt paths are explicitly store scoped', () => {
    assert.equal(
      storeSupplierPath('store-1', 'supplier-1'),
      'stores/store-1/suppliers/supplier-1'
    );
    assert.equal(
      storePurchasePath('store-1', 'purchase:1'),
      'stores/store-1/purchases/purchase%3A1'
    );
    assert.equal(
      storePurchaseReceiptPath('store-1', 'receipt:1'),
      'stores/store-1/purchaseReceipts/receipt%3A1'
    );
    assert.throws(() => storePurchasePath('store/other', 'purchase-1'));
  });

  test('supplier identity is canonical without requiring fiscal identity', () => {
    const supplier = buildManualStoreSupplier({
      id: 'supplier-1',
      storeId: 'store-1',
      displayName: 'Fornecedor local',
      createdByUserId: 'owner-1',
      now,
    });

    assert.equal(supplier.schemaVersion, STORE_PROCUREMENT_SCHEMA_VERSION);
    assert.equal(supplier.storeId, 'store-1');
    assert.equal(supplier.status, 'active');
    assert.equal(supplier.displayName, 'Fornecedor local');
  });

  test('purchase draft supports the complete inventory unit vocabulary', () => {
    const purchase = buildStorePurchaseDraft({
      id: 'purchase-units',
      storeId: 'store-1',
      supplierId: 'supplier-1',
      lines: [
        { id: 'a', inventoryItemId: 'a', name: 'Caixa', unit: 'cx', orderedQuantity: 2, quotedUnitCostMinor: null },
        { id: 'b', inventoryItemId: 'b', name: 'Pacote', unit: 'pct', orderedQuantity: 3, quotedUnitCostMinor: null },
        { id: 'c', inventoryItemId: 'c', name: 'Tecido', unit: 'm', orderedQuantity: 4, quotedUnitCostMinor: null },
        { id: 'd', inventoryItemId: 'd', name: 'Fita', unit: 'cm', orderedQuantity: 50, quotedUnitCostMinor: null },
      ],
      sourceAuthority: 'store_owner_manual',
      createdByUserId: 'owner-1',
      now,
    });

    assert.deepEqual(purchase.lines.map(line => line.unit), ['cx', 'pct', 'm', 'cm']);
    assert.equal(purchase.currency, STORE_PURCHASE_CURRENCY);
  });

  test('purchase and receipt status transitions preserve terminal states', () => {
    assert.equal(canTransitionStorePurchaseStatus('draft', 'ordered'), true);
    assert.equal(canTransitionStorePurchaseStatus('ordered', 'partially_received'), true);
    assert.equal(canTransitionStorePurchaseStatus('partially_received', 'received'), true);
    assert.equal(canTransitionStorePurchaseStatus('received', 'ordered'), false);
    assert.equal(canTransitionStorePurchaseStatus('partially_received', 'cancelled'), false);

    assert.equal(canTransitionStorePurchaseReceiptStatus('draft', 'confirmed'), true);
    assert.equal(canTransitionStorePurchaseReceiptStatus('draft', 'cancelled'), true);
    assert.equal(canTransitionStorePurchaseReceiptStatus('confirmed', 'cancelled'), false);
  });

  test('partial receipts aggregate only confirmed physical quantities', () => {
    const purchase = orderedPurchase();
    const firstReceipt = confirmedReceipt('receipt-1', 60);
    const draftReceipt = buildStorePurchaseReceiptDraft({
      id: 'receipt-draft',
      storeId: 'store-1',
      purchaseId: purchase.id,
      supplierId: purchase.supplierId,
      lines: [
        {
          purchaseLineId: 'line-flour',
          inventoryItemId: 'ingredient-flour',
          unit: 'kg',
          receivedQuantity: 20,
          documentedUnitCostMinor: null,
        },
      ],
      sourceAuthority: 'store_owner_manual',
      createdByUserId: 'owner-1',
      now,
    });

    const progress = deriveStorePurchaseReceivingProgress({
      purchase,
      receipts: [firstReceipt, draftReceipt],
    });

    assert.equal(progress.state, 'partially_received');
    assert.equal(progress.confirmedReceiptCount, 1);
    assert.equal(progress.lines[0]?.receivedQuantity, 60);
    assert.equal(progress.lines[0]?.remainingQuantity, 40);
  });

  test('a second confirmed partial receipt completes the purchase', () => {
    const progress = deriveStorePurchaseReceivingProgress({
      purchase: orderedPurchase(),
      receipts: [
        confirmedReceipt('receipt-1', 60),
        confirmedReceipt('receipt-2', 40),
      ],
    });

    assert.equal(progress.state, 'received');
    assert.equal(progress.confirmedReceiptCount, 2);
    assert.equal(progress.lines[0]?.remainingQuantity, 0);
  });

  test('same receipt id is idempotent while conflicting reuse is rejected', () => {
    const receipt = confirmedReceipt('receipt-1', 60);
    const progress = deriveStorePurchaseReceivingProgress({
      purchase: orderedPurchase(),
      receipts: [receipt, receipt],
    });

    assert.equal(progress.confirmedReceiptCount, 1);
    assert.equal(progress.lines[0]?.receivedQuantity, 60);

    assert.throws(
      () => deriveStorePurchaseReceivingProgress({
        purchase: orderedPurchase(),
        receipts: [receipt, confirmedReceipt('receipt-1', 40)],
      }),
      /STORE_PURCHASE_RECEIPT_IDEMPOTENCY_CONFLICT/
    );
  });

  test('cross-store, mismatched line and over-receipt inputs are rejected', () => {
    assert.throws(
      () => deriveStorePurchaseReceivingProgress({
        purchase: orderedPurchase(),
        receipts: [confirmedReceipt('receipt-other-store', 10, { storeId: 'store-2' })],
      }),
      /STORE_PURCHASE_RECEIPT_SCOPE_INVALID/
    );

    assert.throws(
      () => deriveStorePurchaseReceivingProgress({
        purchase: orderedPurchase(),
        receipts: [normalizeStorePurchaseReceipt({
          ...confirmedReceipt('receipt-wrong-item', 10),
          lines: [{
            purchaseLineId: 'line-flour',
            inventoryItemId: 'different-item',
            unit: 'kg',
            receivedQuantity: 10,
            documentedUnitCostMinor: null,
          }],
        })],
      }),
      /STORE_PURCHASE_RECEIPT_LINE_SCOPE_INVALID/
    );

    assert.throws(
      () => deriveStorePurchaseReceivingProgress({
        purchase: orderedPurchase(),
        receipts: [confirmedReceipt('receipt-too-much', 101)],
      }),
      /STORE_PURCHASE_RECEIPT_OVER_RECEIPT/
    );
  });

  test('confirmed receipt plan increments only physical quantity and preserves inventory cost policy', () => {
    const receipt = confirmedReceipt('receipt-1', 60);
    const plan = buildPurchaseReceiptInventoryPlan({
      purchase: orderedPurchase(),
      receipt,
      catalog: inventoryCatalog(),
    });

    assert.equal(plan.resultingPurchaseStatus, 'partially_received');
    assert.equal(plan.resultingCatalog[0]?.currentQuantity, 70);
    assert.equal(plan.resultingCatalog[0]?.purchaseCost, 9.75);
    assert.equal(plan.resultingCatalog[0]?.supplier, 'Fornecedor anterior');
    assert.deepEqual(plan.movementLines[0], {
      inventoryItemId: 'ingredient-flour',
      name: 'Farinha',
      unit: 'kg',
      receivedQuantity: 60,
      quantityDelta: 60,
      previousQuantity: 10,
      resultingQuantity: 70,
      purchaseLineIds: ['line-flour'],
      documentedUnitCostMinor: 1250,
    });
  });

  test('second physical receipt applies only its own 40 units and closes the purchase', () => {
    const firstReceipt = confirmedReceipt('receipt-1', 60);
    const secondReceipt = confirmedReceipt('receipt-2', 40);
    const plan = buildPurchaseReceiptInventoryPlan({
      purchase: partiallyReceivedPurchase(),
      receipt: secondReceipt,
      confirmedReceipts: [firstReceipt],
      catalog: inventoryCatalog({ currentQuantity: 70 }),
    });

    assert.equal(plan.resultingPurchaseStatus, 'received');
    assert.equal(plan.resultingCatalog[0]?.currentQuantity, 110);
    assert.equal(plan.movementLines[0]?.receivedQuantity, 40);
    assert.equal(plan.movementLines[0]?.previousQuantity, 70);
    assert.equal(plan.movementLines[0]?.resultingQuantity, 110);
  });

  test('receipt plan refuses missing or unit-mismatched canonical inventory identity', () => {
    assert.throws(
      () => buildPurchaseReceiptInventoryPlan({
        purchase: orderedPurchase(),
        receipt: confirmedReceipt('receipt-missing', 10),
        catalog: [],
      }),
      /PURCHASE_RECEIPT_INVENTORY_ITEM_NOT_FOUND/
    );

    assert.throws(
      () => buildPurchaseReceiptInventoryPlan({
        purchase: orderedPurchase(),
        receipt: confirmedReceipt('receipt-unit', 10),
        catalog: inventoryCatalog({ unit: 'g' }),
      }),
      /PURCHASE_RECEIPT_INVENTORY_UNIT_MISMATCH/
    );
  });

  test('receipt inventory executor uses the canonical physical stock and generic movement ledger atomically', () => {
    const service = readFileSync(
      'server/inventory/purchaseReceiptInventoryService.ts',
      'utf8'
    );

    assert.match(service, /resolveCanonicalInventoryAuthorityInTransaction/);
    assert.match(service, /inventoryPurchaseReceipts/);
    assert.match(service, /collection\('movements'\)/);
    assert.match(service, /actionType: 'purchase_receipt_inventory'/);
    assert.match(service, /reason: 'purchase_receipt'/);
    assert.match(service, /transaction\.create\(movementReference/);
    assert.match(service, /transaction\.create\(ledgerReference/);
    assert.match(service, /transaction\.update\(purchaseReference/);
    assert.doesNotMatch(service, /financePayables/);
    assert.doesNotMatch(service, /purchaseCost\s*:/);
  });

  test('foundation keeps procurement writes server-only', () => {
    const contract = readFileSync('shared/storePurchases.ts', 'utf8');
    const rules = readFileSync('firestore.rules', 'utf8');

    assert.doesNotMatch(contract, /firebase-admin|firebase\/firestore|currentQuantity/);
    assert.doesNotMatch(rules, /match \/purchases\//);
    assert.doesNotMatch(rules, /match \/purchaseReceipts\//);
    assert.doesNotMatch(rules, /match \/suppliers\//);
    assert.match(rules, /match \/\{document=\*\*\} \{\s*allow read, write: if false;/);
  });
});
