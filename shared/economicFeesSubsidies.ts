export const ECONOMIC_ALLOCATION_SCHEMA_VERSION = 1 as const;
export const ECONOMIC_ALLOCATION_CURRENCY = 'BRL' as const;

export type EconomicBurdenBearer =
  | 'customer'
  | 'store'
  | 'kyrub'
  | 'partner';

export type EconomicCostKind =
  | 'provider_processing'
  | 'platform_service'
  | 'other';

export interface EconomicObservedCost {
  id: string;
  kind: EconomicCostKind;
  amountMinor: number;
  borneBy: EconomicBurdenBearer;
  beneficiary: string;
  source: string;
}

export interface EconomicAllocationInput {
  merchandiseGrossMinor: number;
  customerPaidMinor: number;
  deliveryFeeMinor: number;
  storeSubsidyMinor?: number;
  kyrubIncentiveMinor?: number;
  partnerSubsidyMinor?: number;
  observedCosts?: readonly EconomicObservedCost[];
}

export interface MarketplaceEconomicFacts {
  subtotal: number;
  discountTotal: number;
  deliveryFee: number;
  total: number;
  observedCosts?: readonly EconomicObservedCost[];
}

export interface EconomicBurdenTotals {
  customerMinor: number;
  storeMinor: number;
  kyrubMinor: number;
  partnerMinor: number;
}

export interface EconomicAllocationSnapshot {
  schemaVersion: typeof ECONOMIC_ALLOCATION_SCHEMA_VERSION;
  currency: typeof ECONOMIC_ALLOCATION_CURRENCY;
  merchandiseGrossMinor: number;
  customerPaidMinor: number;
  deliveryFeeMinor: number;
  courierRemunerationMinor: number;
  storeSubsidyMinor: number;
  kyrubIncentiveMinor: number;
  partnerSubsidyMinor: number;
  observedCostsMinor: number;
  observedCosts: EconomicObservedCost[];
  burden: EconomicBurdenTotals;
}

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const nonNegativeMinor = (value: number, label: string): number => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`ECONOMIC_ALLOCATION_${label}_INVALID`);
  }
  return value;
};

export const brlNonNegativeToEconomicMinor = (
  amount: number,
  label = 'AMOUNT'
): number => {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error(`ECONOMIC_ALLOCATION_${label}_INVALID`);
  }
  const minor = Math.round(amount * 100);
  if (!Number.isSafeInteger(minor) || minor < 0) {
    throw new Error(`ECONOMIC_ALLOCATION_${label}_INVALID`);
  }
  return minor;
};

const addSafe = (left: number, right: number, label: string): number => {
  const result = left + right;
  if (!Number.isSafeInteger(result)) {
    throw new Error(`ECONOMIC_ALLOCATION_${label}_OVERFLOW`);
  }
  return result;
};

const normalizeObservedCost = (
  cost: EconomicObservedCost,
  index: number
): EconomicObservedCost => {
  const id = clean(cost.id);
  const beneficiary = clean(cost.beneficiary);
  const source = clean(cost.source);
  if (!id || !beneficiary || !source) {
    throw new Error(`ECONOMIC_ALLOCATION_COST_${index}_IDENTITY_INVALID`);
  }
  if (
    cost.kind !== 'provider_processing' &&
    cost.kind !== 'platform_service' &&
    cost.kind !== 'other'
  ) {
    throw new Error(`ECONOMIC_ALLOCATION_COST_${index}_KIND_INVALID`);
  }
  if (
    cost.borneBy !== 'customer' &&
    cost.borneBy !== 'store' &&
    cost.borneBy !== 'kyrub' &&
    cost.borneBy !== 'partner'
  ) {
    throw new Error(`ECONOMIC_ALLOCATION_COST_${index}_BEARER_INVALID`);
  }
  return {
    id,
    kind: cost.kind,
    amountMinor: nonNegativeMinor(cost.amountMinor, `COST_${index}_AMOUNT`),
    borneBy: cost.borneBy,
    beneficiary,
    source,
  };
};

export const buildEconomicAllocationSnapshot = (
  input: EconomicAllocationInput
): EconomicAllocationSnapshot => {
  const merchandiseGrossMinor = nonNegativeMinor(
    input.merchandiseGrossMinor,
    'MERCHANDISE_GROSS'
  );
  const customerPaidMinor = nonNegativeMinor(
    input.customerPaidMinor,
    'CUSTOMER_PAID'
  );
  const deliveryFeeMinor = nonNegativeMinor(
    input.deliveryFeeMinor,
    'DELIVERY_FEE'
  );
  const storeSubsidyMinor = nonNegativeMinor(
    input.storeSubsidyMinor ?? 0,
    'STORE_SUBSIDY'
  );
  const kyrubIncentiveMinor = nonNegativeMinor(
    input.kyrubIncentiveMinor ?? 0,
    'KYRUB_INCENTIVE'
  );
  const partnerSubsidyMinor = nonNegativeMinor(
    input.partnerSubsidyMinor ?? 0,
    'PARTNER_SUBSIDY'
  );
  const observedCosts = (input.observedCosts ?? []).map(normalizeObservedCost);

  const subsidyTotalMinor = [
    storeSubsidyMinor,
    kyrubIncentiveMinor,
    partnerSubsidyMinor,
  ].reduce(
    (sum, value) => addSafe(sum, value, 'SUBSIDY_TOTAL'),
    0
  );
  const expectedCustomerPaidMinor =
    merchandiseGrossMinor - subsidyTotalMinor + deliveryFeeMinor;
  if (
    expectedCustomerPaidMinor < 0 ||
    customerPaidMinor !== expectedCustomerPaidMinor
  ) {
    throw new Error('ECONOMIC_ALLOCATION_FUNDING_MISMATCH');
  }

  const burden: EconomicBurdenTotals = {
    customerMinor: customerPaidMinor,
    storeMinor: storeSubsidyMinor,
    kyrubMinor: kyrubIncentiveMinor,
    partnerMinor: partnerSubsidyMinor,
  };
  let observedCostsMinor = 0;
  for (const cost of observedCosts) {
    observedCostsMinor = addSafe(
      observedCostsMinor,
      cost.amountMinor,
      'OBSERVED_COSTS'
    );
    const key = `${cost.borneBy}Minor` as keyof EconomicBurdenTotals;
    burden[key] = addSafe(burden[key], cost.amountMinor, 'BURDEN');
  }

  return {
    schemaVersion: ECONOMIC_ALLOCATION_SCHEMA_VERSION,
    currency: ECONOMIC_ALLOCATION_CURRENCY,
    merchandiseGrossMinor,
    customerPaidMinor,
    deliveryFeeMinor,
    // Contractual invariant: the delivery charge is not Kyrub revenue.
    // Its entire value is economically destined to courier remuneration.
    courierRemunerationMinor: deliveryFeeMinor,
    storeSubsidyMinor,
    kyrubIncentiveMinor,
    partnerSubsidyMinor,
    observedCostsMinor,
    observedCosts,
    burden,
  };
};

export const buildMarketplaceEconomicAllocationSnapshot = (
  facts: MarketplaceEconomicFacts
): EconomicAllocationSnapshot => {
  const merchandiseGrossMinor = brlNonNegativeToEconomicMinor(
    facts.subtotal,
    'MARKETPLACE_SUBTOTAL'
  );
  const storeSubsidyMinor = brlNonNegativeToEconomicMinor(
    facts.discountTotal,
    'MARKETPLACE_DISCOUNT'
  );
  const deliveryFeeMinor = brlNonNegativeToEconomicMinor(
    facts.deliveryFee,
    'MARKETPLACE_DELIVERY_FEE'
  );
  const customerPaidMinor = brlNonNegativeToEconomicMinor(
    facts.total,
    'MARKETPLACE_TOTAL'
  );

  return buildEconomicAllocationSnapshot({
    merchandiseGrossMinor,
    customerPaidMinor,
    deliveryFeeMinor,
    // Current store promotions are store-funded. Kyrub and partner incentives
    // remain explicit zero until their own immutable funding snapshots exist.
    storeSubsidyMinor,
    kyrubIncentiveMinor: 0,
    partnerSubsidyMinor: 0,
    observedCosts: facts.observedCosts,
  });
};
