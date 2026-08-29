import type { Transaction } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import type { CanonicalPayment } from '../../src/utils/canonicalPayment.js';
import {
  normalizeCanonicalPaymentIntent,
  type CanonicalPaymentIntent,
} from '../../src/utils/canonicalPaymentIntent.js';
import type { VerifiedPaymentProviderEvent } from '../../src/utils/paymentProvider.js';
import {
  buildMarketplaceEconomicAllocationSnapshot,
  type EconomicAllocationSnapshot,
} from '../../shared/economicFeesSubsidies.js';
import type { KyrubCommercialPlanId } from '../../shared/kyrubCommercialPlans.js';
import {
  STORE_ECONOMIC_LEDGER_SCHEMA_VERSION,
  buildPaymentCaptureEconomicEntry,
  buildPaymentCaptureEconomicEntryId,
  buildPaymentChargebackEconomicEntry,
  buildPaymentChargebackEconomicEntryId,
  buildPaymentChargebackReversalEconomicEntry,
  buildPaymentChargebackReversalEconomicEntryId,
  buildPaymentRefundEconomicEntry,
  buildPaymentRefundEconomicEntryId,
  buildRecoveredPaymentCaptureEconomicEntry,
  storeEconomicLedgerEntryPath,
  type StoreEconomicLedgerEntry,
} from '../../shared/storeEconomicLedger.js';

export interface StoreEconomicLedgerPaymentPlan {
  writes: Array<{
    ref: ReturnType<typeof adminDb.doc>;
    entry: StoreEconomicLedgerEntry;
  }>;
}

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const parseStorePlan = (value: unknown): KyrubCommercialPlanId | undefined =>
  value === 'free' || value === 'pro' || value === 'business'
    ? value
    : undefined;

const allocationFromIntent = (
  payment: CanonicalPayment,
  intent: CanonicalPaymentIntent | null | undefined
): EconomicAllocationSnapshot | undefined => {
  if (payment.context !== 'marketplace' || !intent) return undefined;
  if (
    intent.id.trim() === '' ||
    intent.storeId !== payment.storeId ||
    intent.buyerId !== payment.buyerId ||
    intent.orderDraft.draftId !== payment.orderId ||
    Number(intent.amount.toFixed(2)) !== Number(payment.amount.toFixed(2))
  ) {
    throw new Error('STORE_ECONOMIC_LEDGER_INTENT_MISMATCH');
  }
  return buildMarketplaceEconomicAllocationSnapshot({
    subtotal: intent.orderDraft.subtotal,
    discountTotal: intent.orderDraft.discountTotal ?? 0,
    deliveryFee: intent.orderDraft.deliveryFee,
    total: intent.orderDraft.total,
  });
};

const resolvePaymentIntent = async (input: {
  transaction: Transaction;
  payment: CanonicalPayment;
  event: VerifiedPaymentProviderEvent;
  paymentIntent?: CanonicalPaymentIntent | null;
}): Promise<CanonicalPaymentIntent | null> => {
  if (input.payment.context !== 'marketplace') return null;
  if (input.paymentIntent) return input.paymentIntent;

  const snapshot = await input.transaction.get(
    adminDb.doc(
      `stores/${input.payment.storeId}/paymentIntents/${input.event.paymentIntentId}`
    )
  );
  if (!snapshot.exists) throw new Error('STORE_ECONOMIC_LEDGER_INTENT_NOT_FOUND');
  return normalizeCanonicalPaymentIntent(snapshot.data() as CanonicalPaymentIntent);
};

const parseEntry = (
  value: unknown,
  expectedStoreId: string,
  expectedEntryId: string
): StoreEconomicLedgerEntry => {
  const entry = value as Partial<StoreEconomicLedgerEntry>;
  const validKind =
    entry.kind === 'payment_capture' ||
    entry.kind === 'payment_refund' ||
    entry.kind === 'payment_chargeback' ||
    entry.kind === 'payment_chargeback_reversal';
  const validStorePlan =
    entry.storePlan === undefined ||
    entry.storePlan === 'free' ||
    entry.storePlan === 'pro' ||
    entry.storePlan === 'business';
  if (
    entry.schemaVersion !== STORE_ECONOMIC_LEDGER_SCHEMA_VERSION ||
    entry.id !== expectedEntryId ||
    entry.storeId !== expectedStoreId ||
    entry.currency !== 'BRL' ||
    !validKind ||
    !validStorePlan ||
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
      entry.sourceAuthority !== 'canonical_payment_snapshot') ||
    typeof entry.reversalOfEntryId !== 'string' ||
    !clean(entry.occurredAt) ||
    !Number.isFinite(Date.parse(entry.occurredAt))
  ) throw new Error('STORE_ECONOMIC_LEDGER_ENTRY_INVALID');

  if (
    (entry.kind === 'payment_capture' || entry.kind === 'payment_chargeback_reversal') &&
    entry.amountMinor <= 0
  ) throw new Error('STORE_ECONOMIC_LEDGER_POSITIVE_ENTRY_INVALID');
  if (
    (entry.kind === 'payment_refund' || entry.kind === 'payment_chargeback') &&
    entry.amountMinor >= 0
  ) throw new Error('STORE_ECONOMIC_LEDGER_NEGATIVE_ENTRY_INVALID');
  return entry as StoreEconomicLedgerEntry;
};

const assertEntryEquivalent = (
  existing: StoreEconomicLedgerEntry,
  expected: StoreEconomicLedgerEntry
): void => {
  const immutableKeys: Array<keyof StoreEconomicLedgerEntry> = [
    'id', 'storeId', 'kind', 'currency', 'amountMinor', 'paymentId',
    'paymentIntentId', 'orderId', 'buyerId', 'paymentContext', 'paymentMethod',
    'provider', 'providerPaymentId', 'reversalOfEntryId', 'occurredAt',
  ];
  for (const key of immutableKeys) {
    if (existing[key] !== expected[key]) {
      throw new Error(`STORE_ECONOMIC_LEDGER_ENTRY_CONFLICT:${String(key)}`);
    }
  }
  if (
    existing.storePlan !== undefined &&
    expected.storePlan !== undefined &&
    existing.storePlan !== expected.storePlan
  ) throw new Error('STORE_ECONOMIC_LEDGER_ENTRY_CONFLICT:storePlan');
  if (
    existing.economicAllocation && expected.economicAllocation &&
    JSON.stringify(existing.economicAllocation) !== JSON.stringify(expected.economicAllocation)
  ) throw new Error('STORE_ECONOMIC_LEDGER_ENTRY_CONFLICT:economicAllocation');
};

const refFor = (storeId: string, entryId: string) =>
  adminDb.doc(storeEconomicLedgerEntryPath(storeId, entryId));

export const prepareStoreEconomicLedgerPaymentPlan = async (input: {
  transaction: Transaction;
  payment: CanonicalPayment;
  event: VerifiedPaymentProviderEvent;
  paymentIntent?: CanonicalPaymentIntent | null;
}): Promise<StoreEconomicLedgerPaymentPlan | null> => {
  const relevant = [
    'payment.paid',
    'refund.succeeded',
    'chargeback.debited',
    'chargeback.reversed',
  ].includes(input.event.eventType);
  if (!relevant) return null;

  const storeId = clean(input.payment.storeId);
  if (!storeId) throw new Error('STORE_ECONOMIC_LEDGER_STORE_REQUIRED');
  const paymentIntent = await resolvePaymentIntent(input);
  const economicAllocation = allocationFromIntent(input.payment, paymentIntent);

  const captureId = buildPaymentCaptureEconomicEntryId(input.payment.id);
  const captureRef = refFor(storeId, captureId);

  if (input.event.eventType === 'payment.paid') {
    const captureSnapshot = await input.transaction.get(captureRef);
    if (captureSnapshot.exists) {
      const expectedWithoutPlan = buildPaymentCaptureEconomicEntry({
        payment: input.payment,
        event: input.event,
        economicAllocation,
      });
      assertEntryEquivalent(
        parseEntry(captureSnapshot.data(), storeId, captureId),
        expectedWithoutPlan
      );
      return { writes: [] };
    }

    const storeSnapshot = await input.transaction.get(adminDb.doc(`stores/${storeId}`));
    const storePlan = storeSnapshot.exists
      ? parseStorePlan(storeSnapshot.data()?.plan)
      : undefined;
    const capture = buildPaymentCaptureEconomicEntry({
      payment: input.payment,
      event: input.event,
      storePlan,
      economicAllocation,
    });
    return { writes: [{ ref: captureRef, entry: capture }] };
  }

  const captureSnapshot = await input.transaction.get(captureRef);
  const writes: StoreEconomicLedgerPaymentPlan['writes'] = [];
  const capture = captureSnapshot.exists
    ? parseEntry(captureSnapshot.data(), storeId, captureId)
    : buildRecoveredPaymentCaptureEconomicEntry({
        payment: input.payment,
        paymentIntentId: input.event.paymentIntentId,
        economicAllocation,
      });
  if (!captureSnapshot.exists) writes.push({ ref: captureRef, entry: capture });

  if (input.event.eventType === 'refund.succeeded') {
    const id = buildPaymentRefundEconomicEntryId(input.payment.id);
    const ref = refFor(storeId, id);
    const snapshot = await input.transaction.get(ref);
    const entry = buildPaymentRefundEconomicEntry({ payment: input.payment, event: input.event, capture });
    if (snapshot.exists) assertEntryEquivalent(parseEntry(snapshot.data(), storeId, id), entry);
    else writes.push({ ref, entry });
    return { writes };
  }

  const chargebackId = buildPaymentChargebackEconomicEntryId(input.payment.id);
  const chargebackRef = refFor(storeId, chargebackId);
  const chargebackSnapshot = await input.transaction.get(chargebackRef);

  if (input.event.eventType === 'chargeback.debited') {
    const entry = buildPaymentChargebackEconomicEntry({ payment: input.payment, event: input.event, capture });
    if (chargebackSnapshot.exists) {
      assertEntryEquivalent(parseEntry(chargebackSnapshot.data(), storeId, chargebackId), entry);
    } else {
      writes.push({ ref: chargebackRef, entry });
    }
    return { writes };
  }

  if (!chargebackSnapshot.exists) {
    throw new Error('STORE_ECONOMIC_LEDGER_CHARGEBACK_NOT_FOUND');
  }
  const chargeback = parseEntry(chargebackSnapshot.data(), storeId, chargebackId);
  const reversalId = buildPaymentChargebackReversalEconomicEntryId(input.payment.id);
  const reversalRef = refFor(storeId, reversalId);
  const reversalSnapshot = await input.transaction.get(reversalRef);
  const reversal = buildPaymentChargebackReversalEconomicEntry({
    payment: input.payment,
    event: input.event,
    chargeback,
  });
  if (reversalSnapshot.exists) {
    assertEntryEquivalent(parseEntry(reversalSnapshot.data(), storeId, reversalId), reversal);
  } else {
    writes.push({ ref: reversalRef, entry: reversal });
  }
  return { writes };
};

export const applyStoreEconomicLedgerPaymentPlan = (
  transaction: Transaction,
  plan: StoreEconomicLedgerPaymentPlan | null
): void => {
  if (!plan) return;
  for (const write of plan.writes) transaction.set(write.ref, write.entry);
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
  return snapshot.docs.map(document =>
    parseEntry(document.data(), storeId, decodeURIComponent(document.id))
  );
};
