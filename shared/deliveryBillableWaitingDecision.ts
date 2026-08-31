import type { DeliveryPaidWaitingPolicySnapshot } from './deliveryPaidWaiting.js';
import type { DeliveryResponsibilityAssessment } from './deliveryResponsibilityAssessment.js';
import type { DeliveryResponsibilityInterval } from './deliveryOperationalResponsibility.js';

export const DELIVERY_BILLABLE_WAITING_DECISION_SCHEMA_VERSION = 1 as const;

export type DeliveryBillableWaitingDecisionStatus =
  | 'approved'
  | 'not_applicable'
  | 'review_required';

export interface DeliveryBillableWaitingDecision {
  schemaVersion: 1;
  deliveryId: string;
  status: DeliveryBillableWaitingDecisionStatus;
  payer: 'store' | 'kyrub' | null;
  responsibleActor: 'store' | null;
  approvedWaitingSeconds: number;
  billedIncrements: number;
  amountMinor: number;
  currency: 'BRL';
  sourceInterval: {
    startsAt: string;
    endsAt: string;
    durationSeconds: number;
    reasonCode: 'store_not_ready_after_free_window';
    evidenceStatus: 'authoritative' | 'corroborated';
    evidenceEventIds: string[];
  } | null;
  responsibilityPolicyId: string;
  responsibilityPolicyVersion: number;
  economicPolicyId: string;
  economicPolicyVersion: number;
  decidedAt: string;
  authority: 'kyrub_billable_waiting_decision_engine';
}

const positiveSafeInteger = (value: number, label: string): number => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`DELIVERY_BILLABLE_WAITING_${label}_INVALID`);
  }
  return value;
};

const nonNegativeSafeInteger = (value: number, label: string): number => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`DELIVERY_BILLABLE_WAITING_${label}_INVALID`);
  }
  return value;
};

const eligibleStoreInterval = (
  interval: DeliveryResponsibilityInterval
): interval is DeliveryResponsibilityInterval & {
  responsibleActor: 'store';
  reasonCode: 'store_not_ready_after_free_window';
  evidenceStatus: 'authoritative' | 'corroborated';
} =>
  interval.responsibleActor === 'store' &&
  interval.reasonCode === 'store_not_ready_after_free_window' &&
  (interval.evidenceStatus === 'authoritative' || interval.evidenceStatus === 'corroborated') &&
  Number.isSafeInteger(interval.durationSeconds) &&
  interval.durationSeconds > 0;

const emptyDecision = (input: {
  deliveryId: string;
  status: Exclude<DeliveryBillableWaitingDecisionStatus, 'approved'>;
  assessment: DeliveryResponsibilityAssessment;
  economicPolicy: DeliveryPaidWaitingPolicySnapshot;
  decidedAt: string;
}): DeliveryBillableWaitingDecision => ({
  schemaVersion: 1,
  deliveryId: input.deliveryId,
  status: input.status,
  payer: null,
  responsibleActor: null,
  approvedWaitingSeconds: 0,
  billedIncrements: 0,
  amountMinor: 0,
  currency: 'BRL',
  sourceInterval: null,
  responsibilityPolicyId: input.assessment.policyId,
  responsibilityPolicyVersion: input.assessment.policyVersion,
  economicPolicyId: input.economicPolicy.policyId,
  economicPolicyVersion: input.economicPolicy.version,
  decidedAt: input.decidedAt,
  authority: 'kyrub_billable_waiting_decision_engine',
});

export const decideDeliveryBillableWaiting = (input: {
  assessment: DeliveryResponsibilityAssessment;
  economicPolicy: DeliveryPaidWaitingPolicySnapshot;
  decidedAt: string;
}): DeliveryBillableWaitingDecision => {
  const deliveryId = input.assessment.deliveryId.trim();
  const economicPolicyId = input.economicPolicy.policyId.trim();
  const responsibilityPolicyId = input.assessment.policyId.trim();
  const decidedAt = input.decidedAt.trim();

  if (!deliveryId || !economicPolicyId || !responsibilityPolicyId || !decidedAt) {
    throw new Error('DELIVERY_BILLABLE_WAITING_INPUT_INVALID');
  }
  if (input.economicPolicy.enabled !== true) {
    return emptyDecision({
      deliveryId,
      status: 'not_applicable',
      assessment: input.assessment,
      economicPolicy: input.economicPolicy,
      decidedAt,
    });
  }

  positiveSafeInteger(input.assessment.policyVersion, 'RESPONSIBILITY_POLICY_VERSION');
  positiveSafeInteger(input.economicPolicy.version, 'ECONOMIC_POLICY_VERSION');
  const incrementMinutes = positiveSafeInteger(
    input.economicPolicy.billingIncrementMinutes,
    'BILLING_INCREMENT_MINUTES'
  );
  const amountPerIncrementMinor = positiveSafeInteger(
    input.economicPolicy.amountPerIncrementMinor,
    'AMOUNT_PER_INCREMENT'
  );
  const maxAmountMinor = nonNegativeSafeInteger(
    input.economicPolicy.maxAmountMinor,
    'MAX_AMOUNT'
  );

  if (input.economicPolicy.payer !== 'store' && input.economicPolicy.payer !== 'kyrub') {
    throw new Error('DELIVERY_BILLABLE_WAITING_PAYER_INVALID');
  }

  if (input.assessment.status === 'review_required' || input.assessment.status === 'external') {
    return emptyDecision({
      deliveryId,
      status: 'review_required',
      assessment: input.assessment,
      economicPolicy: input.economicPolicy,
      decidedAt,
    });
  }

  const candidates = input.assessment.intervals.filter(eligibleStoreInterval);
  if (candidates.length === 0) {
    return emptyDecision({
      deliveryId,
      status: 'not_applicable',
      assessment: input.assessment,
      economicPolicy: input.economicPolicy,
      decidedAt,
    });
  }
  if (candidates.length !== 1) {
    return emptyDecision({
      deliveryId,
      status: 'review_required',
      assessment: input.assessment,
      economicPolicy: input.economicPolicy,
      decidedAt,
    });
  }

  const source = candidates[0];
  const approvedWaitingSeconds = positiveSafeInteger(
    source.durationSeconds,
    'APPROVED_WAITING_SECONDS'
  );
  const incrementSeconds = incrementMinutes * 60;
  const billedIncrements = Math.ceil(approvedWaitingSeconds / incrementSeconds);
  const rawAmountMinor = billedIncrements * amountPerIncrementMinor;
  if (!Number.isSafeInteger(rawAmountMinor)) {
    throw new Error('DELIVERY_BILLABLE_WAITING_AMOUNT_OVERFLOW');
  }
  const amountMinor = maxAmountMinor > 0 ? Math.min(rawAmountMinor, maxAmountMinor) : rawAmountMinor;

  return {
    schemaVersion: 1,
    deliveryId,
    status: 'approved',
    payer: input.economicPolicy.payer,
    responsibleActor: 'store',
    approvedWaitingSeconds,
    billedIncrements,
    amountMinor,
    currency: 'BRL',
    sourceInterval: {
      startsAt: source.startsAt,
      endsAt: source.endsAt,
      durationSeconds: source.durationSeconds,
      reasonCode: 'store_not_ready_after_free_window',
      evidenceStatus: source.evidenceStatus,
      evidenceEventIds: [...source.evidenceEventIds],
    },
    responsibilityPolicyId: responsibilityPolicyId,
    responsibilityPolicyVersion: input.assessment.policyVersion,
    economicPolicyId,
    economicPolicyVersion: input.economicPolicy.version,
    decidedAt,
    authority: 'kyrub_billable_waiting_decision_engine',
  };
};
