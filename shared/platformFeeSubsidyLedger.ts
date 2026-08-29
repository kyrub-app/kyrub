import type { CanonicalPayment } from '../src/utils/canonicalPayment.js';
import type { VerifiedPaymentProviderEvent } from '../src/utils/paymentProvider.js';
import {
  buildStoreEconomicLedgerPaymentBase,
  type StoreEconomicLedgerEntry,
} from './storeEconomicLedger.js';
import type {
  PlatformFeeSubsidyAssessment,
  PlatformFeeSubsidyPolicy,
} from './platformFeeSubsidyPolicy.js';

export interface PlatformPolicyEconomicEntry extends StoreEconomicLedgerEntry {
  policyId: string;
  policyVersion: number;
  basisGrossMinor: number;
  basisBps: number;
}

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const policyEntryId = (kind: string, paymentIdInput: string): string => {
  const paymentId = clean(paymentIdInput);
  if (!paymentId) throw new Error('PLATFORM_POLICY_PAYMENT_REQUIRED');
  return `platform:${kind}:${paymentId}`;
};

export const buildPlatformFeeEntryId = (paymentId: string): string =>
  policyEntryId('fee', paymentId);

export const buildPlatformFeeReversalEntryId = (paymentId: string): string =>
  policyEntryId('fee-reversal', paymentId);

export const buildPlatformSubsidyEntryId = (paymentId: string): string =>
  policyEntryId('subsidy', paymentId);

export const buildPlatformSubsidyReversalEntryId = (paymentId: string): string =>
  policyEntryId('subsidy-reversal', paymentId);

const assertAssessment = (
  assessment: PlatformFeeSubsidyAssessment,
  policy: PlatformFeeSubsidyPolicy
): void => {
  if (
    assessment.policyId !== policy.id ||
    assessment.policyVersion !== policy.version ||
    !Number.isSafeInteger(assessment.grossMinor) ||
    assessment.grossMinor <= 0 ||
    !Number.isSafeInteger(assessment.platformFeeMinor) ||
    assessment.platformFeeMinor < 0 ||
    !Number.isSafeInteger(assessment.platformSubsidyMinor) ||
    assessment.platformSubsidyMinor < 0
  ) {
    throw new Error('PLATFORM_POLICY_ASSESSMENT_MISMATCH');
  }
};

const base = (input: {
  payment: CanonicalPayment;
  event: VerifiedPaymentProviderEvent;
}) => buildStoreEconomicLedgerPaymentBase({
  payment: input.payment,
  paymentIntentId: input.event.paymentIntentId,
  occurredAt: input.event.occurredAt,
  provider: input.event.provider,
  providerPaymentId: input.event.providerPaymentId,
  providerEventId: input.event.eventId,
  sourceAuthority: 'platform_policy_snapshot',
});

export const buildPlatformPolicyCaptureEntries = (input: {
  payment: CanonicalPayment;
  event: VerifiedPaymentProviderEvent;
  policy: PlatformFeeSubsidyPolicy;
  assessment: PlatformFeeSubsidyAssessment;
}): PlatformPolicyEconomicEntry[] => {
  if (input.event.eventType !== 'payment.paid') {
    throw new Error('PLATFORM_POLICY_CAPTURE_EVENT_INVALID');
  }
  assertAssessment(input.assessment, input.policy);
  const common = base(input);
  const entries: PlatformPolicyEconomicEntry[] = [];

  if (input.assessment.platformFeeMinor > 0) {
    entries.push({
      ...common,
      id: buildPlatformFeeEntryId(input.payment.id),
      kind: 'platform_fee_assessed',
      amountMinor: -input.assessment.platformFeeMinor,
      reversalOfEntryId: '',
      policyId: input.policy.id,
      policyVersion: input.policy.version,
      basisGrossMinor: input.assessment.grossMinor,
      basisBps: input.policy.platformFeeBps,
    });
  }

  if (input.assessment.platformSubsidyMinor > 0) {
    entries.push({
      ...common,
      id: buildPlatformSubsidyEntryId(input.payment.id),
      kind: 'platform_subsidy_granted',
      amountMinor: input.assessment.platformSubsidyMinor,
      reversalOfEntryId: '',
      policyId: input.policy.id,
      policyVersion: input.policy.version,
      basisGrossMinor: input.assessment.grossMinor,
      basisBps: input.policy.platformSubsidyBps,
    });
  }
  return entries;
};

export const buildPlatformPolicyRefundReversals = (input: {
  payment: CanonicalPayment;
  event: VerifiedPaymentProviderEvent;
  originalEntries: PlatformPolicyEconomicEntry[];
}): PlatformPolicyEconomicEntry[] => {
  if (input.event.eventType !== 'refund.succeeded') {
    throw new Error('PLATFORM_POLICY_REFUND_EVENT_INVALID');
  }
  const common = base(input);
  return input.originalEntries.map(original => {
    if (
      original.paymentId !== input.payment.id ||
      original.storeId !== input.payment.storeId ||
      (original.kind !== 'platform_fee_assessed' &&
        original.kind !== 'platform_subsidy_granted')
    ) {
      throw new Error('PLATFORM_POLICY_ORIGINAL_ENTRY_INVALID');
    }
    const reversingFee = original.kind === 'platform_fee_assessed';
    return {
      ...common,
      id: reversingFee
        ? buildPlatformFeeReversalEntryId(input.payment.id)
        : buildPlatformSubsidyReversalEntryId(input.payment.id),
      kind: reversingFee ? 'platform_fee_reversed' : 'platform_subsidy_reversed',
      amountMinor: -original.amountMinor,
      reversalOfEntryId: original.id,
      policyId: original.policyId,
      policyVersion: original.policyVersion,
      basisGrossMinor: original.basisGrossMinor,
      basisBps: original.basisBps,
    };
  });
};
