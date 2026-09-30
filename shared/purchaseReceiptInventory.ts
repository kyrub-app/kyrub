import {
  parseInventoryCatalogRecords,
  type InventoryCatalogRecord,
} from './inventoryConsumption.js';
import {
  canTransitionStorePurchaseStatus,
  deriveStorePurchaseReceivingProgress,
  normalizeStorePurchase,
  normalizeStorePurchaseReceipt,
  type StorePurchase,
  type StorePurchaseReceipt,
  type StorePurchaseStatus,
  type StorePurchaseUnit,
} from './storePurchases.js';

const QUANTITY_SCALE = 1_000_000;

export interface PurchaseReceiptInventoryMovementLine {
  inventoryItemId: string;
  name: string;
  unit: StorePurchaseUnit;
  receivedQuantity: number;
  quantityDelta: number;
  previousQuantity: number;
  resultingQuantity: number;
  purchaseLineIds: string[];
  documentedUnitCostMinor: number | null;
}

export interface PurchaseReceiptInventoryPlan {
  purchase: StorePurchase;
  receipt: StorePurchaseReceipt;
  resultingPurchaseStatus: Extract<
    StorePurchaseStatus,
    'partially_received' | 'received'
  >;
  movementLines: PurchaseReceiptInventoryMovementLine[];
  resultingCatalog: InventoryCatalogRecord[];
}

const roundQuantity = (value: number): number =>
  Math.round((value + Number.EPSILON) * QUANTITY_SCALE) / QUANTITY_SCALE;

const matchingDocumentedCost = (values: Array<number | null>): number | null => {
  const numeric = values.filter((value): value is number => value !== null);
  if (numeric.length !== values.length || numeric.length === 0) return null;
  const first = numeric[0];
  return numeric.every(value => value === first) ? first : null;
};

export const buildPurchaseReceiptInventoryPlan = (input: {
  purchase: StorePurchase;
  receipt: StorePurchaseReceipt;
  confirmedReceipts?: StorePurchaseReceipt[];
  catalog: InventoryCatalogRecord[];
}): PurchaseReceiptInventoryPlan => {
  const purchase = normalizeStorePurchase(input.purchase);
  const receipt = normalizeStorePurchaseReceipt(input.receipt);

  if (receipt.status !== 'confirmed') {
    throw new Error('PURCHASE_RECEIPT_NOT_CONFIRMED');
  }
  if (purchase.status === 'draft' || purchase.status === 'cancelled') {
    throw new Error('PURCHASE_RECEIPT_PURCHASE_NOT_RECEIVABLE');
  }
  if (purchase.status === 'received') {
    throw new Error('PURCHASE_RECEIPT_PURCHASE_ALREADY_RECEIVED');
  }
  if (
    receipt.storeId !== purchase.storeId
    || receipt.purchaseId !== purchase.id
    || receipt.supplierId !== purchase.supplierId
  ) {
    throw new Error('STORE_PURCHASE_RECEIPT_SCOPE_INVALID');
  }

  const progress = deriveStorePurchaseReceivingProgress({
    purchase,
    receipts: [...(input.confirmedReceipts ?? []), receipt],
  });
  if (progress.state === 'not_started') {
    throw new Error('PURCHASE_RECEIPT_RECEIVING_PROGRESS_INVALID');
  }

  const resultingPurchaseStatus = progress.state;
  if (!canTransitionStorePurchaseStatus(purchase.status, resultingPurchaseStatus)) {
    throw new Error('PURCHASE_RECEIPT_PURCHASE_STATUS_TRANSITION_INVALID');
  }

  const catalog = parseInventoryCatalogRecords(input.catalog);
  const catalogById = new Map(catalog.map(item => [item.id, { ...item }]));
  const purchaseLineById = new Map(purchase.lines.map(line => [line.id, line]));
  const grouped = new Map<
    string,
    {
      inventoryItemId: string;
      unit: StorePurchaseUnit;
      receivedQuantity: number;
      purchaseLineIds: string[];
      documentedUnitCostsMinor: Array<number | null>;
    }
  >();

  for (const receiptLine of receipt.lines) {
    const purchaseLine = purchaseLineById.get(receiptLine.purchaseLineId);
    if (!purchaseLine) {
      throw new Error('STORE_PURCHASE_RECEIPT_LINE_SCOPE_INVALID');
    }

    const current = grouped.get(receiptLine.inventoryItemId) ?? {
      inventoryItemId: receiptLine.inventoryItemId,
      unit: receiptLine.unit,
      receivedQuantity: 0,
      purchaseLineIds: [],
      documentedUnitCostsMinor: [],
    };
    if (current.unit !== receiptLine.unit) {
      throw new Error('PURCHASE_RECEIPT_INVENTORY_UNIT_MISMATCH');
    }
    current.receivedQuantity = roundQuantity(
      current.receivedQuantity + receiptLine.receivedQuantity
    );
    current.purchaseLineIds.push(receiptLine.purchaseLineId);
    current.documentedUnitCostsMinor.push(receiptLine.documentedUnitCostMinor);
    grouped.set(receiptLine.inventoryItemId, current);
  }

  const movementLines: PurchaseReceiptInventoryMovementLine[] = [];

  for (const group of grouped.values()) {
    const item = catalogById.get(group.inventoryItemId);
    if (!item) {
      throw new Error('PURCHASE_RECEIPT_INVENTORY_ITEM_NOT_FOUND');
    }
    if (item.unit !== group.unit) {
      throw new Error('PURCHASE_RECEIPT_INVENTORY_UNIT_MISMATCH');
    }

    const previousQuantity = roundQuantity(item.currentQuantity);
    const resultingQuantity = roundQuantity(
      previousQuantity + group.receivedQuantity
    );
    catalogById.set(item.id, {
      ...item,
      currentQuantity: resultingQuantity,
    });
    movementLines.push({
      inventoryItemId: item.id,
      name: item.name,
      unit: group.unit,
      receivedQuantity: group.receivedQuantity,
      quantityDelta: group.receivedQuantity,
      previousQuantity,
      resultingQuantity,
      purchaseLineIds: [...group.purchaseLineIds].sort(),
      documentedUnitCostMinor: matchingDocumentedCost(
        group.documentedUnitCostsMinor
      ),
    });
  }

  if (movementLines.length === 0) {
    throw new Error('PURCHASE_RECEIPT_INVENTORY_LINES_EMPTY');
  }

  return {
    purchase,
    receipt,
    resultingPurchaseStatus,
    movementLines: movementLines.sort((left, right) =>
      left.name.localeCompare(right.name, 'pt-BR')
    ),
    resultingCatalog: catalog.map(item => catalogById.get(item.id) ?? item),
  };
};
