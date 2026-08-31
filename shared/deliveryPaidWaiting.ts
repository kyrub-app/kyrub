export interface DeliveryPaidWaitingPolicySnapshot {
  policyId: string;
  version: number;
  enabled: boolean;
  freeMinutes: number;
  billingIncrementMinutes: number;
  amountPerIncrementMinor: number;
  maxAmountMinor: number;
  payer: 'store' | 'kyrub';
}

export interface DeliveryPaidWaitingResult {
  totalWaitSeconds: number;
  freeSeconds: number;
  billableSeconds: number;
  billedIncrements: number;
  amountMinor: number;
  policyApplied: boolean;
}

const nonNegativeInteger = (value: number, label: string): number => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`DELIVERY_WAITING_${label}_INVALID`);
  }
  return value;
};

export const calculateDeliveryPaidWaiting = (input: {
  arrivedAtMs: number;
  collectedAtMs: number;
  policy?: DeliveryPaidWaitingPolicySnapshot | null;
}): DeliveryPaidWaitingResult => {
  if (!Number.isFinite(input.arrivedAtMs) || !Number.isFinite(input.collectedAtMs)) {
    throw new Error('DELIVERY_WAITING_TIMESTAMP_INVALID');
  }
  if (input.collectedAtMs < input.arrivedAtMs) {
    throw new Error('DELIVERY_WAITING_NEGATIVE_DURATION');
  }

  const totalWaitSeconds = Math.max(
    0,
    Math.floor((input.collectedAtMs - input.arrivedAtMs) / 1000)
  );
  const policy = input.policy;
  if (!policy || policy.enabled !== true) {
    return {
      totalWaitSeconds,
      freeSeconds: totalWaitSeconds,
      billableSeconds: 0,
      billedIncrements: 0,
      amountMinor: 0,
      policyApplied: false,
    };
  }

  const freeMinutes = nonNegativeInteger(policy.freeMinutes, 'FREE_MINUTES');
  const incrementMinutes = nonNegativeInteger(
    policy.billingIncrementMinutes,
    'INCREMENT_MINUTES'
  );
  const amountPerIncrementMinor = nonNegativeInteger(
    policy.amountPerIncrementMinor,
    'AMOUNT_PER_INCREMENT'
  );
  const maxAmountMinor = nonNegativeInteger(policy.maxAmountMinor, 'MAX_AMOUNT');
  if (!policy.policyId.trim() || !Number.isSafeInteger(policy.version) || policy.version <= 0) {
    throw new Error('DELIVERY_WAITING_POLICY_IDENTITY_INVALID');
  }
  if (incrementMinutes <= 0 || amountPerIncrementMinor <= 0) {
    throw new Error('DELIVERY_WAITING_POLICY_RATE_INVALID');
  }
  if (policy.payer !== 'store' && policy.payer !== 'kyrub') {
    throw new Error('DELIVERY_WAITING_POLICY_PAYER_INVALID');
  }

  const freeSecondsConfigured = freeMinutes * 60;
  const freeSeconds = Math.min(totalWaitSeconds, freeSecondsConfigured);
  const billableSeconds = Math.max(0, totalWaitSeconds - freeSecondsConfigured);
  const incrementSeconds = incrementMinutes * 60;
  const billedIncrements = billableSeconds === 0
    ? 0
    : Math.ceil(billableSeconds / incrementSeconds);
  const rawAmountMinor = billedIncrements * amountPerIncrementMinor;
  if (!Number.isSafeInteger(rawAmountMinor)) {
    throw new Error('DELIVERY_WAITING_AMOUNT_OVERFLOW');
  }
  const amountMinor = maxAmountMinor > 0
    ? Math.min(rawAmountMinor, maxAmountMinor)
    : rawAmountMinor;

  return {
    totalWaitSeconds,
    freeSeconds,
    billableSeconds,
    billedIncrements,
    amountMinor,
    policyApplied: true,
  };
};
