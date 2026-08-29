import type { PaymentContext } from '../src/utils/canonicalPayment.js';

export const PLATFORM_FEE_SUBSIDY_POLICY_SCHEMA_VERSION = 1 as const;
export const PLATFORM_FEE_SUBSIDY_BPS_DENOMINATOR = 10_000 as const;

export interface PlatformFeeSubsidyPolicy {
  schemaVersion: typeof PLATFORM_FEE_SUBSIDY_POLICY_SCHEMA_VERSION;
  id: string;
  version: number;
  status: 'active' | 'retired';
  platformFeeBps: number;
  platformSubsidyBps: number;
  contexts: PaymentContext[];
  effectiveFrom: string;
  createdAt: string;
  createdBy: string;
  supersedesPolicyId: string;
}

export interface PlatformFeeSubsidyPolicyPointer {
  schemaVersion: typeof PLATFORM_FEE_SUBSIDY_POLICY_SCHEMA_VERSION;
  activePolicyId: string;
  updatedAt: string;
  updatedBy: string;
}

export interface PlatformFeeSubsidyAssessment {
  policyId: string;
  policyVersion: number;
  grossMinor: number;
  platformFeeMinor: number;
  platformSubsidyMinor: number;
}

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const validIso = (value: string): boolean =>
  Boolean(value) && Number.isFinite(Date.parse(value));

const normalizeBps = (value: unknown, label: string): number => {
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < 0 || numeric > 10_000) {
    throw new Error(`PLATFORM_POLICY_${label}_BPS_INVALID`);
  }
  return numeric;
};

export const normalizePlatformFeeSubsidyPolicy = (
  value: unknown
): PlatformFeeSubsidyPolicy => {
  const policy = value as Partial<PlatformFeeSubsidyPolicy>;
  const id = clean(policy.id);
  const createdBy = clean(policy.createdBy);
  const supersedesPolicyId = clean(policy.supersedesPolicyId);
  if (
    policy.schemaVersion !== PLATFORM_FEE_SUBSIDY_POLICY_SCHEMA_VERSION ||
    !id ||
    id.includes('/') ||
    !Number.isSafeInteger(policy.version) ||
    Number(policy.version) < 1 ||
    (policy.status !== 'active' && policy.status !== 'retired') ||
    !Array.isArray(policy.contexts) ||
    policy.contexts.length === 0 ||
    policy.contexts.some(
      context => context !== 'marketplace' && context !== 'table' && context !== 'pos'
    ) ||
    !validIso(clean(policy.effectiveFrom)) ||
    !validIso(clean(policy.createdAt)) ||
    !createdBy
  ) {
    throw new Error('PLATFORM_FEE_SUBSIDY_POLICY_INVALID');
  }
  return {
    schemaVersion: PLATFORM_FEE_SUBSIDY_POLICY_SCHEMA_VERSION,
    id,
    version: Number(policy.version),
    status: policy.status,
    platformFeeBps: normalizeBps(policy.platformFeeBps, 'FEE'),
    platformSubsidyBps: normalizeBps(policy.platformSubsidyBps, 'SUBSIDY'),
    contexts: [...new Set(policy.contexts)],
    effectiveFrom: clean(policy.effectiveFrom),
    createdAt: clean(policy.createdAt),
    createdBy,
    supersedesPolicyId,
  };
};

export const buildDefaultPlatformFeeSubsidyPolicy = (
  createdAt: string
): PlatformFeeSubsidyPolicy => {
  if (!validIso(createdAt)) throw new Error('PLATFORM_POLICY_TIME_INVALID');
  return {
    schemaVersion: PLATFORM_FEE_SUBSIDY_POLICY_SCHEMA_VERSION,
    id: 'policy_zero_default_v1',
    version: 1,
    status: 'active',
    platformFeeBps: 0,
    platformSubsidyBps: 0,
    contexts: ['marketplace', 'table', 'pos'],
    effectiveFrom: '1970-01-01T00:00:00.000Z',
    createdAt,
    createdBy: 'system',
    supersedesPolicyId: '',
  };
};

export const calculatePlatformFeeSubsidyAssessment = (input: {
  policy: PlatformFeeSubsidyPolicy;
  paymentContext: PaymentContext;
  grossMinor: number;
  occurredAt: string;
}): PlatformFeeSubsidyAssessment => {
  const policy = normalizePlatformFeeSubsidyPolicy(input.policy);
  if (!Number.isSafeInteger(input.grossMinor) || input.grossMinor <= 0) {
    throw new Error('PLATFORM_POLICY_GROSS_INVALID');
  }
  if (!validIso(input.occurredAt)) throw new Error('PLATFORM_POLICY_TIME_INVALID');
  const applicable =
    policy.status === 'active' &&
    policy.contexts.includes(input.paymentContext) &&
    Date.parse(policy.effectiveFrom) <= Date.parse(input.occurredAt);
  if (!applicable) {
    return {
      policyId: policy.id,
      policyVersion: policy.version,
      grossMinor: input.grossMinor,
      platformFeeMinor: 0,
      platformSubsidyMinor: 0,
    };
  }

  const platformFeeMinor = Math.round(
    (input.grossMinor * policy.platformFeeBps) /
      PLATFORM_FEE_SUBSIDY_BPS_DENOMINATOR
  );
  const platformSubsidyMinor = Math.round(
    (input.grossMinor * policy.platformSubsidyBps) /
      PLATFORM_FEE_SUBSIDY_BPS_DENOMINATOR
  );
  if (
    !Number.isSafeInteger(platformFeeMinor) ||
    !Number.isSafeInteger(platformSubsidyMinor)
  ) {
    throw new Error('PLATFORM_POLICY_ASSESSMENT_INVALID');
  }
  return {
    policyId: policy.id,
    policyVersion: policy.version,
    grossMinor: input.grossMinor,
    platformFeeMinor,
    platformSubsidyMinor,
  };
};

export const platformFeeSubsidyPolicyPath = (policyIdInput: string): string => {
  const policyId = clean(policyIdInput);
  if (!policyId || policyId.includes('/')) throw new Error('PLATFORM_POLICY_ID_INVALID');
  return `kyrub_admin/platform_economy/fee_subsidy_policies/${policyId}`;
};

export const platformFeeSubsidyPolicyPointerPath = (): string =>
  'kyrub_admin/platform_economy/config/fee_subsidy_active';
