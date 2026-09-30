import { createHash } from 'node:crypto';
import { adminDb } from '../firebaseAdmin.js';
import {
  buildOrderProductCommercialSnapshots,
  buildOrderProductMarginTargetSnapshots,
  deriveStoreProductProfitabilityRows,
  type OrderProductCommercialSnapshot,
  type OrderProductMarginTargetSnapshot,
  type ProductAwareInventoryConsumptionLine,
  type ProductAwareOrderItem,
  type StoreProductProfitabilityRow,
} from '../../shared/orderProductProfitability.js';
import { reconcileStoreOrderProfitability } from './storeOrderProfitabilityService.js';

const MAX_PRODUCT_ORDERS = 40;

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const finiteNonNegative = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null;

const finitePositiveInteger = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : null;

const sourceProductId = (configuredProductId: string, explicitSource: unknown): string =>
  clean(explicitSource) || configuredProductId.split('::', 1)[0]?.trim() || configuredProductId;

const parseOrderItems = (value: unknown): ProductAwareOrderItem[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate, index) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return [];
    const item = candidate as Record<string, unknown>;
    const configuredProductId = clean(item.productId);
    const productId = sourceProductId(configuredProductId, item.sourceProductId);
    const name = clean(item.name);
    const quantity = finitePositiveInteger(item.quantity);
    if (!productId || !name || quantity === null) return [];
    const transferredQuantity =
      typeof item.transferredQuantity === 'number' &&
      Number.isInteger(item.transferredQuantity) &&
      item.transferredQuantity >= 0
        ? item.transferredQuantity
        : 0;
    const price = finiteNonNegative(item.price);
    const discountAmount = finiteNonNegative(item.discountAmount);
    return [{
      productId,
      name,
      quantity,
      transferredQuantity,
      lineId: clean(item.lineId) || `line-${index + 1}`,
      ...(price !== null ? { price } : {}),
      ...(discountAmount !== null ? { discountAmount } : {}),
    } satisfies ProductAwareOrderItem];
  });
};

const parseProductCostLines = (value: unknown): ProductAwareInventoryConsumptionLine[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap(candidate => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return [];
    const line = candidate as Record<string, unknown>;
    const inventoryItemId = clean(line.inventoryItemId);
    const quantity = finiteNonNegative(line.quantity);
    if (!inventoryItemId || quantity === null || quantity <= 0) return [];
    const productCostAllocations = Array.isArray(line.productCostAllocations)
      ? line.productCostAllocations.flatMap(raw => {
          if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
          const allocation = raw as Record<string, unknown>;
          const productId = clean(allocation.productId);
          const allocatedQuantity = finiteNonNegative(allocation.quantity);
          const totalCostMinor =
            typeof allocation.totalCostMinor === 'number' &&
            Number.isSafeInteger(allocation.totalCostMinor) &&
            allocation.totalCostMinor >= 0
              ? allocation.totalCostMinor
              : null;
          if (!productId || allocatedQuantity === null || allocatedQuantity <= 0) return [];
          return [{
            productId,
            quantity: allocatedQuantity,
            costBasisStatus:
              allocation.costBasisStatus === 'complete' && totalCostMinor !== null
                ? 'complete' as const
                : 'incomplete' as const,
            totalCostMinor,
          }];
        })
      : [];
    return [{
      inventoryItemId,
      inventoryItemName: clean(line.inventoryItemName),
      unit: clean(line.unit),
      quantity,
      beforeQuantity: finiteNonNegative(line.beforeQuantity) ?? 0,
      afterQuantity: finiteNonNegative(line.afterQuantity) ?? 0,
      productIds: Array.isArray(line.productIds)
        ? line.productIds.map(clean).filter(Boolean)
        : [],
      productCostAllocations,
      costBasisStatus:
        line.costBasisStatus === 'complete' ? 'complete' : 'incomplete',
      unitCostMinor:
        typeof line.unitCostMinor === 'number' && Number.isFinite(line.unitCostMinor)
          ? line.unitCostMinor
          : null,
      totalCostMinor:
        typeof line.totalCostMinor === 'number' && Number.isSafeInteger(line.totalCostMinor)
          ? line.totalCostMinor
          : null,
    } satisfies ProductAwareInventoryConsumptionLine];
  });
};

type ProductInventoryEvidence = {
  ledgerId: string;
  tenantId: string;
  inventoryDocumentPath: string;
  status: 'consumed' | 'reversed' | 'skipped' | 'missing';
  lines: ProductAwareInventoryConsumptionLine[];
};

const inventoryEvidenceForOrder = async (
  storeId: string,
  orderId: string
): Promise<ProductInventoryEvidence | null> => {
  const snapshot = await adminDb
    .collection('inventoryOrderConsumptions')
    .where('canonicalStoreId', '==', storeId)
    .where('orderId', '==', orderId)
    .limit(2)
    .get();
  if (snapshot.empty) return null;
  if (snapshot.size !== 1) throw new Error('STORE_PRODUCT_PROFITABILITY_INVENTORY_CONFLICT');
  const document = snapshot.docs[0];
  if (!document) return null;
  const data = document.data();
  const status =
    data.status === 'consumed' || data.status === 'reversed' || data.status === 'skipped'
      ? data.status
      : 'missing';
  return {
    ledgerId: document.id,
    tenantId: clean(data.tenantId),
    inventoryDocumentPath: clean(data.inventoryDocumentPath),
    status,
    lines: parseProductCostLines(data.lines),
  };
};

const sumKnown = (values: Array<number | null>): number | null => {
  if (values.some(value => value === null)) return null;
  const total = values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  if (!Number.isSafeInteger(total)) throw new Error('STORE_PRODUCT_PROFITABILITY_OVERFLOW');
  return total;
};

const commercialReconciles = (
  lines: OrderProductCommercialSnapshot[],
  orderProfitability: {
    merchandiseGrossMinor: number | null;
    storeDiscountMinor: number | null;
    merchandiseRevenueMinor: number | null;
  }
): boolean => {
  const gross = sumKnown(lines.map(line => line.grossMinor));
  const discount = sumKnown(lines.map(line => line.discountMinor));
  const revenue = sumKnown(lines.map(line => line.merchandiseRevenueMinor));
  return (
    gross !== null &&
    discount !== null &&
    revenue !== null &&
    gross === orderProfitability.merchandiseGrossMinor &&
    discount === orderProfitability.storeDiscountMinor &&
    revenue === orderProfitability.merchandiseRevenueMinor
  );
};

const cmvReconciles = (
  lines: ProductAwareInventoryConsumptionLine[],
  expectedCmvMinor: number | null
): boolean => {
  if (expectedCmvMinor === null) return false;
  const allocations = lines.flatMap(line => line.productCostAllocations ?? []);
  if (allocations.length === 0) return false;
  if (allocations.some(allocation =>
    allocation.costBasisStatus !== 'complete' ||
    allocation.totalCostMinor === null ||
    !Number.isSafeInteger(allocation.totalCostMinor)
  )) return false;
  return allocations.reduce((sum, allocation) => sum + (allocation.totalCostMinor ?? 0), 0)
    === expectedCmvMinor;
};

const productSnapshotPath = (storeId: string, orderId: string): string =>
  `stores/${storeId}/orderProductProfitability/${encodeURIComponent(orderId)}`;

type PersistedProductOrderSnapshot = {
  schemaVersion: 1;
  storeId: string;
  orderId: string;
  sourceFingerprint: string;
  sourceOrderProfitabilityFingerprint: string;
  sourceInventoryLedgerId: string;
  commercialLines: OrderProductCommercialSnapshot[];
  marginTargets: OrderProductMarginTargetSnapshot[];
  rows: StoreProductProfitabilityRow[];
  calculatedAt: string;
};

const parseExisting = (value: unknown): PersistedProductOrderSnapshot | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Partial<PersistedProductOrderSnapshot>;
  if (
    record.schemaVersion !== 1 ||
    !clean(record.storeId) ||
    !clean(record.orderId) ||
    !clean(record.sourceFingerprint) ||
    !Array.isArray(record.commercialLines) ||
    !Array.isArray(record.marginTargets) ||
    !Array.isArray(record.rows) ||
    !clean(record.calculatedAt)
  ) return null;
  return record as PersistedProductOrderSnapshot;
};

const historicalTargets = (
  rawSettings: unknown,
  productIds: string[],
  occurredAt: string
): OrderProductMarginTargetSnapshot[] =>
  buildOrderProductMarginTargetSnapshots(rawSettings, productIds).filter(target =>
    Boolean(target.updatedAt) &&
    Number.isFinite(Date.parse(target.updatedAt)) &&
    Date.parse(target.updatedAt) <= Date.parse(occurredAt)
  );

const fingerprintFor = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

const reconcileProductOrder = async (input: {
  storeId: string;
  orderProfitability: {
    orderId: string;
    occurredAt: string;
    inventoryState: 'consumed' | 'reversed' | 'skipped' | 'missing';
    merchandiseGrossMinor: number | null;
    storeDiscountMinor: number | null;
    merchandiseRevenueMinor: number | null;
    saleCmvMinor: number | null;
    sourceInventoryLedgerId: string;
    sourceFingerprint: string;
  };
}): Promise<PersistedProductOrderSnapshot> => {
  const order = input.orderProfitability;
  const inventoryEvidence = await inventoryEvidenceForOrder(input.storeId, order.orderId);
  const ref = adminDb.doc(productSnapshotPath(input.storeId, order.orderId));
  const existing = parseExisting((await ref.get()).data());

  let commercialLines = existing?.commercialLines ?? [];
  if (commercialLines.length === 0 && inventoryEvidence?.tenantId) {
    const orderDocument = await adminDb
      .doc(`artifacts/${inventoryEvidence.tenantId}/public/data/customerOrders/${order.orderId}`)
      .get();
    const candidate = buildOrderProductCommercialSnapshots(
      parseOrderItems(orderDocument.data()?.items)
    );
    if (commercialReconciles(candidate, order)) commercialLines = candidate;
  }

  let marginTargets = existing?.marginTargets ?? [];
  if (
    marginTargets.length === 0 &&
    inventoryEvidence?.inventoryDocumentPath &&
    commercialLines.length > 0
  ) {
    const inventoryDocument = await adminDb.doc(inventoryEvidence.inventoryDocumentPath).get();
    marginTargets = historicalTargets(
      inventoryDocument.data()?.productPricingSettings,
      commercialLines.map(line => line.productId),
      order.occurredAt
    );
  }

  const inventoryLines =
    inventoryEvidence && cmvReconciles(inventoryEvidence.lines, order.saleCmvMinor)
      ? inventoryEvidence.lines
      : [];
  const rows = deriveStoreProductProfitabilityRows({
    inventoryState: order.inventoryState,
    commercialLines,
    inventoryLines,
    marginTargets,
  });
  const sourceFingerprint = fingerprintFor({
    orderProfitability: order.sourceFingerprint,
    sourceInventoryLedgerId: inventoryEvidence?.ledgerId ?? '',
    commercialLines,
    marginTargets,
    inventoryLines: inventoryLines.map(line => ({
      inventoryItemId: line.inventoryItemId,
      productCostAllocations: line.productCostAllocations ?? [],
    })),
  });
  const calculatedAt =
    existing?.sourceFingerprint === sourceFingerprint
      ? existing.calculatedAt
      : new Date().toISOString();
  const persisted: PersistedProductOrderSnapshot = {
    schemaVersion: 1,
    storeId: input.storeId,
    orderId: order.orderId,
    sourceFingerprint,
    sourceOrderProfitabilityFingerprint: order.sourceFingerprint,
    sourceInventoryLedgerId: inventoryEvidence?.ledgerId ?? '',
    commercialLines,
    marginTargets,
    rows,
    calculatedAt,
  };
  if (!existing || existing.sourceFingerprint !== sourceFingerprint) {
    await ref.set(persisted, { merge: false });
  }
  return persisted;
};

export type StoreProductProfitabilityOverview = {
  storeId: string;
  currency: 'BRL';
  orders: PersistedProductOrderSnapshot[];
  products: Array<{
    productId: string;
    name: string;
    orderCount: number;
    soldQuantity: number;
    merchandiseRevenueMinor: number | null;
    saleCmvMinor: number | null;
    grossContributionMinor: number | null;
    realizedMarginPercent: number | null;
    targetMarginPercent: number | null;
    marginGapPercentagePoints: number | null;
    completeOrderCount: number;
    partialOrderCount: number;
  }>;
};

export const reconcileStoreProductProfitability = async (
  storeIdValue: string
): Promise<StoreProductProfitabilityOverview> => {
  const storeId = clean(storeIdValue);
  if (!storeId) throw new Error('STORE_ORDER_PROFITABILITY_STORE_REQUIRED');
  const orderOverview = await reconcileStoreOrderProfitability(storeId);
  const orderSources = orderOverview.items.slice(0, MAX_PRODUCT_ORDERS).map(item => ({
    orderId: item.orderId,
    occurredAt: item.occurredAt,
    inventoryState: item.inventoryState,
    merchandiseGrossMinor: item.merchandiseGrossMinor,
    storeDiscountMinor: item.storeDiscountMinor,
    merchandiseRevenueMinor: item.merchandiseRevenueMinor,
    saleCmvMinor: item.saleCmvMinor,
    sourceInventoryLedgerId: item.sourceInventoryLedgerId,
    sourceFingerprint: item.sourceFingerprint,
  }));
  const orders = await Promise.all(
    orderSources.map(orderProfitability =>
      reconcileProductOrder({ storeId, orderProfitability })
    )
  );

  const byProduct = new Map<string, StoreProductProfitabilityRow[]>();
  for (const order of orders) {
    for (const row of order.rows) {
      const current = byProduct.get(row.productId) ?? [];
      current.push(row);
      byProduct.set(row.productId, current);
    }
  }

  const products = [...byProduct.entries()].map(([productId, rows]) => {
    const complete = rows.filter(row => row.dataStatus === 'complete');
    const allRevenueKnown = complete.length > 0 && complete.every(row => row.merchandiseRevenueMinor !== null);
    const allCmvKnown = complete.length > 0 && complete.every(row => row.saleCmvMinor !== null);
    const revenue = allRevenueKnown
      ? complete.reduce((sum, row) => sum + (row.merchandiseRevenueMinor ?? 0), 0)
      : null;
    const cmv = allCmvKnown
      ? complete.reduce((sum, row) => sum + (row.saleCmvMinor ?? 0), 0)
      : null;
    const contribution = revenue !== null && cmv !== null ? revenue - cmv : null;
    const targetValues = complete
      .map(row => row.targetMarginPercent)
      .filter((value): value is number => value !== null);
    const targetMarginPercent = targetValues.length > 0
      && targetValues.every(value => Math.abs(value - targetValues[0]) < 0.000001)
        ? targetValues[0]
        : null;
    const realizedMarginPercent =
      contribution !== null && revenue !== null && revenue > 0
        ? contribution / revenue * 100
        : null;
    return {
      productId,
      name: rows.find(row => row.name)?.name ?? productId,
      orderCount: rows.length,
      soldQuantity: rows.reduce((sum, row) => sum + row.soldQuantity, 0),
      merchandiseRevenueMinor: revenue,
      saleCmvMinor: cmv,
      grossContributionMinor: contribution,
      realizedMarginPercent,
      targetMarginPercent,
      marginGapPercentagePoints:
        realizedMarginPercent !== null && targetMarginPercent !== null
          ? realizedMarginPercent - targetMarginPercent
          : null,
      completeOrderCount: complete.length,
      partialOrderCount: rows.length - complete.length,
    };
  }).sort((left, right) =>
    (right.merchandiseRevenueMinor ?? -1) - (left.merchandiseRevenueMinor ?? -1)
    || left.name.localeCompare(right.name, 'pt-BR')
  );

  return { storeId, currency: 'BRL', orders, products };
};
