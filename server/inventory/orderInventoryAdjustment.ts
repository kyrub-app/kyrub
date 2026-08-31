import { FieldValue, type DocumentData } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin';
import {
  applyInventoryConsumptionLines,
  calculateCompositionAvailableStock,
  parseInventoryCatalogRecords,
  parseInventoryCompositionRecords,
  type InventoryConsumptionLine,
} from '../../shared/inventoryConsumption';
import {
  buildOrderInventoryConsumptionWithOptions,
  parseConfiguredLineSelectedOptions,
  parseInventorySelectedOptions,
  parseOptionInventoryImpacts,
  type OptionAwareInventoryOrderItem,
} from '../../shared/optionInventoryImpact';
import {
  inventoryAuthorityFromLedger,
  legacyTenantInventoryAuthority,
} from './canonicalInventoryAuthorityService';
import { reconcilePersistedOrderInventory } from './orderInventoryService';
import { createHash } from 'node:crypto';

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const finiteInteger = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : null;

const orderPath = (tenantId: string, orderId: string): string =>
  `artifacts/${tenantId}/public/data/customerOrders/${orderId}`;

const ledgerPath = (tenantId: string, orderId: string): string =>
  `inventoryOrderConsumptions/${createHash('sha256')
    .update(`${tenantId}:${orderId}`)
    .digest('hex')}`;

const sourceProductId = (value: unknown, explicitSource: unknown): string => {
  const explicit = clean(explicitSource);
  if (explicit) return explicit;
  const configured = clean(value);
  return configured.split('::', 1)[0]?.trim() || configured;
};

const parseOrderItems = (value: unknown): OptionAwareInventoryOrderItem[] => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.items)) return [];
  return record.items.flatMap(candidate => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      return [];
    }
    const item = candidate as Record<string, unknown>;
    const configuredProductId = clean(item.productId);
    const productId = sourceProductId(configuredProductId, item.sourceProductId);
    const name = clean(item.name);
    const quantity = finiteInteger(item.quantity);
    const transferredQuantity = finiteInteger(item.transferredQuantity) ?? 0;
    if (!productId || !name || quantity === null || quantity <= 0) return [];
    const explicitSelectedOptions = parseInventorySelectedOptions(item.selectedOptions);
    const selectedOptions = explicitSelectedOptions.length > 0
      ? explicitSelectedOptions
      : parseConfiguredLineSelectedOptions(configuredProductId);
    return [{
      productId,
      name,
      quantity,
      transferredQuantity,
      ...(selectedOptions.length > 0 ? { selectedOptions } : {}),
    }];
  });
};

const productCategoriesFromTenant = (
  tenantData: DocumentData | undefined
): Record<string, string> => {
  if (!Array.isArray(tenantData?.publicProducts)) return {};
  const categories: Record<string, string> = {};
  for (const candidate of tenantData.publicProducts) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      continue;
    }
    const product = candidate as Record<string, unknown>;
    const id = clean(product.id);
    const category = clean(product.category);
    if (id && category) categories[id] = category;
  }
  return categories;
};

const parseLedgerLines = (value: unknown): InventoryConsumptionLine[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap(candidate => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      return [];
    }
    const line = candidate as Record<string, unknown>;
    const inventoryItemId = clean(line.inventoryItemId);
    const quantity =
      typeof line.quantity === 'number' && Number.isFinite(line.quantity)
        ? line.quantity
        : null;
    if (!inventoryItemId || quantity === null || quantity <= 0) return [];
    return [{
      inventoryItemId,
      inventoryItemName: clean(line.inventoryItemName),
      unit: clean(line.unit),
      quantity,
      beforeQuantity:
        typeof line.beforeQuantity === 'number' ? line.beforeQuantity : 0,
      afterQuantity:
        typeof line.afterQuantity === 'number' ? line.afterQuantity : 0,
      productIds: Array.isArray(line.productIds)
        ? line.productIds.map(clean).filter(Boolean)
        : [],
    } satisfies InventoryConsumptionLine];
  });
};

const comparableLines = (lines: InventoryConsumptionLine[]): string =>
  JSON.stringify(
    [...lines]
      .map(line => ({
        inventoryItemId: line.inventoryItemId,
        quantity: Math.round(line.quantity * 1_000_000) / 1_000_000,
        productIds: [...line.productIds].sort(),
      }))
      .sort((left, right) =>
        left.inventoryItemId.localeCompare(right.inventoryItemId)
      )
  );

const projectPublicStocks = (
  tenantData: DocumentData | undefined,
  catalog: ReturnType<typeof parseInventoryCatalogRecords>,
  compositions: ReturnType<typeof parseInventoryCompositionRecords>
): unknown[] | null => {
  if (!Array.isArray(tenantData?.publicProducts)) return null;
  return tenantData.publicProducts.map((candidate: unknown) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      return candidate;
    }
    const product = candidate as Record<string, unknown>;
    const productId = clean(product.id);
    if (!productId || product.isService === true) {
      return product.isService === true ? { ...product, stock: 0 } : product;
    }
    const available = calculateCompositionAvailableStock(
      catalog,
      compositions[productId]
    );
    return available === null ? product : { ...product, stock: available };
  });
};

export type InventoryQuantityReconciliationAction =
  | 'not-consumed'
  | 'unchanged'
  | 'adjusted';

export const adjustConsumedOrderInventoryQuantities = async (
  tenantId: string,
  orderId: string
): Promise<InventoryQuantityReconciliationAction> =>
  adminDb.runTransaction(async transaction => {
    const orderReference = adminDb.doc(orderPath(tenantId, orderId));
    const tenantReference = adminDb.doc(`tenants/${tenantId}`);
    const ledgerReference = adminDb.doc(ledgerPath(tenantId, orderId));
    const [orderSnapshot, tenantSnapshot, ledgerSnapshot] = await Promise.all([
      transaction.get(orderReference),
      transaction.get(tenantReference),
      transaction.get(ledgerReference),
    ]);
    const ledgerData = ledgerSnapshot.data() as Record<string, unknown> | undefined;
    if (!ledgerSnapshot.exists || clean(ledgerData?.status) !== 'consumed') {
      return 'not-consumed';
    }

    const canonicalStoreId = clean(tenantSnapshot.data()?.canonicalStoreId);
    const inventoryAuthority = inventoryAuthorityFromLedger({
      tenantId,
      canonicalStoreId,
      ledgerData,
    }) ?? legacyTenantInventoryAuthority(tenantId, canonicalStoreId);
    const inventoryReference = adminDb.doc(inventoryAuthority.inventoryDocumentPath);
    const inventorySnapshot = await transaction.get(inventoryReference);

    const inventoryData = inventorySnapshot.data();
    const tenantData = tenantSnapshot.data();
    const catalog = parseInventoryCatalogRecords(
      inventoryData?.catalog ?? inventoryData?.inventoryCatalog
    );
    const compositions = parseInventoryCompositionRecords(
      inventoryData?.compositions ?? inventoryData?.productCompositions
    );
    const optionImpacts = parseOptionInventoryImpacts(
      inventoryData?.optionInventoryImpacts
    );
    const previousLines = parseLedgerLines(ledgerData?.lines);
    const restoredCatalog = applyInventoryConsumptionLines(
      catalog,
      previousLines,
      'restore'
    );
    const desiredLines = buildOrderInventoryConsumptionWithOptions(
      parseOrderItems(orderSnapshot.data()),
      restoredCatalog,
      compositions,
      productCategoriesFromTenant(tenantData),
      optionImpacts
    );

    if (comparableLines(previousLines) === comparableLines(desiredLines)) {
      return 'unchanged';
    }

    const adjustedCatalog = applyInventoryConsumptionLines(
      restoredCatalog,
      desiredLines,
      'consume'
    );
    const publicProducts = projectPublicStocks(
      tenantData,
      adjustedCatalog,
      compositions
    );
    transaction.set(
      inventoryReference,
      {
        catalog: adjustedCatalog,
        inventoryCatalog: adjustedCatalog,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    if (publicProducts) {
      transaction.set(
        tenantReference,
        {
          publicProducts,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }
    transaction.set(
      ledgerReference,
      {
        inventoryAuthorityOwnerUserId: inventoryAuthority.ownerUserId,
        inventoryAuthority: inventoryAuthority.authority,
        inventoryDocumentPath: inventoryAuthority.inventoryDocumentPath,
        canonicalStoreId: inventoryAuthority.canonicalStoreId,
        lines: desiredLines,
        adjustedAt: FieldValue.serverTimestamp(),
        adjustmentReason: 'order_items_changed',
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    transaction.set(
      orderReference,
      {
        inventory: {
          lastAction: 'adjusted',
          authorityOwnerUserId: inventoryAuthority.ownerUserId,
          authority: inventoryAuthority.authority,
          reconciledAt: new Date().toISOString(),
        },
      },
      { merge: true }
    );
    return 'adjusted';
  });

export const reconcileOrderInventoryAfterMutation = async (
  tenantId: string,
  orderId: string
) => {
  const adjustment = await adjustConsumedOrderInventoryQuantities(
    tenantId,
    orderId
  );
  if (adjustment !== 'not-consumed') {
    return { orderId, inventoryAction: adjustment };
  }
  return reconcilePersistedOrderInventory(tenantId, orderId);
};
