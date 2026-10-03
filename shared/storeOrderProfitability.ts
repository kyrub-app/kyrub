import type { EconomicAllocationSnapshot } from './economicFeesSubsidies.js';
import type { StoreEconomicLedgerEntry } from './storeEconomicLedger.js';

export const STORE_ORDER_PROFITABILITY_SCHEMA_VERSION = 1 as const;
export const STORE_ORDER_PROFITABILITY_CURRENCY = 'BRL' as const;

export type StoreOrderProfitabilityDataStatus = 'complete' | 'partial';
export type StoreOrderProfitabilityFinancialState =
  | 'captured'
  | 'refunded'
  | 'charged_back'
  | 'chargeback_reversed'
  | 'mixed';
export type StoreOrderProfitabilityInventoryState =
  | 'consumed'
  | 'reversed'
  | 'skipped'
  | 'missing';

export type StoreOrderProfitabilityIssue =
  | 'economic_allocation_missing'
  | 'economic_allocation_conflict'
  | 'cmv_missing'
  | 'cmv_incomplete'
  | 'inventory_not_consumed'
  | 'financial_lifecycle_complex';

export interface StoreOrderInventoryCostEvidence {
  ledgerId: string;
  status: StoreOrderProfitabilityInventoryState;
  lines: Array<{
    inventoryItemId: string;
    totalCostMinor: number | null;
    costBasisStatus: 'complete' | 'incomplete';
  }>;
}

export interface StoreOrderProfitabilitySnapshot {
  schemaVersion: typeof STORE_ORDER_PROFITABILITY_SCHEMA_VERSION;
  currency: typeof STORE_ORDER_PROFITABILITY_CURRENCY;
  storeId: string;
  orderId: string;
  dataStatus: StoreOrderProfitabilityDataStatus;
  issues: StoreOrderProfitabilityIssue[];
  financialState: StoreOrderProfitabilityFinancialState;
  inventoryState: StoreOrderProfitabilityInventoryState;
  merchandiseGrossMinor: number | null;
  storeDiscountMinor: number | null;
  merchandiseRevenueMinor: number | null;
  deliveryFeeMinor: number | null;
  customerPaidMinor: number | null;
  storeObservedVariableCostsMinor: number | null;
  saleCmvMinor: number | null;
  activeInventoryCmvMinor: number | null;
  contributionBeforeObservedCostsMinor: number | null;
  contributionMinor: number | null;
  contributionMarginPercent: number | null;
  paymentCapturedMinor: number;
  paymentRefundedMinor: number;
  paymentChargedBackMinor: number;
  paymentChargebackReversedMinor: number;
  paymentNetMinor: number;
  effectiveMarginAvailable: boolean;
  sourceEconomicEntryIds: string[];
  sourceInventoryLedgerId: string;
  occurredAt: string;
  calculatedAt: string;
}

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const safeNonNegativeInteger = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;

const safeAdd = (left: number, right: number): number => {
  const result = left + right;
  if (!Number.isSafeInteger(result)) {
    throw new Error('STORE_ORDER_PROFITABILITY_OVERFLOW');
  }
  return result;
};

const allocationFingerprint = (allocation: EconomicAllocationSnapshot): string =>
  JSON.stringify({
    schemaVersion: allocation.schemaVersion,
    currency: allocation.currency,
    merchandiseGrossMinor: allocation.merchandiseGrossMinor,
    customerPaidMinor: allocation.customerPaidMinor,
    deliveryFeeMinor: allocation.deliveryFeeMinor,
    courierRemunerationMinor: allocation.courierRemunerationMinor,
    storeSubsidyMinor: allocation.storeSubsidyMinor,
    kyrubIncentiveMinor: allocation.kyrubIncentiveMinor,
    partnerSubsidyMinor: allocation.partnerSubsidyMinor,
    observedCostsMinor: allocation.observedCostsMinor,
    observedCosts: allocation.observedCosts.map(cost => ({
      id: cost.id,
      kind: cost.kind,
      amountMinor: cost.amountMinor,
      borneBy: cost.borneBy,
      beneficiary: cost.beneficiary,
      source: cost.source,
    })),
  });

const uniqueCaptureAllocation = (
  entries: readonly StoreEconomicLedgerEntry[]
): { allocation: EconomicAllocationSnapshot | null; conflict: boolean } => {
  const captures = entries.filter(entry => entry.kind === 'payment_capture');
  const withAllocation = captures.flatMap(entry =>
    entry.economicAllocation ? [entry.economicAllocation] : []
  );
  if (withAllocation.length === 0) return { allocation: null, conflict: false };

  const byFingerprint = new Map<string, EconomicAllocationSnapshot>();
  for (const allocation of withAllocation) {
    byFingerprint.set(allocationFingerprint(allocation), allocation);
  }
  if (byFingerprint.size !== 1) return { allocation: null, conflict: true };
  return { allocation: [...byFingerprint.values()][0] ?? null, conflict: false };
};

const deriveFinancialLifecycle = (
  entries: readonly StoreEconomicLedgerEntry[]
): {
  state: StoreOrderProfitabilityFinancialState;
  capturedMinor: number;
  refundedMinor: number;
  chargedBackMinor: number;
  chargebackReversedMinor: number;
  netMinor: number;
  complex: boolean;
} => {
  let capturedMinor = 0;
  let refundedMinor = 0;
  let chargedBackMinor = 0;
  let chargebackReversedMinor = 0;

  for (const entry of entries) {
    if (!Number.isSafeInteger(entry.amountMinor) || entry.amountMinor === 0) {
      throw new Error('STORE_ORDER_PROFITABILITY_ECONOMIC_ENTRY_INVALID');
    }
    if (entry.kind === 'payment_capture') {
      if (entry.amountMinor <= 0) throw new Error('STORE_ORDER_PROFITABILITY_CAPTURE_INVALID');
      capturedMinor = safeAdd(capturedMinor, entry.amountMinor);
    } else if (entry.kind === 'payment_refund') {
      if (entry.amountMinor >= 0) throw new Error('STORE_ORDER_PROFITABILITY_REFUND_INVALID');
      refundedMinor = safeAdd(refundedMinor, Math.abs(entry.amountMinor));
    } else if (entry.kind === 'payment_chargeback') {
      if (entry.amountMinor >= 0) throw new Error('STORE_ORDER_PROFITABILITY_CHARGEBACK_INVALID');
      chargedBackMinor = safeAdd(chargedBackMinor, Math.abs(entry.amountMinor));
    } else if (entry.kind === 'payment_chargeback_reversal') {
      if (entry.amountMinor <= 0) throw new Error('STORE_ORDER_PROFITABILITY_CHARGEBACK_REVERSAL_INVALID');
      chargebackReversedMinor = safeAdd(chargebackReversedMinor, entry.amountMinor);
    }
  }

  if (capturedMinor <= 0) throw new Error('STORE_ORDER_PROFITABILITY_CAPTURE_REQUIRED');
  const netMinor = capturedMinor - refundedMinor - chargedBackMinor + chargebackReversedMinor;
  if (!Number.isSafeInteger(netMinor)) throw new Error('STORE_ORDER_PROFITABILITY_OVERFLOW');

  const hasRefund = refundedMinor > 0;
  const openChargebackMinor = Math.max(0, chargedBackMinor - chargebackReversedMinor);
  const hasChargeback = chargedBackMinor > 0;
  const fullRefund = refundedMinor === capturedMinor && !hasChargeback;
  const cleanCapture = !hasRefund && !hasChargeback;
  const fullyReversedChargeback = !hasRefund
    && hasChargeback
    && chargedBackMinor === chargebackReversedMinor;
  const cleanChargeback = !hasRefund && openChargebackMinor > 0 && chargebackReversedMinor === 0;

  if (cleanCapture) {
    return { state: 'captured', capturedMinor, refundedMinor, chargedBackMinor, chargebackReversedMinor, netMinor, complex: false };
  }
  if (fullRefund) {
    return { state: 'refunded', capturedMinor, refundedMinor, chargedBackMinor, chargebackReversedMinor, netMinor, complex: false };
  }
  if (fullyReversedChargeback) {
    return { state: 'chargeback_reversed', capturedMinor, refundedMinor, chargedBackMinor, chargebackReversedMinor, netMinor, complex: false };
  }
  if (cleanChargeback) {
    return { state: 'charged_back', capturedMinor, refundedMinor, chargedBackMinor, chargebackReversedMinor, netMinor, complex: false };
  }
  return { state: 'mixed', capturedMinor, refundedMinor, chargedBackMinor, chargebackReversedMinor, netMinor, complex: true };
};

const deriveCmv = (
  evidence: StoreOrderInventoryCostEvidence | null
): {
  inventoryState: StoreOrderProfitabilityInventoryState;
  saleCmvMinor: number | null;
  activeInventoryCmvMinor: number | null;
  issue: StoreOrderProfitabilityIssue | null;
} => {
  if (!evidence) {
    return {
      inventoryState: 'missing',
      saleCmvMinor: null,
      activeInventoryCmvMinor: null,
      issue: 'cmv_missing',
    };
  }
  if (evidence.status === 'missing') {
    return {
      inventoryState: 'missing',
      saleCmvMinor: null,
      activeInventoryCmvMinor: null,
      issue: 'cmv_missing',
    };
  }
  if (evidence.status === 'skipped') {
    return {
      inventoryState: 'skipped',
      saleCmvMinor: null,
      activeInventoryCmvMinor: null,
      issue: 'inventory_not_consumed',
    };
  }
  if (evidence.lines.length === 0) {
    return {
      inventoryState: evidence.status,
      saleCmvMinor: null,
      activeInventoryCmvMinor: null,
      issue: 'cmv_missing',
    };
  }

  let cmvMinor = 0;
  for (const line of evidence.lines) {
    if (
      line.costBasisStatus !== 'complete'
      || safeNonNegativeInteger(line.totalCostMinor) === null
    ) {
      return {
        inventoryState: evidence.status,
        saleCmvMinor: null,
        activeInventoryCmvMinor: null,
        issue: 'cmv_incomplete',
      };
    }
    cmvMinor = safeAdd(cmvMinor, line.totalCostMinor ?? 0);
  }

  return {
    inventoryState: evidence.status,
    saleCmvMinor: cmvMinor,
    activeInventoryCmvMinor: evidence.status === 'reversed' ? 0 : cmvMinor,
    issue: null,
  };
};

const storeObservedCosts = (allocation: EconomicAllocationSnapshot): number => {
  let total = 0;
  for (const cost of allocation.observedCosts) {
    if (cost.borneBy !== 'store') continue;
    const amount = safeNonNegativeInteger(cost.amountMinor);
    if (amount === null) throw new Error('STORE_ORDER_PROFITABILITY_OBSERVED_COST_INVALID');
    total = safeAdd(total, amount);
  }
  return total;
};

const validIsoOrEmpty = (value: string): string =>
  clean(value) && Number.isFinite(Date.parse(clean(value))) ? clean(value) : '';

export const buildStoreOrderProfitabilitySnapshot = (input: {
  storeId: string;
  orderId: string;
  economicEntries: readonly StoreEconomicLedgerEntry[];
  inventoryEvidence: StoreOrderInventoryCostEvidence | null;
  calculatedAt?: string;
}): StoreOrderProfitabilitySnapshot => {
  const storeId = clean(input.storeId);
  const orderId = clean(input.orderId);
  if (!storeId || !orderId) throw new Error('STORE_ORDER_PROFITABILITY_IDENTITY_REQUIRED');

  const entries = input.economicEntries
    .filter(entry => entry.storeId === storeId && entry.orderId === orderId)
    .slice()
    .sort((left, right) => Date.parse(left.occurredAt) - Date.parse(right.occurredAt));
  if (entries.length === 0) throw new Error('STORE_ORDER_PROFITABILITY_ECONOMIC_ENTRY_REQUIRED');

  const financial = deriveFinancialLifecycle(entries);
  const captureAllocation = uniqueCaptureAllocation(entries);
  const cmv = deriveCmv(input.inventoryEvidence);
  const issues: StoreOrderProfitabilityIssue[] = [];
  if (captureAllocation.conflict) issues.push('economic_allocation_conflict');
  if (!captureAllocation.allocation && !captureAllocation.conflict) {
    issues.push('economic_allocation_missing');
  }
  if (cmv.issue) issues.push(cmv.issue);
  if (financial.complex) issues.push('financial_lifecycle_complex');

  const allocation = captureAllocation.allocation;
  const merchandiseGrossMinor = allocation
    ? safeNonNegativeInteger(allocation.merchandiseGrossMinor)
    : null;
  const storeDiscountMinor = allocation
    ? safeNonNegativeInteger(allocation.storeSubsidyMinor)
    : null;
  const deliveryFeeMinor = allocation
    ? safeNonNegativeInteger(allocation.deliveryFeeMinor)
    : null;
  const customerPaidMinor = allocation
    ? safeNonNegativeInteger(allocation.customerPaidMinor)
    : null;
  if (
    allocation
    && [merchandiseGrossMinor, storeDiscountMinor, deliveryFeeMinor, customerPaidMinor]
      .some(value => value === null)
  ) {
    throw new Error('STORE_ORDER_PROFITABILITY_ALLOCATION_INVALID');
  }

  const merchandiseRevenueMinor = merchandiseGrossMinor !== null && storeDiscountMinor !== null
    ? merchandiseGrossMinor - storeDiscountMinor
    : null;
  if (merchandiseRevenueMinor !== null && merchandiseRevenueMinor < 0) {
    throw new Error('STORE_ORDER_PROFITABILITY_REVENUE_INVALID');
  }
  const storeObservedVariableCostsMinor = allocation ? storeObservedCosts(allocation) : null;

  const contributionBeforeObservedCostsMinor =
    merchandiseRevenueMinor !== null && cmv.saleCmvMinor !== null
      ? merchandiseRevenueMinor - cmv.saleCmvMinor
      : null;
  const contributionMinor =
    contributionBeforeObservedCostsMinor !== null && storeObservedVariableCostsMinor !== null
      ? contributionBeforeObservedCostsMinor - storeObservedVariableCostsMinor
      : null;
  const contributionMarginPercent =
    contributionMinor !== null && merchandiseRevenueMinor !== null && merchandiseRevenueMinor > 0
      ? (contributionMinor / merchandiseRevenueMinor) * 100
      : null;

  const effectiveMarginAvailable =
    contributionMarginPercent !== null
    && cmv.inventoryState === 'consumed'
    && (financial.state === 'captured' || financial.state === 'chargeback_reversed');

  const occurredAt = validIsoOrEmpty(
    entries.find(entry => entry.kind === 'payment_capture')?.occurredAt ?? ''
  );
  const calculatedAt = validIsoOrEmpty(input.calculatedAt ?? new Date().toISOString());
  if (!occurredAt || !calculatedAt) throw new Error('STORE_ORDER_PROFITABILITY_TIME_INVALID');

  return {
    schemaVersion: STORE_ORDER_PROFITABILITY_SCHEMA_VERSION,
    currency: STORE_ORDER_PROFITABILITY_CURRENCY,
    storeId,
    orderId,
    dataStatus: issues.length === 0 ? 'complete' : 'partial',
    issues: [...new Set(issues)],
    financialState: financial.state,
    inventoryState: cmv.inventoryState,
    merchandiseGrossMinor,
    storeDiscountMinor,
    merchandiseRevenueMinor,
    deliveryFeeMinor,
    customerPaidMinor,
    storeObservedVariableCostsMinor,
    saleCmvMinor: cmv.saleCmvMinor,
    activeInventoryCmvMinor: cmv.activeInventoryCmvMinor,
    contributionBeforeObservedCostsMinor,
    contributionMinor,
    contributionMarginPercent,
    paymentCapturedMinor: financial.capturedMinor,
    paymentRefundedMinor: financial.refundedMinor,
    paymentChargedBackMinor: financial.chargedBackMinor,
    paymentChargebackReversedMinor: financial.chargebackReversedMinor,
    paymentNetMinor: financial.netMinor,
    effectiveMarginAvailable,
    sourceEconomicEntryIds: entries.map(entry => entry.id).sort(),
    sourceInventoryLedgerId: clean(input.inventoryEvidence?.ledgerId),
    occurredAt,
    calculatedAt,
  };
};

export const storeOrderProfitabilityPath = (
  storeIdValue: string,
  orderIdValue: string
): string => {
  const storeId = clean(storeIdValue);
  const orderId = clean(orderIdValue);
  if (!storeId || storeId.includes('/') || !orderId) {
    throw new Error('STORE_ORDER_PROFITABILITY_PATH_INVALID');
  }
  return `stores/${storeId}/orderProfitability/${encodeURIComponent(orderId)}`;
};
