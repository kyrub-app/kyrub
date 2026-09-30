import type { InventoryConsumptionLine } from './inventoryConsumption.js';
import type { OptionAwareInventoryOrderItem } from './optionInventoryImpact.js';

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const safeNonNegativeMinor = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;

const moneyToMinor = (value: unknown): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  const minor = Math.round(value * 100);
  return Number.isSafeInteger(minor) && minor >= 0 ? minor : null;
};

const safeAdd = (left: number, right: number): number => {
  const result = left + right;
  if (!Number.isSafeInteger(result)) {
    throw new Error('ORDER_PRODUCT_PROFITABILITY_OVERFLOW');
  }
  return result;
};

export interface ProductAwareOrderItem extends OptionAwareInventoryOrderItem {
  lineId?: string;
  price?: number;
  discountAmount?: number;
}

export interface ProductAwareInventoryConsumptionLine extends InventoryConsumptionLine {}

export interface OrderProductCommercialSnapshot {
  lineId: string;
  productId: string;
  name: string;
  orderedQuantity: number;
  operationalQuantity: number;
  unitPriceMinor: number | null;
  grossMinor: number | null;
  discountMinor: number | null;
  merchandiseRevenueMinor: number | null;
  commercialStatus: 'complete' | 'incomplete';
}

export interface OrderProductMarginTargetSnapshot {
  productId: string;
  targetMarginPercent: number;
  updatedAt: string;
}

export type ProductProfitabilityFinancialState =
  | 'captured'
  | 'refunded'
  | 'charged_back'
  | 'chargeback_reversed'
  | 'mixed';

export type StoreProductProfitabilityIssue =
  | 'commercial_evidence_missing'
  | 'cmv_evidence_missing'
  | 'cmv_evidence_incomplete'
  | 'target_margin_missing';

export interface StoreProductProfitabilityRow {
  productId: string;
  name: string;
  soldQuantity: number;
  merchandiseGrossMinor: number | null;
  storeDiscountMinor: number | null;
  merchandiseRevenueMinor: number | null;
  saleCmvMinor: number | null;
  activeInventoryCmvMinor: number | null;
  grossContributionMinor: number | null;
  realizedMarginPercent: number | null;
  targetMarginPercent: number | null;
  targetMarginUpdatedAt: string;
  marginGapPercentagePoints: number | null;
  effectiveMarginAvailable: boolean;
  dataStatus: 'complete' | 'partial';
  issues: StoreProductProfitabilityIssue[];
}

export const buildOrderProductCommercialSnapshots = (
  orderItems: ProductAwareOrderItem[]
): OrderProductCommercialSnapshot[] =>
  orderItems.map((item, index): OrderProductCommercialSnapshot => {
    const orderedQuantity = Math.max(0, Math.trunc(item.quantity));
    const operationalQuantity = Math.max(
      0,
      orderedQuantity - Math.trunc(item.transferredQuantity ?? 0)
    );
    const unitPriceMinor = moneyToMinor(item.price);
    const discountMinor = moneyToMinor(item.discountAmount);
    const grossMinor = unitPriceMinor === null
      ? null
      : unitPriceMinor * operationalQuantity;
    if (grossMinor !== null && !Number.isSafeInteger(grossMinor)) {
      throw new Error('ORDER_PRODUCT_PROFITABILITY_COMMERCIAL_OVERFLOW');
    }
    const validDiscount =
      discountMinor !== null && grossMinor !== null && discountMinor <= grossMinor
        ? discountMinor
        : null;
    const merchandiseRevenueMinor = grossMinor !== null && validDiscount !== null
      ? grossMinor - validDiscount
      : null;
    const complete =
      unitPriceMinor !== null &&
      grossMinor !== null &&
      validDiscount !== null &&
      merchandiseRevenueMinor !== null;
    return {
      lineId: clean(item.lineId) || `line-${index + 1}`,
      productId: clean(item.productId),
      name: clean(item.name),
      orderedQuantity,
      operationalQuantity,
      unitPriceMinor,
      grossMinor,
      discountMinor: validDiscount,
      merchandiseRevenueMinor,
      commercialStatus: complete ? 'complete' : 'incomplete',
    };
  }).filter(line => line.productId && line.name && line.orderedQuantity > 0);

export const buildOrderProductMarginTargetSnapshots = (
  rawSettings: unknown,
  productIds: readonly string[]
): OrderProductMarginTargetSnapshot[] => {
  if (!rawSettings || typeof rawSettings !== 'object' || Array.isArray(rawSettings)) return [];
  const settings = rawSettings as Record<string, unknown>;
  return [...new Set(productIds.map(clean).filter(Boolean))].flatMap(productId => {
    const raw = settings[productId];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
    const record = raw as Record<string, unknown>;
    const target = typeof record.targetMarginPercent === 'number'
      && Number.isFinite(record.targetMarginPercent)
      && record.targetMarginPercent >= 0
      && record.targetMarginPercent < 100
      ? record.targetMarginPercent
      : null;
    if (target === null) return [];
    return [{
      productId,
      targetMarginPercent: target,
      updatedAt: clean(record.updatedAt),
    }];
  });
};

export const deriveStoreProductProfitabilityRows = (input: {
  inventoryState: 'consumed' | 'reversed' | 'skipped' | 'missing';
  financialState: ProductProfitabilityFinancialState;
  commercialLines?: readonly OrderProductCommercialSnapshot[];
  inventoryLines?: readonly ProductAwareInventoryConsumptionLine[];
  marginTargets?: readonly OrderProductMarginTargetSnapshot[];
}): StoreProductProfitabilityRow[] => {
  const commercialLines = input.commercialLines ?? [];
  const inventoryLines = input.inventoryLines ?? [];
  const marginTargets = new Map(
    (input.marginTargets ?? []).map(target => [target.productId, target])
  );
  const productIds = new Set<string>();
  for (const line of commercialLines) productIds.add(line.productId);
  for (const line of inventoryLines) {
    for (const allocation of line.productCostAllocations ?? []) {
      productIds.add(allocation.productId);
    }
  }

  return [...productIds].sort().map(productId => {
    const commercial = commercialLines.filter(line => line.productId === productId);
    const costAllocations = inventoryLines.flatMap(line =>
      (line.productCostAllocations ?? []).filter(allocation => allocation.productId === productId)
    );
    const issues: StoreProductProfitabilityIssue[] = [];
    const commercialComplete =
      commercial.length > 0 && commercial.every(line => line.commercialStatus === 'complete');
    if (!commercialComplete) issues.push('commercial_evidence_missing');

    const cmvComplete =
      costAllocations.length > 0 &&
      costAllocations.every(allocation =>
        allocation.costBasisStatus === 'complete' &&
        safeNonNegativeMinor(allocation.totalCostMinor) !== null
      );
    if (costAllocations.length === 0) issues.push('cmv_evidence_missing');
    else if (!cmvComplete) issues.push('cmv_evidence_incomplete');

    const target = marginTargets.get(productId) ?? null;
    if (!target) issues.push('target_margin_missing');

    let merchandiseGrossMinor: number | null = commercialComplete ? 0 : null;
    let storeDiscountMinor: number | null = commercialComplete ? 0 : null;
    let merchandiseRevenueMinor: number | null = commercialComplete ? 0 : null;
    let soldQuantity = 0;
    let name = '';
    for (const line of commercial) {
      soldQuantity += line.operationalQuantity;
      name ||= line.name;
      if (commercialComplete) {
        merchandiseGrossMinor = safeAdd(merchandiseGrossMinor ?? 0, line.grossMinor ?? 0);
        storeDiscountMinor = safeAdd(storeDiscountMinor ?? 0, line.discountMinor ?? 0);
        merchandiseRevenueMinor = safeAdd(
          merchandiseRevenueMinor ?? 0,
          line.merchandiseRevenueMinor ?? 0
        );
      }
    }

    let saleCmvMinor: number | null = cmvComplete ? 0 : null;
    if (cmvComplete) {
      for (const allocation of costAllocations) {
        saleCmvMinor = safeAdd(saleCmvMinor ?? 0, allocation.totalCostMinor ?? 0);
      }
    }
    const activeInventoryCmvMinor = saleCmvMinor === null
      ? null
      : input.inventoryState === 'reversed' ? 0 : saleCmvMinor;
    const grossContributionMinor =
      merchandiseRevenueMinor !== null && saleCmvMinor !== null
        ? merchandiseRevenueMinor - saleCmvMinor
        : null;
    const realizedMarginPercent =
      grossContributionMinor !== null && merchandiseRevenueMinor !== null && merchandiseRevenueMinor > 0
        ? (grossContributionMinor / merchandiseRevenueMinor) * 100
        : null;
    const targetMarginPercent = target?.targetMarginPercent ?? null;
    const marginGapPercentagePoints =
      realizedMarginPercent !== null && targetMarginPercent !== null
        ? realizedMarginPercent - targetMarginPercent
        : null;
    const financialStateSupportsEffectiveMargin =
      input.financialState === 'captured' || input.financialState === 'chargeback_reversed';

    return {
      productId,
      name: name || productId,
      soldQuantity,
      merchandiseGrossMinor,
      storeDiscountMinor,
      merchandiseRevenueMinor,
      saleCmvMinor,
      activeInventoryCmvMinor,
      grossContributionMinor,
      realizedMarginPercent,
      targetMarginPercent,
      targetMarginUpdatedAt: target?.updatedAt ?? '',
      marginGapPercentagePoints,
      effectiveMarginAvailable:
        realizedMarginPercent !== null
        && input.inventoryState === 'consumed'
        && financialStateSupportsEffectiveMargin,
      dataStatus: issues.some(issue => issue !== 'target_margin_missing') ? 'partial' : 'complete',
      issues,
    };
  });
};
