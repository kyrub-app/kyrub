import type { EconomicAllocationSnapshot } from './economicFeesSubsidies.js';
import type {
  StoreEconomicLedgerKind,
  StoreEconomicLedgerSourceAuthority,
} from './storeEconomicLedger.js';

export const ADMIN_PLATFORM_ECONOMY_SCHEMA_VERSION = 1 as const;
export const ADMIN_PLATFORM_ECONOMY_RECENT_LIMIT = 100 as const;

export interface AdminPlatformEconomyTotals {
  currency: 'BRL';
  capturedMinor: number;
  refundedMinor: number;
  grossAfterRefundsMinor: number;
  chargedBackMinor: number;
  chargebackReversedMinor: number;
  economicNetMinor: number;
  captureCount: number;
  refundCount: number;
  chargebackCount: number;
  chargebackReversalCount: number;
  recoveredCaptureCount: number;
  refundShareBps: number;
}

export interface AdminPlatformEconomyRecentEntry {
  id: string;
  storeId: string;
  kind: StoreEconomicLedgerKind;
  amountMinor: number;
  paymentId: string;
  paymentContext: 'marketplace' | 'table' | 'pos';
  provider: string;
  sourceAuthority: StoreEconomicLedgerSourceAuthority;
  occurredAt: string;
  economicAllocation?: EconomicAllocationSnapshot;
}

export interface AdminPlatformEconomyAllocationWindow {
  allocatedCaptureCount: number;
  allocatedRefundCount: number;
  allocatedChargebackCount: number;
  allocatedChargebackReversalCount: number;
  deliveryFeeMinor: number;
  courierRemunerationMinor: number;
  storeSubsidyMinor: number;
  kyrubIncentiveMinor: number;
  partnerSubsidyMinor: number;
  observedCostsMinor: number;
}

export interface AdminPlatformEconomyAllocationAggregate {
  count: number;
  deliveryFeeMinor: number;
  courierRemunerationMinor: number;
  storeSubsidyMinor: number;
  kyrubIncentiveMinor: number;
  partnerSubsidyMinor: number;
  observedCostsMinor: number;
}

export interface AdminPlatformEconomyStoreActivity {
  storeId: string;
  capturedMinor: number;
  refundedMinor: number;
  grossAfterRefundsMinor: number;
  chargedBackMinor: number;
  chargebackReversedMinor: number;
  economicNetMinor: number;
  eventCount: number;
  lastOccurredAt: string;
}

export interface AdminPlatformEconomySnapshot {
  schemaVersion: typeof ADMIN_PLATFORM_ECONOMY_SCHEMA_VERSION;
  generatedAt: string;
  totals: AdminPlatformEconomyTotals;
  allocationTotals: AdminPlatformEconomyAllocationWindow;
  recentWindow: {
    limit: number;
    entryCount: number;
    representedStoreCount: number;
    allocation: AdminPlatformEconomyAllocationWindow;
    entries: AdminPlatformEconomyRecentEntry[];
    stores: AdminPlatformEconomyStoreActivity[];
  };
}

const safeNonNegative = (value: number, label: string): number => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`ADMIN_PLATFORM_ECONOMY_${label}_INVALID`);
  return value;
};
const addSignedSafe = (left: number, right: number, label: string): number => {
  const value = left + right;
  if (!Number.isSafeInteger(value)) throw new Error(`ADMIN_PLATFORM_ECONOMY_${label}_OVERFLOW`);
  return value;
};

export const deriveRefundShareBps = (capturedMinorInput: number, refundedMinorInput: number): number => {
  const capturedMinor = safeNonNegative(capturedMinorInput, 'CAPTURED');
  const refundedMinor = safeNonNegative(refundedMinorInput, 'REFUNDED');
  if (capturedMinor === 0) return 0;
  return Math.min(10000, Math.round((refundedMinor * 10000) / capturedMinor));
};

const allocationSign = (kind: StoreEconomicLedgerKind): number =>
  kind === 'payment_capture' || kind === 'payment_chargeback_reversal' ? 1 : -1;

const normalizedAllocationAggregate = (
  aggregate: AdminPlatformEconomyAllocationAggregate,
  label: string
): AdminPlatformEconomyAllocationAggregate => ({
  count: safeNonNegative(aggregate.count, `${label}_COUNT`),
  deliveryFeeMinor: safeNonNegative(aggregate.deliveryFeeMinor, `${label}_DELIVERY_FEE`),
  courierRemunerationMinor: safeNonNegative(
    aggregate.courierRemunerationMinor,
    `${label}_COURIER_REMUNERATION`
  ),
  storeSubsidyMinor: safeNonNegative(aggregate.storeSubsidyMinor, `${label}_STORE_SUBSIDY`),
  kyrubIncentiveMinor: safeNonNegative(aggregate.kyrubIncentiveMinor, `${label}_KYRUB_INCENTIVE`),
  partnerSubsidyMinor: safeNonNegative(aggregate.partnerSubsidyMinor, `${label}_PARTNER_SUBSIDY`),
  observedCostsMinor: safeNonNegative(aggregate.observedCostsMinor, `${label}_OBSERVED_COSTS`),
});

export const combineEconomicAllocationLifecycleTotals = (input: {
  captures: AdminPlatformEconomyAllocationAggregate;
  refunds: AdminPlatformEconomyAllocationAggregate;
  chargebacks: AdminPlatformEconomyAllocationAggregate;
  chargebackReversals: AdminPlatformEconomyAllocationAggregate;
}): AdminPlatformEconomyAllocationWindow => {
  const captures = normalizedAllocationAggregate(input.captures, 'ALLOCATED_CAPTURE');
  const refunds = normalizedAllocationAggregate(input.refunds, 'ALLOCATED_REFUND');
  const chargebacks = normalizedAllocationAggregate(input.chargebacks, 'ALLOCATED_CHARGEBACK');
  const chargebackReversals = normalizedAllocationAggregate(
    input.chargebackReversals,
    'ALLOCATED_CHARGEBACK_REVERSAL'
  );
  const lifecycle = [
    { kind: 'payment_capture' as const, aggregate: captures },
    { kind: 'payment_refund' as const, aggregate: refunds },
    { kind: 'payment_chargeback' as const, aggregate: chargebacks },
    { kind: 'payment_chargeback_reversal' as const, aggregate: chargebackReversals },
  ];
  const result: AdminPlatformEconomyAllocationWindow = {
    allocatedCaptureCount: captures.count,
    allocatedRefundCount: refunds.count,
    allocatedChargebackCount: chargebacks.count,
    allocatedChargebackReversalCount: chargebackReversals.count,
    deliveryFeeMinor: 0,
    courierRemunerationMinor: 0,
    storeSubsidyMinor: 0,
    kyrubIncentiveMinor: 0,
    partnerSubsidyMinor: 0,
    observedCostsMinor: 0,
  };
  for (const item of lifecycle) {
    const sign = allocationSign(item.kind);
    result.deliveryFeeMinor = addSignedSafe(
      result.deliveryFeeMinor,
      sign * item.aggregate.deliveryFeeMinor,
      'ALLOCATED_TOTAL_DELIVERY_FEE'
    );
    result.courierRemunerationMinor = addSignedSafe(
      result.courierRemunerationMinor,
      sign * item.aggregate.courierRemunerationMinor,
      'ALLOCATED_TOTAL_COURIER_REMUNERATION'
    );
    result.storeSubsidyMinor = addSignedSafe(
      result.storeSubsidyMinor,
      sign * item.aggregate.storeSubsidyMinor,
      'ALLOCATED_TOTAL_STORE_SUBSIDY'
    );
    result.kyrubIncentiveMinor = addSignedSafe(
      result.kyrubIncentiveMinor,
      sign * item.aggregate.kyrubIncentiveMinor,
      'ALLOCATED_TOTAL_KYRUB_INCENTIVE'
    );
    result.partnerSubsidyMinor = addSignedSafe(
      result.partnerSubsidyMinor,
      sign * item.aggregate.partnerSubsidyMinor,
      'ALLOCATED_TOTAL_PARTNER_SUBSIDY'
    );
    result.observedCostsMinor = addSignedSafe(
      result.observedCostsMinor,
      sign * item.aggregate.observedCostsMinor,
      'ALLOCATED_TOTAL_OBSERVED_COSTS'
    );
  }
  return result;
};

export const deriveRecentEconomicAllocationWindow = (
  entries: readonly AdminPlatformEconomyRecentEntry[]
): AdminPlatformEconomyAllocationWindow => {
  const result: AdminPlatformEconomyAllocationWindow = {
    allocatedCaptureCount: 0,
    allocatedRefundCount: 0,
    allocatedChargebackCount: 0,
    allocatedChargebackReversalCount: 0,
    deliveryFeeMinor: 0,
    courierRemunerationMinor: 0,
    storeSubsidyMinor: 0,
    kyrubIncentiveMinor: 0,
    partnerSubsidyMinor: 0,
    observedCostsMinor: 0,
  };

  for (const entry of entries) {
    const allocation = entry.economicAllocation;
    if (!allocation) continue;
    const sign = allocationSign(entry.kind);
    if (entry.kind === 'payment_capture') result.allocatedCaptureCount += 1;
    else if (entry.kind === 'payment_refund') result.allocatedRefundCount += 1;
    else if (entry.kind === 'payment_chargeback') result.allocatedChargebackCount += 1;
    else result.allocatedChargebackReversalCount += 1;

    result.deliveryFeeMinor = addSignedSafe(result.deliveryFeeMinor, sign * allocation.deliveryFeeMinor, 'DELIVERY_FEE');
    result.courierRemunerationMinor = addSignedSafe(result.courierRemunerationMinor, sign * allocation.courierRemunerationMinor, 'COURIER_REMUNERATION');
    result.storeSubsidyMinor = addSignedSafe(result.storeSubsidyMinor, sign * allocation.storeSubsidyMinor, 'STORE_SUBSIDY');
    result.kyrubIncentiveMinor = addSignedSafe(result.kyrubIncentiveMinor, sign * allocation.kyrubIncentiveMinor, 'KYRUB_INCENTIVE');
    result.partnerSubsidyMinor = addSignedSafe(result.partnerSubsidyMinor, sign * allocation.partnerSubsidyMinor, 'PARTNER_SUBSIDY');
    result.observedCostsMinor = addSignedSafe(result.observedCostsMinor, sign * allocation.observedCostsMinor, 'OBSERVED_COSTS');
  }
  return result;
};

export const buildRecentStoreEconomyActivity = (
  entries: readonly AdminPlatformEconomyRecentEntry[]
): AdminPlatformEconomyStoreActivity[] => {
  const byStore = new Map<string, AdminPlatformEconomyStoreActivity>();
  for (const entry of entries) {
    const current = byStore.get(entry.storeId) ?? {
      storeId: entry.storeId,
      capturedMinor: 0,
      refundedMinor: 0,
      grossAfterRefundsMinor: 0,
      chargedBackMinor: 0,
      chargebackReversedMinor: 0,
      economicNetMinor: 0,
      eventCount: 0,
      lastOccurredAt: '',
    };
    if (entry.kind === 'payment_capture') current.capturedMinor += entry.amountMinor;
    else if (entry.kind === 'payment_refund') current.refundedMinor += Math.abs(entry.amountMinor);
    else if (entry.kind === 'payment_chargeback') current.chargedBackMinor += Math.abs(entry.amountMinor);
    else current.chargebackReversedMinor += entry.amountMinor;
    current.grossAfterRefundsMinor = current.capturedMinor - current.refundedMinor;
    current.economicNetMinor = current.grossAfterRefundsMinor - current.chargedBackMinor + current.chargebackReversedMinor;
    current.eventCount += 1;
    if (!current.lastOccurredAt || entry.occurredAt > current.lastOccurredAt) current.lastOccurredAt = entry.occurredAt;
    byStore.set(entry.storeId, current);
  }
  return [...byStore.values()].sort((left, right) =>
    right.lastOccurredAt.localeCompare(left.lastOccurredAt) || left.storeId.localeCompare(right.storeId)
  );
};
