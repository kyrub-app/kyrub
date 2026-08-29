import type { Transaction } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import type { PaymentStatus } from '../../src/utils/canonicalPayment.js';
import type { VerifiedPaymentProviderEvent } from '../../src/utils/paymentProvider.js';
import {
  ECONOMIC_OBLIGATION_SCHEMA_VERSION,
  buildStoreReceivableObligationFromCapture,
  economicObligationPath,
  type EconomicObligation,
} from '../../shared/economicObligations.js';
import type { StoreEconomicLedgerPaymentPlan } from './storeEconomicLedgerService.js';

export interface EconomicObligationsPaymentPlan {
  writes: Array<{
    ref: ReturnType<typeof adminDb.doc>;
    obligation: EconomicObligation;
  }>;
}

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

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
    obligation.status !== 'pending' ||
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
    !Number.isFinite(Date.parse(obligation.createdAt)) ||
    obligation.eligibleAt !== '' ||
    obligation.settledAt !== '' ||
    obligation.reversedAt !== ''
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

export const prepareEconomicObligationsPaymentPlan = async (input: {
  transaction: Transaction;
  economicLedgerPlan: StoreEconomicLedgerPaymentPlan | null;
  eventType: VerifiedPaymentProviderEvent['eventType'];
  previousPaymentStatus: PaymentStatus;
  duplicate: boolean;
}): Promise<EconomicObligationsPaymentPlan | null> => {
  // Forward-only V1: obligations are created only while a genuinely new
  // pending payment transitions to paid. Replayed or historical captures are
  // intentionally not backfilled by this path.
  if (
    input.duplicate ||
    input.eventType !== 'payment.paid' ||
    input.previousPaymentStatus !== 'pending' ||
    !input.economicLedgerPlan
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

export const applyEconomicObligationsPaymentPlan = (
  transaction: Transaction,
  plan: EconomicObligationsPaymentPlan | null
): void => {
  if (!plan) return;
  for (const write of plan.writes) {
    transaction.set(write.ref, write.obligation);
  }
};
