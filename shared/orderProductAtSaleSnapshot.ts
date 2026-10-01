import {
  buildOrderProductCommercialSnapshots,
  buildOrderProductMarginTargetSnapshots,
  type OrderProductCommercialSnapshot,
  type OrderProductMarginTargetSnapshot,
  type ProductAwareOrderItem,
} from './orderProductProfitability.js';

export const ORDER_PRODUCT_AT_SALE_SNAPSHOT_VERSION = 1 as const;

export interface OrderProductAtSaleSnapshot {
  schemaVersion: typeof ORDER_PRODUCT_AT_SALE_SNAPSHOT_VERSION;
  capturedAt: string;
  capturedForStatus: string;
  commercialLines: OrderProductCommercialSnapshot[];
  marginTargets: OrderProductMarginTargetSnapshot[];
}

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const nullableMinor = (value: unknown): value is number | null =>
  value === null || (
    typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
  );

const validCommercialLine = (value: unknown): value is OrderProductCommercialSnapshot => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const line = value as Record<string, unknown>;
  return Boolean(clean(line.lineId))
    && Boolean(clean(line.productId))
    && Boolean(clean(line.name))
    && typeof line.orderedQuantity === 'number'
    && Number.isInteger(line.orderedQuantity)
    && line.orderedQuantity > 0
    && typeof line.operationalQuantity === 'number'
    && Number.isInteger(line.operationalQuantity)
    && line.operationalQuantity >= 0
    && nullableMinor(line.unitPriceMinor)
    && nullableMinor(line.grossMinor)
    && nullableMinor(line.discountMinor)
    && nullableMinor(line.merchandiseRevenueMinor)
    && (line.commercialStatus === 'complete' || line.commercialStatus === 'incomplete');
};

const validMarginTarget = (value: unknown): value is OrderProductMarginTargetSnapshot => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const target = value as Record<string, unknown>;
  return Boolean(clean(target.productId))
    && typeof target.targetMarginPercent === 'number'
    && Number.isFinite(target.targetMarginPercent)
    && target.targetMarginPercent >= 0
    && target.targetMarginPercent < 100
    && typeof target.updatedAt === 'string';
};

export const buildOrderProductAtSaleSnapshot = (input: {
  orderItems: ProductAwareOrderItem[];
  rawPricingSettings: unknown;
  capturedAt: string;
  capturedForStatus: string;
}): OrderProductAtSaleSnapshot => {
  const commercialLines = buildOrderProductCommercialSnapshots(input.orderItems);
  return {
    schemaVersion: ORDER_PRODUCT_AT_SALE_SNAPSHOT_VERSION,
    capturedAt: clean(input.capturedAt),
    capturedForStatus: clean(input.capturedForStatus),
    commercialLines,
    marginTargets: buildOrderProductMarginTargetSnapshots(
      input.rawPricingSettings,
      commercialLines.map(line => line.productId)
    ),
  };
};

export const parseOrderProductAtSaleSnapshot = (
  value: unknown
): OrderProductAtSaleSnapshot | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const snapshot = value as Record<string, unknown>;
  if (
    snapshot.schemaVersion !== ORDER_PRODUCT_AT_SALE_SNAPSHOT_VERSION
    || !clean(snapshot.capturedAt)
    || !clean(snapshot.capturedForStatus)
    || !Array.isArray(snapshot.commercialLines)
    || !snapshot.commercialLines.every(validCommercialLine)
    || !Array.isArray(snapshot.marginTargets)
    || !snapshot.marginTargets.every(validMarginTarget)
  ) return null;
  return snapshot as unknown as OrderProductAtSaleSnapshot;
};
