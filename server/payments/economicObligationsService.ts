import type { Transaction } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import type { PaymentStatus } from '../../src/utils/canonicalPayment.js';
import type { VerifiedPaymentProviderEvent } from '../../src/utils/paymentProvider.js';
import {
  ECONOMIC_OBLIGATION_SCHEMA_VERSION,
  buildStoreReceivableObligationFromCapture,
  buildStoreReceivableObligationId,
  economicObligationPath,
  type EconomicObligation,
} from '../../shared/economicObligations.js';
import { reverseEconomicObligationBeforeSettlement } from '../../shared/economicObligationLifecycle.js';
import type { StoreEconomicLedgerPaymentPlan } from './storeEconomicLedgerService.js';

export interface EconomicObligationsPaymentPlan {
  writes: Array<{
    ref: ReturnType<typeof adminDb.doc>;
    obligation: EconomicObligation;
  }>;
}

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const validIso = (value: string): boolean =>
  Boolean(value) && Number.isFinite(Date.parse(value));

const validLifecycleState = (obligation: Partial<EconomicObligation>): boolean => {
  if (obligation.status === 'pending') {
    return obligation.eligibleAt === '' && obligation.settledAt === '' && obligation.reversedAt === '';
  }
  if (obligation.status === 'eligible') {
    return Boolean(obligation.eligibleAt && validIso(obligation.eligibleAt)) &&
      obligation.settledAt === '' &&
      obligation.reversedAt === '';
  }
  if (obligation.status === 'settled') {
    return Boolean(obligation.eligibleAt && validIso(obligation.eligibleAt)) &&
      Boolean(obligation.settledAt && validIso(obligation.settledAt)) &&
      obligation.reversedAt === '';
  }
  if (obligation.status === 'reversed') {
    return obligation.settledAt === '' &&
      Boolean(obligation.reversedAt && validIso(obligation.reversedAt)) &&
      (obligation.eligibleAt === '' || Boolean(obligation.eligibleAt && validIso(obligation.eligibleAt)));
  }
  return false;
};

const parseStoredObligation = (
  value: unknown,
  expectedStoreId: string,
  expectedId: string
): EconomicObligation => {
  const obligation = value as Partial<EconomicObligation>;
  if (
    obligation.schemaVersion !== ECONOMIC_OBLIGATION_SCHEMA_VERSION ||
    obligation.id !== expectedId ||
    obligation.storeId !== expectedStoreId ||
    obligation.kind !== 'store_receivable' ||
    !validLifecycleState(obligation) ||
    obligation.currency !== 'BRL' ||
    !Number.isSafeInteger(obligation.amountMinor) ||
    Number(obligation.amountMinor) <= 0 ||
    obligation.beneficiaryType !== 'store' ||
    obligation.beneficiaryPrincipalId !== `store:${expectedStoreId}` ||
    !clean(obligation.paymentId) ||
    !clean(obligation.orderId) ||
    obligation.fulfillmentId !== '' ||
    !clean(obligation.sourceEconomicEntryId) ||
    obligation.sourceAuthority !== 'economic_allocation_snapshot' ||
    !obligation.funding ||
    !Number.isSafeInteger(obligation.funding.customerMinor) ||
    obligation.funding.customerMinor < 0 ||
    !Number.isSafeInteger(obligation.funding.kyrubMinor) ||
    obligation.funding.kyrubMinor < 0 ||
    !Number.isSafeInteger(obligation.funding.partnerMinor) ||
    obligation.funding.partnerMinor < 0 ||
    !Number.isSafeInteger(obligation.funding.storeFundedDiscountMinor) ||
    obligation.funding.storeFundedDiscountMinor < 0 ||
    !clean(obligation.createdAt) ||
    !validIso(obligation.createdAt)
  ) {
    throw new Error('ECONOMIC_OBLIGATION_STORED_DOCUMENT_INVALID');
  }
  return obligation as EconomicObligation;
};

const assertObligationEquivalent = (
  existing: EconomicObligation,
  expected: EconomicObligation
): void => {
  const immutableKeys: Array<keyof EconomicObligation> = [
    'id',
    'storeId',
    'kind',
    'status',
    'currency',
    'amountMinor',
    'beneficiaryType',
    'beneficiaryPrincipalId',
    'paymentId',
    'orderId',
    'fulfillmentId',
    'sourceEconomicEntryId',
    'sourceAuthority',
    'createdAt',
    'eligibleAt',
    'settledAt',
    'reversedAt',
  ];
  for (const key of immutableKeys) {
    if (existing[key] !== expected[key]) {
      throw new Error(`ECONOMIC_OBLIGATION_CONFLICT:${String(key)}`);
    }
  }
  if (JSON.stringify(existing.funding) !== JSON.stringify(expected.funding)) {
    throw new Error('ECONOMIC_OBLIGATION_CONFLICT:funding');
  }
};

const prepareStoreReceivableCreation = async (input: {
  transaction: Transaction;
  economicLedgerPlan: StoreEconomicLedgerPaymentPlan;
  eventType: VerifiedPaymentProviderEvent['eventType'];
  previousPaymentStatus: PaymentStatus;
}): Promise<EconomicObligationsPaymentPlan | null> => {
  if (
    input.eventType !== 'payment.paid' ||
    input.previousPaymentStatus !== 'pending'
  ) {
    return null;
  }

  const plannedCaptures = input.economicLedgerPlan.writes
    .map(write => write.entry)
    .filter(entry => entry.kind === 'payment_capture');
  if (plannedCaptures.length === 0) return null;
  if (plannedCaptures.length !== 1) {
    throw new Error('ECONOMIC_OBLIGATION_CAPTURE_PLAN_INVALID');
  }

  const capture = plannedCaptures[0];
  if (!capture.economicAllocation) {
    // Non-marketplace or otherwise non-allocated captures have no receivable
    // authority in this V1. Do not infer economics that were not snapshotted.
    return null;
  }

  const obligation = buildStoreReceivableObligationFromCapture(capture);
  if (!obligation) return null;

  const ref = adminDb.doc(economicObligationPath(obligation.storeId, obligation.id));
  const snapshot = await input.transaction.get(ref);
  if (snapshot.exists) {
    assertObligationEquivalent(
      parseStoredObligation(snapshot.data(), obligation.storeId, obligation.id),
      obligation
    );
    return { writes: [] };
  }

  return { writes: [{ ref, obligation }] };
};

const prepareStoreReceivableRefundReversal = async (input: {
  transaction: Transaction;
  economicLedgerPlan: StoreEconomicLedgerPaymentPlan;
  eventType: VerifiedPaymentProviderEvent['eventType'];
  previousPaymentStatus: PaymentStatus;
}): Promise<EconomicObligationsPaymentPlan | null> => {
  // Forward-only V1: only the first authoritative full-refund transition is
  // allowed to reverse an obligation. Historical refunds are not backfilled.
  if (
    input.eventType !== 'refund.succeeded' ||
    input.previousPaymentStatus !== 'refund_processing'
  ) {
    return null;
  }

  const plannedRefunds = input.economicLedgerPlan.writes
    .map(write => write.entry)
    .filter(entry => entry.kind === 'payment_refund');
  if (plannedRefunds.length === 0) return null;
  if (plannedRefunds.length !== 1) {
    throw new Error('ECONOMIC_OBLIGATION_REFUND_PLAN_INVALID');
  }

  const refund = plannedRefunds[0];
  const obligationId = buildStoreReceivableObligationId(refund.paymentId);
  const ref = adminDb.doc(economicObligationPath(refund.storeId, obligationId));
  const snapshot = await input.transaction.get(ref);

  // Payments captured before obligation persistence was introduced remain
  // historical. A refund must not manufacture a receivable only to reverse it.
  if (!snapshot.exists) return null;

  const obligation = parseStoredObligation(snapshot.data(), refund.storeId, obligationId);
  if (obligation.paymentId !== refund.paymentId) {
    throw new Error('ECONOMIC_OBLIGATION_REFUND_PAYMENT_MISMATCH');
  }
  if (refund.reversalOfEntryId !== obligation.sourceEconomicEntryId) {
    throw new Error('ECONOMIC_OBLIGATION_REFUND_CAPTURE_MISMATCH');
  }
  if (obligation.status === 'reversed') {
    return { writes: [] };
  }

  const reversed = reverseEconomicObligationBeforeSettlement({
    obligation,
    occurredAt: refund.occurredAt,
  });
  return { writes: [{ ref, obligation: reversed }] };
};

export const prepareEconomicObligationsPaymentPlan = async (input: {
  transaction: Transaction;
  economicLedgerPlan: StoreEconomicLedgerPaymentPlan | null;
  eventType: VerifiedPaymentProviderEvent['eventType'];
  previousPaymentStatus: PaymentStatus;
  duplicate: boolean;
}): Promise<EconomicObligationsPaymentPlan | null> => {
  if (input.duplicate || !input.economicLedgerPlan) return null;

  const creation = await prepareStoreReceivableCreation({
    transaction: input.transaction,
    economicLedgerPlan: input.economicLedgerPlan,
    eventType: input.eventType,
    previousPaymentStatus: input.previousPaymentStatus,
  });
  if (creation) return creation;

  return prepareStoreReceivableRefundReversal({
    transaction: input.transaction,
    economicLedgerPlan: input.economicLedgerPlan,
    eventType: input.eventType,
    previousPaymentStatus: input.previousPaymentStatus,
  });
};

export const applyEconomicObligationsPaymentPlan = (
  transaction: Transaction,
  plan: EconomicObligationsPaymentPlan | null
): void => {
  if (!plan) return;
  for (const write of plan.writes) {
    transaction.set(write.ref, write.obligation);
  }
};
