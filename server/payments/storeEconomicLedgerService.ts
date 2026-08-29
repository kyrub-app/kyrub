import type { Transaction } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import type { CanonicalPayment } from '../../src/utils/canonicalPayment.js';
import type { VerifiedPaymentProviderEvent } from '../../src/utils/paymentProvider.js';
import {
  STORE_ECONOMIC_LEDGER_SCHEMA_VERSION,
  brlToMinor,
  buildPaymentCaptureEconomicEntry,
  buildPaymentCaptureEconomicEntryId,
  buildPaymentRefundEconomicEntry,
  buildPaymentRefundEconomicEntryId,
  buildRecoveredPaymentCaptureEconomicEntry,
  storeEconomicLedgerEntryPath,
  type StoreEconomicLedgerEntry,
} from '../../shared/storeEconomicLedger.js';
import {
  buildPlatformFeeEntryId,
  buildPlatformFeeReversalEntryId,
  buildPlatformPolicyCaptureEntries,
  buildPlatformPolicyRefundReversals,
  buildPlatformSubsidyEntryId,
  buildPlatformSubsidyReversalEntryId,
  type PlatformPolicyEconomicEntry,
} from '../../shared/platformFeeSubsidyLedger.js';
import { calculatePlatformFeeSubsidyAssessment } from '../../shared/platformFeeSubsidyPolicy.js';
import { loadActivePlatformEconomyRuleInTransaction } from './platformEconomyRuleService.js';

export interface StoreEconomicLedgerPaymentPlan {
  writes: Array<{
    ref: ReturnType<typeof adminDb.doc>;
    entry: StoreEconomicLedgerEntry;
  }>;
}

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const POLICY_KINDS = new Set([
  'platform_fee_assessed',
  'platform_fee_reversed',
  'platform_subsidy_granted',
  'platform_subsidy_reversed',
]);

const parseEntry = (
  value: unknown,
  expectedStoreId: string,
  expectedEntryId: string
): StoreEconomicLedgerEntry => {
  const entry = value as Partial<StoreEconomicLedgerEntry>;
  if (
    entry.schemaVersion !== STORE_ECONOMIC_LEDGER_SCHEMA_VERSION ||
    entry.id !== expectedEntryId ||
    entry.storeId !== expectedStoreId ||
    entry.currency !== 'BRL' ||
    (entry.kind !== 'payment_capture' &&
      entry.kind !== 'payment_refund' &&
      !POLICY_KINDS.has(String(entry.kind))) ||
    !Number.isSafeInteger(entry.amountMinor) ||
    entry.amountMinor === 0 ||
    !clean(entry.paymentId) ||
    typeof entry.paymentIntentId !== 'string' ||
    !clean(entry.orderId) ||
    !clean(entry.buyerId) ||
    !clean(entry.provider) ||
    !clean(entry.providerPaymentId) ||
    typeof entry.providerEventId !== 'string' ||
    (entry.sourceAuthority !== 'provider_webhook' &&
      entry.sourceAuthority !== 'canonical_payment_snapshot' &&
      entry.sourceAuthority !== 'platform_policy_snapshot') ||
    typeof entry.reversalOfEntryId !== 'string' ||
    !clean(entry.occurredAt) ||
    !Number.isFinite(Date.parse(entry.occurredAt))
  ) {
    throw new Error('STORE_ECONOMIC_LEDGER_ENTRY_INVALID');
  }
  if (
    (entry.kind === 'payment_capture' ||
      entry.kind === 'platform_subsidy_granted' ||
      entry.kind === 'platform_fee_reversed') &&
    entry.amountMinor <= 0
  ) {
    throw new Error('STORE_ECONOMIC_LEDGER_POSITIVE_ENTRY_INVALID');
  }
  if (
    (entry.kind === 'payment_refund' ||
      entry.kind === 'platform_fee_assessed' ||
      entry.kind === 'platform_subsidy_reversed') &&
    entry.amountMinor >= 0
  ) {
    throw new Error('STORE_ECONOMIC_LEDGER_NEGATIVE_ENTRY_INVALID');
  }
  return entry as StoreEconomicLedgerEntry;
};

const parsePolicyEntry = (
  value: unknown,
  expectedStoreId: string,
  expectedEntryId: string
): PlatformPolicyEconomicEntry => {
  const base = parseEntry(value, expectedStoreId, expectedEntryId);
  const entry = value as Partial<PlatformPolicyEconomicEntry>;
  if (
    !POLICY_KINDS.has(base.kind) ||
    !clean(entry.policyId) ||
    !Number.isSafeInteger(entry.policyVersion) ||
    Number(entry.policyVersion) < 1 ||
    !Number.isSafeInteger(entry.basisGrossMinor) ||
    Number(entry.basisGrossMinor) <= 0 ||
    !Number.isSafeInteger(entry.basisBps) ||
    Number(entry.basisBps) < 0 ||
    Number(entry.basisBps) > 10_000
  ) {
    throw new Error('PLATFORM_POLICY_LEDGER_ENTRY_INVALID');
  }
  return entry as PlatformPolicyEconomicEntry;
};

const assertEntryEquivalent = (
  existing: StoreEconomicLedgerEntry,
  expected: StoreEconomicLedgerEntry
): void => {
  const immutableKeys: Array<keyof StoreEconomicLedgerEntry> = [
    'id',
    'storeId',
    'kind',
    'currency',
    'amountMinor',
    'paymentId',
    'paymentIntentId',
    'orderId',
    'buyerId',
    'paymentContext',
    'paymentMethod',
    'provider',
    'providerPaymentId',
    'reversalOfEntryId',
    'occurredAt',
  ];
  for (const key of immutableKeys) {
    if (existing[key] !== expected[key]) {
      throw new Error(`STORE_ECONOMIC_LEDGER_ENTRY_CONFLICT:${String(key)}`);
    }
  }
};

const pushIfMissing = async (input: {
  transaction: Transaction;
  storeId: string;
  entry: StoreEconomicLedgerEntry;
  writes: StoreEconomicLedgerPaymentPlan['writes'];
}): Promise<void> => {
  const ref = adminDb.doc(
    storeEconomicLedgerEntryPath(input.storeId, input.entry.id)
  );
  const snapshot = await input.transaction.get(ref);
  if (snapshot.exists) {
    assertEntryEquivalent(
      parseEntry(snapshot.data(), input.storeId, input.entry.id),
      input.entry
    );
    return;
  }
  input.writes.push({ ref, entry: input.entry });
};

export const prepareStoreEconomicLedgerPaymentPlan = async (input: {
  transaction: Transaction;
  payment: CanonicalPayment;
  event: VerifiedPaymentProviderEvent;
}): Promise<StoreEconomicLedgerPaymentPlan | null> => {
  if (
    input.event.eventType !== 'payment.paid' &&
    input.event.eventType !== 'refund.succeeded'
  ) {
    return null;
  }

  const storeId = clean(input.payment.storeId);
  if (!storeId) throw new Error('STORE_ECONOMIC_LEDGER_STORE_REQUIRED');
  const writes: StoreEconomicLedgerPaymentPlan['writes'] = [];
  const captureId = buildPaymentCaptureEconomicEntryId(input.payment.id);
  const captureRef = adminDb.doc(
    storeEconomicLedgerEntryPath(storeId, captureId)
  );

  if (input.event.eventType === 'payment.paid') {
    const policy = await loadActivePlatformEconomyRuleInTransaction(
      input.transaction,
      input.event.occurredAt
    );
    const capture = buildPaymentCaptureEconomicEntry({
      payment: input.payment,
      event: input.event,
    });
    const captureSnapshot = await input.transaction.get(captureRef);
    if (captureSnapshot.exists) {
      assertEntryEquivalent(
        parseEntry(captureSnapshot.data(), storeId, captureId),
        capture
      );
    } else {
      writes.push({ ref: captureRef, entry: capture });
    }

    const assessment = calculatePlatformFeeSubsidyAssessment({
      policy,
      paymentContext: input.payment.context,
      grossMinor: brlToMinor(input.payment.amount),
      occurredAt: input.event.occurredAt,
    });
    const policyEntries = buildPlatformPolicyCaptureEntries({
      payment: input.payment,
      event: input.event,
      policy,
      assessment,
    });
    for (const entry of policyEntries) {
      await pushIfMissing({
        transaction: input.transaction,
        storeId,
        entry,
        writes,
      });
    }
    return { writes };
  }

  const refundId = buildPaymentRefundEconomicEntryId(input.payment.id);
  const refundRef = adminDb.doc(
    storeEconomicLedgerEntryPath(storeId, refundId)
  );
  const feeRef = adminDb.doc(
    storeEconomicLedgerEntryPath(storeId, buildPlatformFeeEntryId(input.payment.id))
  );
  const subsidyRef = adminDb.doc(
    storeEconomicLedgerEntryPath(storeId, buildPlatformSubsidyEntryId(input.payment.id))
  );
  const feeReversalRef = adminDb.doc(
    storeEconomicLedgerEntryPath(
      storeId,
      buildPlatformFeeReversalEntryId(input.payment.id)
    )
  );
  const subsidyReversalRef = adminDb.doc(
    storeEconomicLedgerEntryPath(
      storeId,
      buildPlatformSubsidyReversalEntryId(input.payment.id)
    )
  );
  const [
    captureSnapshot,
    refundSnapshot,
    feeSnapshot,
    subsidySnapshot,
    feeReversalSnapshot,
    subsidyReversalSnapshot,
  ] = await Promise.all([
    input.transaction.get(captureRef),
    input.transaction.get(refundRef),
    input.transaction.get(feeRef),
    input.transaction.get(subsidyRef),
    input.transaction.get(feeReversalRef),
    input.transaction.get(subsidyReversalRef),
  ]);

  const capture = captureSnapshot.exists
    ? parseEntry(captureSnapshot.data(), storeId, captureId)
    : buildRecoveredPaymentCaptureEconomicEntry({
        payment: input.payment,
        paymentIntentId: input.event.paymentIntentId,
      });

  if (!captureSnapshot.exists) {
    writes.push({ ref: captureRef, entry: capture });
  }

  const refund = buildPaymentRefundEconomicEntry({
    payment: input.payment,
    event: input.event,
    capture,
  });
  if (refundSnapshot.exists) {
    assertEntryEquivalent(
      parseEntry(refundSnapshot.data(), storeId, refundId),
      refund
    );
  } else {
    writes.push({ ref: refundRef, entry: refund });
  }

  const originals: PlatformPolicyEconomicEntry[] = [];
  if (feeSnapshot.exists) {
    originals.push(
      parsePolicyEntry(
        feeSnapshot.data(),
        storeId,
        buildPlatformFeeEntryId(input.payment.id)
      )
    );
  }
  if (subsidySnapshot.exists) {
    originals.push(
      parsePolicyEntry(
        subsidySnapshot.data(),
        storeId,
        buildPlatformSubsidyEntryId(input.payment.id)
      )
    );
  }
  const reversals = buildPlatformPolicyRefundReversals({
    payment: input.payment,
    event: input.event,
    originalEntries: originals,
  });
  for (const reversal of reversals) {
    const existingSnapshot = reversal.kind === 'platform_fee_reversed'
      ? feeReversalSnapshot
      : subsidyReversalSnapshot;
    const ref = reversal.kind === 'platform_fee_reversed'
      ? feeReversalRef
      : subsidyReversalRef;
    if (existingSnapshot.exists) {
      assertEntryEquivalent(
        parseEntry(existingSnapshot.data(), storeId, reversal.id),
        reversal
      );
    } else {
      writes.push({ ref, entry: reversal });
    }
  }

  return { writes };
};

export const applyStoreEconomicLedgerPaymentPlan = (
  transaction: Transaction,
  plan: StoreEconomicLedgerPaymentPlan | null
): void => {
  if (!plan) return;
  for (const write of plan.writes) {
    transaction.set(write.ref, write.entry);
  }
};

export const listStoreEconomicLedgerEntries = async (input: {
  storeId: string;
  limit?: number;
}): Promise<StoreEconomicLedgerEntry[]> => {
  const storeId = clean(input.storeId);
  if (!storeId) throw new Error('STORE_ECONOMIC_LEDGER_STORE_REQUIRED');
  const limit = Math.max(1, Math.min(100, input.limit ?? 100));
  const snapshot = await adminDb
    .collection(`stores/${storeId}/economicLedger`)
    .orderBy('occurredAt', 'desc')
    .limit(limit)
    .get();
  return snapshot.docs.map(document => {
    const logicalId = decodeURIComponent(document.id);
    return parseEntry(document.data(), storeId, logicalId);
  });
};
