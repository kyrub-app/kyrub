import type { Transaction } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import type { CanonicalPayment } from '../../src/utils/canonicalPayment.js';
import type { VerifiedPaymentProviderEvent } from '../../src/utils/paymentProvider.js';
import {
  STORE_ECONOMIC_LEDGER_SCHEMA_VERSION,
  buildPaymentCaptureEconomicEntry,
  buildPaymentCaptureEconomicEntryId,
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
    (entry.kind !== 'payment_capture' && entry.kind !== 'payment_refund') ||
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
  ) {
    throw new Error('STORE_ECONOMIC_LEDGER_ENTRY_INVALID');
  }
  if (entry.kind === 'payment_capture' && entry.amountMinor <= 0) {
    throw new Error('STORE_ECONOMIC_LEDGER_CAPTURE_INVALID');
  }
  if (entry.kind === 'payment_refund' && entry.amountMinor >= 0) {
    throw new Error('STORE_ECONOMIC_LEDGER_REFUND_INVALID');
  }
  return entry as StoreEconomicLedgerEntry;
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

  const captureId = buildPaymentCaptureEconomicEntryId(input.payment.id);
  const captureRef = adminDb.doc(
    storeEconomicLedgerEntryPath(storeId, captureId)
  );

  if (input.event.eventType === 'payment.paid') {
    const capture = buildPaymentCaptureEconomicEntry({
      payment: input.payment,
      event: input.event,
    });
    const snapshot = await input.transaction.get(captureRef);
    if (snapshot.exists) {
      const existing = parseEntry(snapshot.data(), storeId, captureId);
      assertEntryEquivalent(existing, capture);
      return { writes: [] };
    }
    return { writes: [{ ref: captureRef, entry: capture }] };
  }

  const refundId = buildPaymentRefundEconomicEntryId(input.payment.id);
  const refundRef = adminDb.doc(
    storeEconomicLedgerEntryPath(storeId, refundId)
  );
  const [captureSnapshot, refundSnapshot] = await Promise.all([
    input.transaction.get(captureRef),
    input.transaction.get(refundRef),
  ]);

  const writes: StoreEconomicLedgerPaymentPlan['writes'] = [];
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
    const existingRefund = parseEntry(refundSnapshot.data(), storeId, refundId);
    assertEntryEquivalent(existingRefund, refund);
  } else {
    writes.push({ ref: refundRef, entry: refund });
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
