import { FieldPath, type Transaction } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import type { CanonicalPayment } from '../../src/utils/canonicalPayment.js';
import {
  normalizeCanonicalPaymentIntent,
  type CanonicalPaymentIntent,
  type NormalizedCanonicalPaymentIntent,
} from '../../src/utils/canonicalPaymentIntent.js';
import type { VerifiedPaymentProviderEvent } from '../../src/utils/paymentProvider.js';
import {
  buildMarketplaceEconomicAllocationSnapshot,
  type EconomicAllocationSnapshot,
} from '../../shared/economicFeesSubsidies.js';
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

const allocationFromIntent = (
  payment: CanonicalPayment,
  intent: NormalizedCanonicalPaymentIntent | null | undefined
): EconomicAllocationSnapshot | undefined => {
  if (!intent) return undefined;
  if (
    !intent.id.trim() ||
    intent.storeId !== payment.storeId ||
    intent.buyerId !== payment.buyerId ||
    Number(intent.amount.toFixed(2)) !== Number(payment.amount.toFixed(2))
  ) throw new Error('STORE_ECONOMIC_LEDGER_INTENT_MISMATCH');
  if (payment.context === 'marketplace') {
    if (intent.context !== 'marketplace' || intent.orderDraft.draftId !== payment.orderId) {
      throw new Error('STORE_ECONOMIC_LEDGER_INTENT_MISMATCH');
    }
    return buildMarketplaceEconomicAllocationSnapshot({
      subtotal: intent.orderDraft.subtotal,
      discountTotal: intent.orderDraft.discountTotal ?? 0,
      deliveryFee: intent.orderDraft.deliveryFee,
      total: intent.orderDraft.total,
    });
  }
  if (payment.context !== 'table' && payment.context !== 'pos') return undefined;
  if (
    intent.context !== payment.context ||
    intent.target.kind !== 'existing_order' ||
    intent.target.orderId !== payment.orderId
  ) throw new Error('STORE_ECONOMIC_LEDGER_INTENT_MISMATCH');
  const commercial = intent.commercialSnapshot;
  if (!commercial?.couponCode) return undefined;
  if (
    commercial.discountTotal <= 0 ||
    Math.abs(commercial.subtotal - commercial.discountTotal - commercial.total) > 0.009 ||
    Math.abs(commercial.total - payment.amount) > 0.009
  ) throw new Error('STORE_ECONOMIC_LEDGER_INTENT_MISMATCH');
  return buildMarketplaceEconomicAllocationSnapshot({
    subtotal: commercial.subtotal,
    discountTotal: commercial.discountTotal,
    deliveryFee: 0,
    total: commercial.total,
  });
};

const resolvePaymentIntent = async (input: {
  transaction: Transaction;
  payment: CanonicalPayment;
  event: VerifiedPaymentProviderEvent;
  paymentIntent?: CanonicalPaymentIntent | null;
}): Promise<NormalizedCanonicalPaymentIntent | null> => {
  if (input.payment.context !== 'marketplace' && input.payment.context !== 'table' && input.payment.context !== 'pos') return null;
  if (input.paymentIntent) return normalizeCanonicalPaymentIntent(input.paymentIntent);
  const paymentIntentId = input.payment.paymentIntentId || input.event.paymentIntentId;
  if (!paymentIntentId) {
    if (input.payment.context === 'marketplace') throw new Error('STORE_ECONOMIC_LEDGER_INTENT_NOT_FOUND');
    return null;
  }
  const snapshot = await input.transaction.get(
    adminDb.doc(`stores/${input.payment.storeId}/paymentIntents/${paymentIntentId}`)
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
  const validAuthority =
    entry.sourceAuthority === 'provider_webhook' ||
    entry.sourceAuthority === 'canonical_payment_snapshot' ||
    entry.sourceAuthority === 'operator_attestation';
  if (
    entry.schemaVersion !== STORE_ECONOMIC_LEDGER_SCHEMA_VERSION ||
    entry.id !== expectedEntryId ||
    entry.storeId !== expectedStoreId ||
    entry.currency !== 'BRL' ||
    !validKind ||
    !Number.isSafeInteger(entry.amountMinor) ||
    entry.amountMinor === 0 ||
    !clean(entry.paymentId) ||
    typeof entry.paymentIntentId !== 'string' ||
    !clean(entry.orderId) ||
    !clean(entry.buyerId) ||
    !clean(entry.provider) ||
    !clean(entry.providerPaymentId) ||
    typeof entry.providerEventId !== 'string' ||
    !validAuthority ||
    typeof entry.reversalOfEntryId !== 'string' ||
    !clean(entry.occurredAt) ||
    !Number.isFinite(Date.parse(entry.occurredAt))
  ) throw new Error('STORE_ECONOMIC_LEDGER_ENTRY_INVALID');
  if ((entry.kind === 'payment_capture' || entry.kind === 'payment_chargeback_reversal') && entry.amountMinor <= 0) {
    throw new Error('STORE_ECONOMIC_LEDGER_POSITIVE_ENTRY_INVALID');
  }
  if ((entry.kind === 'payment_refund' || entry.kind === 'payment_chargeback') && entry.amountMinor >= 0) {
    throw new Error('STORE_ECONOMIC_LEDGER_NEGATIVE_ENTRY_INVALID');
  }
  return entry as StoreEconomicLedgerEntry;
};

const assertEntryEquivalent = (
  existing: StoreEconomicLedgerEntry,
  expected: StoreEconomicLedgerEntry
): void => {
  const immutableKeys: Array<keyof StoreEconomicLedgerEntry> = [
    'id', 'storeId', 'kind', 'currency', 'amountMinor', 'paymentId',
    'paymentIntentId', 'orderId', 'buyerId', 'paymentContext', 'paymentMethod',
    'provider', 'providerPaymentId', 'providerEventId', 'sourceAuthority',
    'reversalOfEntryId', 'occurredAt',
  ];
  for (const key of immutableKeys) {
    if (existing[key] !== expected[key]) {
      throw new Error(`STORE_ECONOMIC_LEDGER_ENTRY_CONFLICT:${String(key)}`);
    }
  }
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
  const relevant = ['payment.paid', 'refund.succeeded', 'chargeback.debited', 'chargeback.reversed']
    .includes(input.event.eventType);
  if (!relevant) return null;
  const storeId = clean(input.payment.storeId);
  if (!storeId) throw new Error('STORE_ECONOMIC_LEDGER_STORE_REQUIRED');
  const paymentIntent = await resolvePaymentIntent(input);
  const economicAllocation = allocationFromIntent(input.payment, paymentIntent);
  const captureId = buildPaymentCaptureEconomicEntryId(input.payment.id);
  const captureRef = refFor(storeId, captureId);

  if (input.event.eventType === 'payment.paid') {
    const capture = buildPaymentCaptureEconomicEntry({ payment: input.payment, event: input.event, economicAllocation });
    const snapshot = await input.transaction.get(captureRef);
    if (snapshot.exists) {
      assertEntryEquivalent(parseEntry(snapshot.data(), storeId, captureId), capture);
      return { writes: [] };
    }
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
    if (chargebackSnapshot.exists) assertEntryEquivalent(parseEntry(chargebackSnapshot.data(), storeId, chargebackId), entry);
    else writes.push({ ref: chargebackRef, entry });
    return { writes };
  }
  if (!chargebackSnapshot.exists) throw new Error('STORE_ECONOMIC_LEDGER_CHARGEBACK_NOT_FOUND');
  const chargeback = parseEntry(chargebackSnapshot.data(), storeId, chargebackId);
  const reversalId = buildPaymentChargebackReversalEconomicEntryId(input.payment.id);
  const reversalRef = refFor(storeId, reversalId);
  const reversalSnapshot = await input.transaction.get(reversalRef);
  const reversal = buildPaymentChargebackReversalEconomicEntry({ payment: input.payment, event: input.event, chargeback });
  if (reversalSnapshot.exists) assertEntryEquivalent(parseEntry(reversalSnapshot.data(), storeId, reversalId), reversal);
  else writes.push({ ref: reversalRef, entry: reversal });
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
  const snapshot = await adminDb.collection(`stores/${storeId}/economicLedger`)
    .orderBy('occurredAt', 'desc').limit(limit).get();
  return snapshot.docs.map(document => parseEntry(document.data(), storeId, decodeURIComponent(document.id)));
};

type StoreEconomicLedgerCursor = {
  v: 1;
  storeId: string;
  occurredAt: string;
  documentId: string;
};

export type StoreEconomicLedgerPage = {
  entries: StoreEconomicLedgerEntry[];
  hasMore: boolean;
  nextCursor: string;
};

const encodeCursor = (cursor: StoreEconomicLedgerCursor): string =>
  Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');

const decodeCursor = (value: string, expectedStoreId: string): StoreEconomicLedgerCursor => {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<StoreEconomicLedgerCursor>;
    if (
      parsed.v !== 1 ||
      clean(parsed.storeId) !== expectedStoreId ||
      !clean(parsed.occurredAt) ||
      !Number.isFinite(Date.parse(parsed.occurredAt ?? '')) ||
      !clean(parsed.documentId)
    ) {
      throw new Error('STORE_ECONOMIC_LEDGER_CURSOR_INVALID');
    }
    return parsed as StoreEconomicLedgerCursor;
  } catch (error) {
    if (error instanceof Error && error.message === 'STORE_ECONOMIC_LEDGER_CURSOR_INVALID') throw error;
    throw new Error('STORE_ECONOMIC_LEDGER_CURSOR_INVALID');
  }
};

export const listStoreEconomicLedgerPage = async (input: {
  storeId: string;
  limit?: number;
  cursor?: string;
}): Promise<StoreEconomicLedgerPage> => {
  const storeId = clean(input.storeId);
  if (!storeId) throw new Error('STORE_ECONOMIC_LEDGER_STORE_REQUIRED');
  const requestedLimit = input.limit === undefined ? 25 : input.limit;
  if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 50) {
    throw new Error('STORE_ECONOMIC_LEDGER_PAGE_LIMIT_INVALID');
  }

  let query = adminDb.collection(`stores/${storeId}/economicLedger`)
    .orderBy('occurredAt', 'desc')
    .orderBy(FieldPath.documentId(), 'desc');
  const cursorValue = clean(input.cursor);
  if (cursorValue) {
    const cursor = decodeCursor(cursorValue, storeId);
    query = query.startAfter(cursor.occurredAt, cursor.documentId);
  }

  const snapshot = await query.limit(requestedLimit + 1).get();
  const hasMore = snapshot.docs.length > requestedLimit;
  const documents = snapshot.docs.slice(0, requestedLimit);
  const entries = documents.map(document =>
    parseEntry(document.data(), storeId, decodeURIComponent(document.id))
  );
  const lastDocument = documents.at(-1);
  const nextCursor = hasMore && lastDocument
    ? encodeCursor({
        v: 1,
        storeId,
        occurredAt: clean(lastDocument.data().occurredAt),
        documentId: lastDocument.id,
      })
    : '';

  return { entries, hasMore, nextCursor };
};

export const listStoreEconomicLedgerEntriesForOrder = async (input: {
  storeId: string;
  orderId: string;
}): Promise<StoreEconomicLedgerEntry[]> => {
  const storeId = clean(input.storeId);
  const orderId = clean(input.orderId);
  if (!storeId) throw new Error('STORE_ECONOMIC_LEDGER_STORE_REQUIRED');
  if (!orderId) throw new Error('STORE_ECONOMIC_LEDGER_ORDER_REQUIRED');
  const snapshot = await adminDb.collection(`stores/${storeId}/economicLedger`)
    .where('orderId', '==', orderId)
    .get();
  return snapshot.docs
    .map(document => parseEntry(document.data(), storeId, decodeURIComponent(document.id)))
    .sort((left, right) =>
      Date.parse(right.occurredAt) - Date.parse(left.occurredAt)
      || right.id.localeCompare(left.id)
    );
};