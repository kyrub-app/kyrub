import type {
  CanonicalPayment,
  PaymentContext,
  PaymentMethod,
} from '../src/utils/canonicalPayment.js';
import type { VerifiedPaymentProviderEvent } from '../src/utils/paymentProvider.js';
import type { EconomicAllocationSnapshot } from './economicFeesSubsidies.js';
import type { KyrubCommercialPlanId } from './kyrubCommercialPlans.js';

export const STORE_ECONOMIC_LEDGER_SCHEMA_VERSION = 1 as const;
export const STORE_ECONOMIC_LEDGER_CURRENCY = 'BRL' as const;
export const STORE_ECONOMIC_LEDGER_MAX_ENTRIES = 100 as const;

export type StoreEconomicLedgerKind =
  | 'payment_capture'
  | 'payment_refund'
  | 'payment_chargeback'
  | 'payment_chargeback_reversal';

export type StoreEconomicLedgerSourceAuthority =
  | 'provider_webhook'
  | 'canonical_payment_snapshot';

export interface StoreEconomicLedgerEntry {
  schemaVersion: typeof STORE_ECONOMIC_LEDGER_SCHEMA_VERSION;
  id: string;
  storeId: string;
  kind: StoreEconomicLedgerKind;
  currency: typeof STORE_ECONOMIC_LEDGER_CURRENCY;
  amountMinor: number;
  paymentId: string;
  paymentIntentId: string;
  orderId: string;
  buyerId: string;
  paymentContext: PaymentContext;
  paymentMethod: PaymentMethod;
  provider: string;
  providerPaymentId: string;
  providerEventId: string;
  sourceAuthority: StoreEconomicLedgerSourceAuthority;
  reversalOfEntryId: string;
  occurredAt: string;
  storePlan?: KyrubCommercialPlanId;
  economicAllocation?: EconomicAllocationSnapshot;
}

export interface StoreEconomicLedgerSummary {
  currency: typeof STORE_ECONOMIC_LEDGER_CURRENCY;
  capturedMinor: number;
  refundedMinor: number;
  grossAfterRefundsMinor: number;
  chargedBackMinor: number;
  chargebackReversedMinor: number;
  economicNetMinor: number;
  entryCount: number;
}

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';
const validIso = (value: string): boolean =>
  Boolean(value) && Number.isFinite(Date.parse(value));
const validPathId = (value: string): boolean =>
  Boolean(value) && value.length <= 240 && value !== '.' && value !== '..';

export const brlToMinor = (amount: number): number => {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('STORE_ECONOMIC_LEDGER_AMOUNT_INVALID');
  const minor = Math.round(amount * 100);
  if (!Number.isSafeInteger(minor) || minor <= 0) throw new Error('STORE_ECONOMIC_LEDGER_AMOUNT_INVALID');
  return minor;
};

export const brlNonNegativeToMinor = (amount: number): number => {
  if (!Number.isFinite(amount) || amount < 0) throw new Error('STORE_ECONOMIC_LEDGER_AMOUNT_INVALID');
  const minor = Math.round(amount * 100);
  if (!Number.isSafeInteger(minor) || minor < 0) throw new Error('STORE_ECONOMIC_LEDGER_AMOUNT_INVALID');
  return minor;
};

const paymentEntryId = (kind: string, paymentIdInput: string): string => {
  const paymentId = clean(paymentIdInput);
  if (!paymentId) throw new Error('STORE_ECONOMIC_LEDGER_PAYMENT_REQUIRED');
  return `payment:${kind}:${paymentId}`;
};
export const buildPaymentCaptureEconomicEntryId = (paymentId: string): string => paymentEntryId('capture', paymentId);
export const buildPaymentRefundEconomicEntryId = (paymentId: string): string => paymentEntryId('refund', paymentId);
export const buildPaymentChargebackEconomicEntryId = (paymentId: string): string => paymentEntryId('chargeback', paymentId);
export const buildPaymentChargebackReversalEconomicEntryId = (paymentId: string): string => paymentEntryId('chargeback_reversal', paymentId);

export const storeEconomicLedgerEntryPath = (storeIdInput: string, entryIdInput: string): string => {
  const storeId = clean(storeIdInput);
  const entryId = clean(entryIdInput);
  if (!storeId || storeId.includes('/') || !validPathId(entryId)) throw new Error('STORE_ECONOMIC_LEDGER_PATH_INVALID');
  return `stores/${storeId}/economicLedger/${encodeURIComponent(entryId)}`;
};

const assertPaymentEventMatch = (payment: CanonicalPayment, event: VerifiedPaymentProviderEvent): void => {
  if (
    payment.storeId !== clean(payment.storeId) || !payment.storeId || !payment.id ||
    payment.currency !== STORE_ECONOMIC_LEDGER_CURRENCY || event.currency !== STORE_ECONOMIC_LEDGER_CURRENCY ||
    brlToMinor(payment.amount) !== brlToMinor(event.amount) || payment.method !== event.method ||
    (payment.provider && payment.provider !== event.provider) ||
    (payment.providerPaymentId && payment.providerPaymentId !== event.providerPaymentId)
  ) throw new Error('STORE_ECONOMIC_LEDGER_PAYMENT_EVENT_MISMATCH');
};

const baseFromPayment = (input: {
  payment: CanonicalPayment;
  paymentIntentId: string;
  occurredAt: string;
  provider: string;
  providerPaymentId: string;
  providerEventId: string;
  sourceAuthority: StoreEconomicLedgerSourceAuthority;
}) => {
  const occurredAt = clean(input.occurredAt);
  if (!validIso(occurredAt)) throw new Error('STORE_ECONOMIC_LEDGER_TIME_INVALID');
  return {
    schemaVersion: STORE_ECONOMIC_LEDGER_SCHEMA_VERSION,
    storeId: clean(input.payment.storeId),
    currency: STORE_ECONOMIC_LEDGER_CURRENCY,
    paymentId: clean(input.payment.id),
    paymentIntentId: clean(input.paymentIntentId),
    orderId: clean(input.payment.orderId),
    buyerId: clean(input.payment.buyerId),
    paymentContext: input.payment.context,
    paymentMethod: input.payment.method,
    provider: clean(input.provider),
    providerPaymentId: clean(input.providerPaymentId),
    providerEventId: clean(input.providerEventId),
    sourceAuthority: input.sourceAuthority,
    occurredAt,
  } as const;
};

const assertCapture = (capture: StoreEconomicLedgerEntry, payment: CanonicalPayment): void => {
  if (capture.kind !== 'payment_capture' || capture.storeId !== payment.storeId || capture.paymentId !== payment.id || capture.amountMinor !== brlToMinor(payment.amount)) {
    throw new Error('STORE_ECONOMIC_LEDGER_CAPTURE_MISMATCH');
  }
};

export const buildPaymentCaptureEconomicEntry = (input: {
  payment: CanonicalPayment;
  event: VerifiedPaymentProviderEvent;
  storePlan?: KyrubCommercialPlanId;
  economicAllocation?: EconomicAllocationSnapshot;
}): StoreEconomicLedgerEntry => {
  assertPaymentEventMatch(input.payment, input.event);
  if (input.event.eventType !== 'payment.paid') throw new Error('STORE_ECONOMIC_LEDGER_CAPTURE_EVENT_INVALID');
  return {
    ...baseFromPayment({ payment: input.payment, paymentIntentId: input.event.paymentIntentId, occurredAt: input.event.occurredAt, provider: input.event.provider, providerPaymentId: input.event.providerPaymentId, providerEventId: input.event.eventId, sourceAuthority: 'provider_webhook' }),
    id: buildPaymentCaptureEconomicEntryId(input.payment.id), kind: 'payment_capture', amountMinor: brlToMinor(input.payment.amount), reversalOfEntryId: '',
    ...(input.storePlan ? { storePlan: input.storePlan } : {}),
    ...(input.economicAllocation ? { economicAllocation: input.economicAllocation } : {}),
  };
};

export const buildRecoveredPaymentCaptureEconomicEntry = (input: {
  payment: CanonicalPayment;
  paymentIntentId: string;
  economicAllocation?: EconomicAllocationSnapshot;
}): StoreEconomicLedgerEntry => {
  if (!validIso(clean(input.payment.paidAt))) throw new Error('STORE_ECONOMIC_LEDGER_CAPTURE_SNAPSHOT_INVALID');
  return {
    ...baseFromPayment({ payment: input.payment, paymentIntentId: input.paymentIntentId, occurredAt: input.payment.paidAt, provider: input.payment.provider, providerPaymentId: input.payment.providerPaymentId, providerEventId: '', sourceAuthority: 'canonical_payment_snapshot' }),
    id: buildPaymentCaptureEconomicEntryId(input.payment.id), kind: 'payment_capture', amountMinor: brlToMinor(input.payment.amount), reversalOfEntryId: '',
    ...(input.economicAllocation ? { economicAllocation: input.economicAllocation } : {}),
  };
};

export const buildPaymentRefundEconomicEntry = (input: { payment: CanonicalPayment; event: VerifiedPaymentProviderEvent; capture: StoreEconomicLedgerEntry }): StoreEconomicLedgerEntry => {
  assertPaymentEventMatch(input.payment, input.event);
  if (input.event.eventType !== 'refund.succeeded') throw new Error('STORE_ECONOMIC_LEDGER_REFUND_EVENT_INVALID');
  assertCapture(input.capture, input.payment);
  return {
    ...baseFromPayment({ payment: input.payment, paymentIntentId: input.event.paymentIntentId, occurredAt: input.event.occurredAt, provider: input.event.provider, providerPaymentId: input.event.providerPaymentId, providerEventId: input.event.eventId, sourceAuthority: 'provider_webhook' }),
    id: buildPaymentRefundEconomicEntryId(input.payment.id), kind: 'payment_refund', amountMinor: -input.capture.amountMinor, reversalOfEntryId: input.capture.id,
    ...(input.capture.storePlan ? { storePlan: input.capture.storePlan } : {}),
    ...(input.capture.economicAllocation ? { economicAllocation: input.capture.economicAllocation } : {}),
  };
};

export const buildPaymentChargebackEconomicEntry = (input: { payment: CanonicalPayment; event: VerifiedPaymentProviderEvent; capture: StoreEconomicLedgerEntry }): StoreEconomicLedgerEntry => {
  assertPaymentEventMatch(input.payment, input.event);
  if (input.event.eventType !== 'chargeback.debited') throw new Error('STORE_ECONOMIC_LEDGER_CHARGEBACK_EVENT_INVALID');
  assertCapture(input.capture, input.payment);
  return {
    ...baseFromPayment({ payment: input.payment, paymentIntentId: input.event.paymentIntentId, occurredAt: input.event.occurredAt, provider: input.event.provider, providerPaymentId: input.event.providerPaymentId, providerEventId: input.event.eventId, sourceAuthority: 'provider_webhook' }),
    id: buildPaymentChargebackEconomicEntryId(input.payment.id), kind: 'payment_chargeback', amountMinor: -input.capture.amountMinor, reversalOfEntryId: input.capture.id,
    ...(input.capture.storePlan ? { storePlan: input.capture.storePlan } : {}),
    ...(input.capture.economicAllocation ? { economicAllocation: input.capture.economicAllocation } : {}),
  };
};

export const buildPaymentChargebackReversalEconomicEntry = (input: { payment: CanonicalPayment; event: VerifiedPaymentProviderEvent; chargeback: StoreEconomicLedgerEntry }): StoreEconomicLedgerEntry => {
  assertPaymentEventMatch(input.payment, input.event);
  if (input.event.eventType !== 'chargeback.reversed') throw new Error('STORE_ECONOMIC_LEDGER_CHARGEBACK_REVERSAL_EVENT_INVALID');
  if (input.chargeback.kind !== 'payment_chargeback' || input.chargeback.storeId !== input.payment.storeId || input.chargeback.paymentId !== input.payment.id || input.chargeback.amountMinor !== -brlToMinor(input.payment.amount)) {
    throw new Error('STORE_ECONOMIC_LEDGER_CHARGEBACK_MISMATCH');
  }
  return {
    ...baseFromPayment({ payment: input.payment, paymentIntentId: input.event.paymentIntentId, occurredAt: input.event.occurredAt, provider: input.event.provider, providerPaymentId: input.event.providerPaymentId, providerEventId: input.event.eventId, sourceAuthority: 'provider_webhook' }),
    id: buildPaymentChargebackReversalEconomicEntryId(input.payment.id), kind: 'payment_chargeback_reversal', amountMinor: Math.abs(input.chargeback.amountMinor), reversalOfEntryId: input.chargeback.id,
    ...(input.chargeback.storePlan ? { storePlan: input.chargeback.storePlan } : {}),
    ...(input.chargeback.economicAllocation ? { economicAllocation: input.chargeback.economicAllocation } : {}),
  };
};

export const deriveStoreEconomicLedgerSummary = (entries: readonly StoreEconomicLedgerEntry[]): StoreEconomicLedgerSummary => {
  let capturedMinor = 0;
  let refundedMinor = 0;
  let chargedBackMinor = 0;
  let chargebackReversedMinor = 0;
  for (const entry of entries) {
    if (!Number.isSafeInteger(entry.amountMinor) || entry.amountMinor === 0) throw new Error('STORE_ECONOMIC_LEDGER_ENTRY_AMOUNT_INVALID');
    if (entry.kind === 'payment_capture') {
      if (entry.amountMinor <= 0) throw new Error('STORE_ECONOMIC_LEDGER_CAPTURE_INVALID');
      capturedMinor += entry.amountMinor;
    } else if (entry.kind === 'payment_refund') {
      if (entry.amountMinor >= 0) throw new Error('STORE_ECONOMIC_LEDGER_REFUND_INVALID');
      refundedMinor += Math.abs(entry.amountMinor);
    } else if (entry.kind === 'payment_chargeback') {
      if (entry.amountMinor >= 0) throw new Error('STORE_ECONOMIC_LEDGER_CHARGEBACK_INVALID');
      chargedBackMinor += Math.abs(entry.amountMinor);
    } else {
      if (entry.amountMinor <= 0) throw new Error('STORE_ECONOMIC_LEDGER_CHARGEBACK_REVERSAL_INVALID');
      chargebackReversedMinor += entry.amountMinor;
    }
  }
  const grossAfterRefundsMinor = capturedMinor - refundedMinor;
  const economicNetMinor = grossAfterRefundsMinor - chargedBackMinor + chargebackReversedMinor;
  if ([capturedMinor, refundedMinor, grossAfterRefundsMinor, chargedBackMinor, chargebackReversedMinor, economicNetMinor].some(value => !Number.isSafeInteger(value))) {
    throw new Error('STORE_ECONOMIC_LEDGER_SUMMARY_OVERFLOW');
  }
  return { currency: STORE_ECONOMIC_LEDGER_CURRENCY, capturedMinor, refundedMinor, grossAfterRefundsMinor, chargedBackMinor, chargebackReversedMinor, economicNetMinor, entryCount: entries.length };
};
