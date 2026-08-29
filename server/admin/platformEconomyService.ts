import { AggregateField } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import {
  ADMIN_PLATFORM_ECONOMY_RECENT_LIMIT,
  ADMIN_PLATFORM_ECONOMY_SCHEMA_VERSION,
  buildRecentStoreEconomyActivity,
  combineEconomicAllocationLifecycleTotals,
  deriveRecentEconomicAllocationWindow,
  deriveRefundShareBps,
  type AdminPlatformEconomyAiUsageTotals,
  type AdminPlatformEconomyAllocationAggregate,
  type AdminPlatformEconomyRecentEntry,
  type AdminPlatformEconomySnapshot,
} from '../../shared/adminPlatformEconomy.js';
import type { EconomicAllocationSnapshot } from '../../shared/economicFeesSubsidies.js';
import type { StoreEconomicLedgerEntry } from '../../shared/storeEconomicLedger.js';

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const safeAggregateInteger = (value: unknown, label: string): number => {
  const numeric = typeof value === 'number' ? value : Number(value ?? 0);
  if (!Number.isSafeInteger(numeric)) throw new Error(`ADMIN_PLATFORM_ECONOMY_${label}_INVALID`);
  return numeric;
};

const safeNonNegativeAggregateInteger = (value: unknown, label: string): number => {
  const numeric = safeAggregateInteger(value, label);
  if (numeric < 0) throw new Error(`ADMIN_PLATFORM_ECONOMY_${label}_NEGATIVE`);
  return numeric;
};

const parseAllocationAggregate = (
  data: Record<string, unknown>,
  label: string
): AdminPlatformEconomyAllocationAggregate => ({
  count: safeAggregateInteger(data.allocationCount ?? 0, `${label}_ALLOCATION_COUNT`),
  deliveryFeeMinor: safeAggregateInteger(data.deliveryFeeMinor ?? 0, `${label}_DELIVERY_FEE`),
  courierRemunerationMinor: safeAggregateInteger(
    data.courierRemunerationMinor ?? 0,
    `${label}_COURIER_REMUNERATION`
  ),
  storeSubsidyMinor: safeAggregateInteger(data.storeSubsidyMinor ?? 0, `${label}_STORE_SUBSIDY`),
  kyrubIncentiveMinor: safeAggregateInteger(data.kyrubIncentiveMinor ?? 0, `${label}_KYRUB_INCENTIVE`),
  partnerSubsidyMinor: safeAggregateInteger(data.partnerSubsidyMinor ?? 0, `${label}_PARTNER_SUBSIDY`),
  observedCostsMinor: safeAggregateInteger(data.observedCostsMinor ?? 0, `${label}_OBSERVED_COSTS`),
});

const allocationAggregateFields = () => ({
  allocationCount: AggregateField.sum('economicAllocation.schemaVersion'),
  deliveryFeeMinor: AggregateField.sum('economicAllocation.deliveryFeeMinor'),
  courierRemunerationMinor: AggregateField.sum('economicAllocation.courierRemunerationMinor'),
  storeSubsidyMinor: AggregateField.sum('economicAllocation.storeSubsidyMinor'),
  kyrubIncentiveMinor: AggregateField.sum('economicAllocation.kyrubIncentiveMinor'),
  partnerSubsidyMinor: AggregateField.sum('economicAllocation.partnerSubsidyMinor'),
  observedCostsMinor: AggregateField.sum('economicAllocation.observedCostsMinor'),
});

const parseAiUsageTotals = (
  callCountValue: unknown,
  data: Record<string, unknown>
): AdminPlatformEconomyAiUsageTotals => {
  const callCount = safeNonNegativeAggregateInteger(callCountValue, 'AI_CALL_COUNT');
  const pricedCallCount = safeNonNegativeAggregateInteger(
    data.pricedCallCount ?? 0,
    'AI_PRICED_CALL_COUNT'
  );
  const unpricedCallCount = safeNonNegativeAggregateInteger(
    data.unpricedCallCount ?? 0,
    'AI_UNPRICED_CALL_COUNT'
  );
  if (pricedCallCount + unpricedCallCount !== callCount) {
    throw new Error('ADMIN_PLATFORM_ECONOMY_AI_CALL_CONSERVATION_INVALID');
  }
  return {
    costCurrency: 'USD',
    costUnit: 'microusd',
    callCount,
    pricedCallCount,
    unpricedCallCount,
    totalTokenCount: safeNonNegativeAggregateInteger(data.totalTokenCount ?? 0, 'AI_TOTAL_TOKEN_COUNT'),
    estimatedCostMicrousd: safeNonNegativeAggregateInteger(
      data.estimatedCostMicrousd ?? 0,
      'AI_ESTIMATED_COST_MICROUSD'
    ),
  };
};

const parseAllocation = (
  value: EconomicAllocationSnapshot | undefined
): EconomicAllocationSnapshot | undefined => {
  if (!value) return undefined;
  const integerFields = [
    value.merchandiseGrossMinor,
    value.customerPaidMinor,
    value.deliveryFeeMinor,
    value.courierRemunerationMinor,
    value.storeSubsidyMinor,
    value.kyrubIncentiveMinor,
    value.partnerSubsidyMinor,
    value.observedCostsMinor,
  ];
  if (
    value.schemaVersion !== 1 ||
    value.currency !== 'BRL' ||
    integerFields.some(amount => !Number.isSafeInteger(amount) || amount < 0) ||
    value.courierRemunerationMinor !== value.deliveryFeeMinor ||
    !Array.isArray(value.observedCosts)
  ) throw new Error('ADMIN_PLATFORM_ECONOMY_ALLOCATION_INVALID');
  return value;
};

const parseRecentEntry = (value: unknown): AdminPlatformEconomyRecentEntry => {
  const entry = value as Partial<StoreEconomicLedgerEntry>;
  const validKind =
    entry.kind === 'payment_capture' ||
    entry.kind === 'payment_refund' ||
    entry.kind === 'payment_chargeback' ||
    entry.kind === 'payment_chargeback_reversal';
  if (
    entry.schemaVersion !== 1 ||
    !clean(entry.id) ||
    !clean(entry.storeId) ||
    !validKind ||
    !Number.isSafeInteger(entry.amountMinor) ||
    entry.amountMinor === 0 ||
    !clean(entry.paymentId) ||
    (entry.paymentContext !== 'marketplace' && entry.paymentContext !== 'table' && entry.paymentContext !== 'pos') ||
    !clean(entry.provider) ||
    (entry.sourceAuthority !== 'provider_webhook' && entry.sourceAuthority !== 'canonical_payment_snapshot') ||
    !clean(entry.occurredAt) ||
    !Number.isFinite(Date.parse(entry.occurredAt))
  ) throw new Error('ADMIN_PLATFORM_ECONOMY_ENTRY_INVALID');
  const economicAllocation = parseAllocation(entry.economicAllocation);
  return {
    id: entry.id,
    storeId: entry.storeId,
    kind: entry.kind,
    amountMinor: entry.amountMinor,
    paymentId: entry.paymentId,
    paymentContext: entry.paymentContext,
    provider: entry.provider,
    sourceAuthority: entry.sourceAuthority,
    occurredAt: entry.occurredAt,
    ...(economicAllocation ? { economicAllocation } : {}),
  };
};

export const loadAdminPlatformEconomySnapshot = async (): Promise<AdminPlatformEconomySnapshot> => {
  const ledger = adminDb.collectionGroup('economicLedger');
  const aiUsage = adminDb.collection('kyrub_usage_events').where('resource', '==', 'ai');
  const captures = ledger.where('kind', '==', 'payment_capture');
  const refunds = ledger.where('kind', '==', 'payment_refund');
  const chargebacks = ledger.where('kind', '==', 'payment_chargeback');
  const chargebackReversals = ledger.where('kind', '==', 'payment_chargeback_reversal');
  const recovered = ledger.where('sourceAuthority', '==', 'canonical_payment_snapshot');

  const [
    captureAmountSnapshot,
    refundAmountSnapshot,
    chargebackAmountSnapshot,
    chargebackReversalAmountSnapshot,
    captureCountSnapshot,
    refundCountSnapshot,
    chargebackCountSnapshot,
    chargebackReversalCountSnapshot,
    recoveredCountSnapshot,
    captureAllocationSnapshot,
    refundAllocationSnapshot,
    chargebackAllocationSnapshot,
    chargebackReversalAllocationSnapshot,
    aiUsageCountSnapshot,
    aiUsageAggregateSnapshot,
    recentSnapshot,
  ] = await Promise.all([
    captures.aggregate({ amountMinor: AggregateField.sum('amountMinor') }).get(),
    refunds.aggregate({ amountMinor: AggregateField.sum('amountMinor') }).get(),
    chargebacks.aggregate({ amountMinor: AggregateField.sum('amountMinor') }).get(),
    chargebackReversals.aggregate({ amountMinor: AggregateField.sum('amountMinor') }).get(),
    captures.count().get(),
    refunds.count().get(),
    chargebacks.count().get(),
    chargebackReversals.count().get(),
    recovered.count().get(),
    captures.aggregate(allocationAggregateFields()).get(),
    refunds.aggregate(allocationAggregateFields()).get(),
    chargebacks.aggregate(allocationAggregateFields()).get(),
    chargebackReversals.aggregate(allocationAggregateFields()).get(),
    aiUsage.count().get(),
    aiUsage.aggregate({
      pricedCallCount: AggregateField.sum('pricedCallCount'),
      unpricedCallCount: AggregateField.sum('unpricedCallCount'),
      totalTokenCount: AggregateField.sum('totalTokenCount'),
      estimatedCostMicrousd: AggregateField.sum('estimatedCostMicrousd'),
    }).get(),
    ledger.orderBy('occurredAt', 'desc').limit(ADMIN_PLATFORM_ECONOMY_RECENT_LIMIT).get(),
  ]);

  const capturedMinor = safeAggregateInteger(captureAmountSnapshot.data().amountMinor ?? 0, 'CAPTURED');
  const refundSignedMinor = safeAggregateInteger(refundAmountSnapshot.data().amountMinor ?? 0, 'REFUNDED');
  const chargebackSignedMinor = safeAggregateInteger(chargebackAmountSnapshot.data().amountMinor ?? 0, 'CHARGEDBACK');
  const chargebackReversedMinor = safeAggregateInteger(chargebackReversalAmountSnapshot.data().amountMinor ?? 0, 'CHARGEBACK_REVERSED');
  if (capturedMinor < 0 || refundSignedMinor > 0 || chargebackSignedMinor > 0 || chargebackReversedMinor < 0) {
    throw new Error('ADMIN_PLATFORM_ECONOMY_SIGN_INVARIANT_INVALID');
  }
  const refundedMinor = Math.abs(refundSignedMinor);
  const chargedBackMinor = Math.abs(chargebackSignedMinor);
  const grossAfterRefundsMinor = capturedMinor - refundedMinor;
  const economicNetMinor = grossAfterRefundsMinor - chargedBackMinor + chargebackReversedMinor;
  if (![grossAfterRefundsMinor, economicNetMinor].every(Number.isSafeInteger)) {
    throw new Error('ADMIN_PLATFORM_ECONOMY_GROSS_INVALID');
  }

  const captureCount = safeAggregateInteger(captureCountSnapshot.data().count, 'CAPTURE_COUNT');
  const refundCount = safeAggregateInteger(refundCountSnapshot.data().count, 'REFUND_COUNT');
  const chargebackCount = safeAggregateInteger(chargebackCountSnapshot.data().count, 'CHARGEBACK_COUNT');
  const chargebackReversalCount = safeAggregateInteger(chargebackReversalCountSnapshot.data().count, 'CHARGEBACK_REVERSAL_COUNT');
  const recoveredCaptureCount = safeAggregateInteger(recoveredCountSnapshot.data().count, 'RECOVERED_COUNT');
  const allocationTotals = combineEconomicAllocationLifecycleTotals({
    captures: parseAllocationAggregate(captureAllocationSnapshot.data(), 'CAPTURE'),
    refunds: parseAllocationAggregate(refundAllocationSnapshot.data(), 'REFUND'),
    chargebacks: parseAllocationAggregate(chargebackAllocationSnapshot.data(), 'CHARGEBACK'),
    chargebackReversals: parseAllocationAggregate(
      chargebackReversalAllocationSnapshot.data(),
      'CHARGEBACK_REVERSAL'
    ),
  });
  const aiUsageTotals = parseAiUsageTotals(
    aiUsageCountSnapshot.data().count,
    aiUsageAggregateSnapshot.data()
  );
  const entries = recentSnapshot.docs.map(document => parseRecentEntry(document.data()));
  const stores = buildRecentStoreEconomyActivity(entries);
  const allocation = deriveRecentEconomicAllocationWindow(entries);

  return {
    schemaVersion: ADMIN_PLATFORM_ECONOMY_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    totals: {
      currency: 'BRL',
      capturedMinor,
      refundedMinor,
      grossAfterRefundsMinor,
      chargedBackMinor,
      chargebackReversedMinor,
      economicNetMinor,
      captureCount,
      refundCount,
      chargebackCount,
      chargebackReversalCount,
      recoveredCaptureCount,
      refundShareBps: deriveRefundShareBps(capturedMinor, refundedMinor),
    },
    allocationTotals,
    aiUsageTotals,
    recentWindow: {
      limit: ADMIN_PLATFORM_ECONOMY_RECENT_LIMIT,
      entryCount: entries.length,
      representedStoreCount: stores.length,
      allocation,
      entries,
      stores,
    },
  };
};
