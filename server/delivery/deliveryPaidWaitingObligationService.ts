import type { Transaction } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import {
  buildDeliveryPaidWaitingCourierObligation,
  type DeliveryPaidWaitingCourierObligation,
} from '../../shared/deliveryPaidWaitingObligation.js';

const clean = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const timestampIso = (value: unknown): string => {
  if (
    value &&
    typeof value === 'object' &&
    'toDate' in value &&
    typeof (value as { toDate?: unknown }).toDate === 'function'
  ) {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  return '';
};

export const createPaidWaitingObligationIfAuthoritative = async (input: {
  transaction: Transaction;
  operationalStoreId: string;
  orderId: string;
  deliveryId: string;
  courierId: string;
  evidence: Record<string, unknown>;
}): Promise<DeliveryPaidWaitingCourierObligation | null> => {
  const amountMinor = Number(input.evidence.amountMinor);
  if (
    input.evidence.status !== 'calculated' ||
    input.evidence.policyApplied !== true ||
    !Number.isSafeInteger(amountMinor) ||
    amountMinor <= 0
  ) {
    return null;
  }

  const policy = record(input.evidence.policySnapshot);
  const payer = policy.payer === 'store' || policy.payer === 'kyrub'
    ? policy.payer
    : null;
  const policyId = clean(policy.policyId);
  const policyVersion = Number(policy.version);
  const collectedAt = timestampIso(input.evidence.collectedAt);
  if (
    !payer ||
    !policyId ||
    !Number.isSafeInteger(policyVersion) ||
    policyVersion <= 0 ||
    !collectedAt
  ) {
    return null;
  }

  const tenantSnapshot = await input.transaction.get(
    adminDb.doc(`tenants/${input.operationalStoreId}`)
  );
  const canonicalStoreId = clean(tenantSnapshot.data()?.canonicalStoreId);
  if (!canonicalStoreId) return null;

  const obligation = buildDeliveryPaidWaitingCourierObligation({
    canonicalStoreId,
    orderId: input.orderId,
    deliveryId: input.deliveryId,
    courierId: input.courierId,
    amountMinor,
    payer,
    policyId,
    policyVersion,
    collectedAt,
  });
  const obligationRef = adminDb.doc(
    `stores/${canonicalStoreId}/economicObligations/${encodeURIComponent(obligation.id)}`
  );
  const existingSnapshot = await input.transaction.get(obligationRef);
  if (existingSnapshot.exists) {
    const existing = existingSnapshot.data() as Record<string, unknown>;
    const same =
      clean(existing.id) === obligation.id &&
      clean(existing.storeId) === obligation.storeId &&
      existing.kind === obligation.kind &&
      Number(existing.amountMinor) === obligation.amountMinor &&
      clean(existing.beneficiaryPrincipalId) === obligation.beneficiaryPrincipalId &&
      clean(existing.orderId) === obligation.orderId &&
      clean(existing.fulfillmentId) === obligation.fulfillmentId &&
      existing.sourceAuthority === obligation.sourceAuthority &&
      existing.payer === obligation.payer &&
      clean(existing.policyId) === obligation.policyId &&
      Number(existing.policyVersion) === obligation.policyVersion;
    return same ? obligation : null;
  }

  input.transaction.create(obligationRef, obligation);
  return obligation;
};
