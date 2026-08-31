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

const positiveSafeInteger = (value: unknown): number | null =>
  Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : null;

const parseApprovedDecision = (value: unknown, deliveryId: string): {
  amountMinor: number;
  payer: 'store' | 'kyrub';
  policyId: string;
  policyVersion: number;
  responsibilityPolicyId: string;
  responsibilityPolicyVersion: number;
  decidedAt: string;
} | null => {
  const raw = record(value);
  const sourceInterval = record(raw.sourceInterval);
  const amountMinor = positiveSafeInteger(raw.amountMinor);
  const policyId = clean(raw.economicPolicyId);
  const policyVersion = positiveSafeInteger(raw.economicPolicyVersion);
  const responsibilityPolicyId = clean(raw.responsibilityPolicyId);
  const responsibilityPolicyVersion = positiveSafeInteger(raw.responsibilityPolicyVersion);
  const decidedAt = clean(raw.decidedAt);
  const payer = raw.payer === 'store' || raw.payer === 'kyrub' ? raw.payer : null;

  if (
    raw.schemaVersion !== 1 ||
    raw.status !== 'approved' ||
    raw.authority !== 'kyrub_billable_waiting_decision_engine' ||
    clean(raw.deliveryId) !== deliveryId ||
    raw.currency !== 'BRL' ||
    raw.responsibleActor !== 'store' ||
    payer === null ||
    amountMinor === null ||
    !policyId ||
    policyVersion === null ||
    !responsibilityPolicyId ||
    responsibilityPolicyVersion === null ||
    !decidedAt ||
    Number.isNaN(Date.parse(decidedAt)) ||
    sourceInterval.reasonCode !== 'store_not_ready_after_free_window' ||
    (sourceInterval.evidenceStatus !== 'authoritative' && sourceInterval.evidenceStatus !== 'corroborated')
  ) {
    return null;
  }

  return {
    amountMinor,
    payer,
    policyId,
    policyVersion,
    responsibilityPolicyId,
    responsibilityPolicyVersion,
    decidedAt,
  };
};

export const createPaidWaitingObligationFromApprovedDecision = async (input: {
  transaction: Transaction;
  operationalStoreId: string;
  orderId: string;
  deliveryId: string;
  courierId: string;
  decision: unknown;
}): Promise<DeliveryPaidWaitingCourierObligation | null> => {
  const decision = parseApprovedDecision(input.decision, input.deliveryId);
  if (!decision) return null;

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
    amountMinor: decision.amountMinor,
    payer: decision.payer,
    policyId: decision.policyId,
    policyVersion: decision.policyVersion,
    responsibilityPolicyId: decision.responsibilityPolicyId,
    responsibilityPolicyVersion: decision.responsibilityPolicyVersion,
    decidedAt: decision.decidedAt,
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
      Number(existing.policyVersion) === obligation.policyVersion &&
      clean(existing.responsibilityPolicyId) === obligation.responsibilityPolicyId &&
      Number(existing.responsibilityPolicyVersion) === obligation.responsibilityPolicyVersion &&
      clean(existing.billableWaitingDecisionRef) === obligation.billableWaitingDecisionRef;
    return same ? obligation : null;
  }

  input.transaction.create(obligationRef, obligation);
  return obligation;
};
