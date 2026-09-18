export interface FixedBuyerFeePolicy {
  type: 'fixed';
  amount: number;
}

export interface MerchantSaleFeePolicy {
  type: 'percentage';
  ratePercent: number;
}

export interface PlatformFeePolicy {
  id: string;
  version: number;
  effectiveFrom: string;
  buyerFee: FixedBuyerFeePolicy;
  merchantSaleFee: MerchantSaleFeePolicy;
}

export interface PlatformFeeSnapshot extends PlatformFeePolicy {
  saleAmount: number;
  buyerFeeAmount: number;
  merchantSaleFeeAmount: number;
  grossPlatformFeeAmount: number;
}

const money = (value: number, label: string): number => {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a finite non-negative number.`);
  }
  return Number(value.toFixed(2));
};

const clean = (value: string, label: string): string => {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
};

export const calculatePlatformFeeSnapshot = (input: {
  saleAmount: number;
  policy: PlatformFeePolicy;
}): PlatformFeeSnapshot => {
  const saleAmount = money(input.saleAmount, 'sale amount');
  const policy = input.policy;
  if (!Number.isInteger(policy.version) || policy.version <= 0) {
    throw new Error('Platform fee policy version must be a positive integer.');
  }
  if (
    policy.buyerFee.type !== 'fixed' ||
    policy.merchantSaleFee.type !== 'percentage' ||
    !Number.isFinite(policy.merchantSaleFee.ratePercent) ||
    policy.merchantSaleFee.ratePercent < 0 ||
    policy.merchantSaleFee.ratePercent > 100
  ) {
    throw new Error('Platform fee policy is invalid.');
  }

  const buyerFeeAmount = money(policy.buyerFee.amount, 'buyer fee');
  const merchantSaleFeeAmount = money(
    saleAmount * (policy.merchantSaleFee.ratePercent / 100),
    'merchant sale fee'
  );

  return {
    id: clean(policy.id, 'platform fee policy id'),
    version: policy.version,
    effectiveFrom: clean(policy.effectiveFrom, 'platform fee policy effective date'),
    buyerFee: { ...policy.buyerFee, amount: buyerFeeAmount },
    merchantSaleFee: { ...policy.merchantSaleFee },
    saleAmount,
    buyerFeeAmount,
    merchantSaleFeeAmount,
    grossPlatformFeeAmount: money(
      buyerFeeAmount + merchantSaleFeeAmount,
      'gross platform fee'
    ),
  };
};

/**
 * Provider cost is intentionally absent from the public fee snapshot. It is an
 * internal Kyrub operating cost and may change as routing moves between PSP/BaaS
 * providers without changing the buyer or merchant fee contract.
 */
export interface InternalProviderCostObservation {
  provider: string;
  paymentId: string;
  amount: number;
  recordedAt: string;
}
