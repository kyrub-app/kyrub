export const STORE_REWARD_SCHEMA_VERSION = 1 as const;
export const STORE_REWARD_MAX_DEFINITIONS = 50 as const;

export type StoreRewardStatus = 'draft' | 'active' | 'paused' | 'ended';
export type StoreRewardDiscountType = 'percentage' | 'fixed';

export interface StoreRewardDefinition {
  schemaVersion: typeof STORE_REWARD_SCHEMA_VERSION;
  id: string;
  storeId: string;
  title: string;
  description: string;
  costPoints: number;
  discountType: StoreRewardDiscountType;
  discountValue: number;
  productIds: string[];
  voucherValidityHours: number;
  startsAt: string;
  endsAt: string;
  status: StoreRewardStatus;
  createdAt: string;
  updatedAt: string;
}

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const required = (value: unknown, code: string): string => {
  const normalized = clean(value);
  if (!normalized) throw new Error(code);
  return normalized;
};

const positiveInteger = (value: unknown, code: string): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(code);
  }
  return value;
};

const iso = (value: unknown, code: string): string => {
  const normalized = required(value, code);
  if (!Number.isFinite(Date.parse(normalized))) throw new Error(code);
  return normalized;
};

const uniqueIds = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(value.map(clean).filter(Boolean))
  ).slice(0, 200);
};

export const normalizeStoreRewardDefinition = (
  value: unknown
): StoreRewardDefinition => {
  if (!value || typeof value !== 'object') {
    throw new Error('STORE_REWARD_INVALID');
  }
  const candidate = value as Record<string, unknown>;
  const status = candidate.status;
  const discountType = candidate.discountType;
  if (
    status !== 'draft' &&
    status !== 'active' &&
    status !== 'paused' &&
    status !== 'ended'
  ) {
    throw new Error('STORE_REWARD_STATUS_INVALID');
  }
  if (discountType !== 'percentage' && discountType !== 'fixed') {
    throw new Error('STORE_REWARD_DISCOUNT_TYPE_INVALID');
  }
  if (
    typeof candidate.discountValue !== 'number' ||
    !Number.isFinite(candidate.discountValue) ||
    candidate.discountValue <= 0 ||
    (discountType === 'percentage' && candidate.discountValue >= 100)
  ) {
    throw new Error('STORE_REWARD_DISCOUNT_VALUE_INVALID');
  }

  const startsAt = iso(candidate.startsAt, 'STORE_REWARD_START_REQUIRED');
  const endsAt = iso(candidate.endsAt, 'STORE_REWARD_END_REQUIRED');
  if (Date.parse(startsAt) >= Date.parse(endsAt)) {
    throw new Error('STORE_REWARD_PERIOD_INVALID');
  }
  const productIds = uniqueIds(candidate.productIds);
  if (productIds.length === 0) {
    throw new Error('STORE_REWARD_PRODUCTS_REQUIRED');
  }

  return {
    schemaVersion: STORE_REWARD_SCHEMA_VERSION,
    id: required(candidate.id, 'STORE_REWARD_ID_REQUIRED'),
    storeId: required(candidate.storeId, 'STORE_REWARD_STORE_REQUIRED'),
    title: required(candidate.title, 'STORE_REWARD_TITLE_REQUIRED'),
    description: clean(candidate.description),
    costPoints: positiveInteger(
      candidate.costPoints,
      'STORE_REWARD_COST_INVALID'
    ),
    discountType,
    discountValue:
      discountType === 'fixed'
        ? Math.round(candidate.discountValue * 100) / 100
        : candidate.discountValue,
    productIds,
    voucherValidityHours: positiveInteger(
      candidate.voucherValidityHours,
      'STORE_REWARD_VALIDITY_INVALID'
    ),
    startsAt,
    endsAt,
    status,
    createdAt: iso(candidate.createdAt, 'STORE_REWARD_CREATED_AT_REQUIRED'),
    updatedAt: iso(candidate.updatedAt, 'STORE_REWARD_UPDATED_AT_REQUIRED'),
  };
};

export const normalizeStoreRewardDefinitions = (
  value: unknown
): StoreRewardDefinition[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap(candidate => {
    try {
      const reward = normalizeStoreRewardDefinition(candidate);
      if (seen.has(reward.id)) return [];
      seen.add(reward.id);
      return [reward];
    } catch {
      return [];
    }
  });
};

export const isStoreRewardAvailableAt = (
  rewardInput: StoreRewardDefinition,
  occurredAt: string
): boolean => {
  const reward = normalizeStoreRewardDefinition(rewardInput);
  const timestamp = Date.parse(occurredAt);
  return reward.status === 'active' &&
    Number.isFinite(timestamp) &&
    timestamp >= Date.parse(reward.startsAt) &&
    timestamp < Date.parse(reward.endsAt);
};

export const storeRewardVoucherEndsAt = (
  rewardInput: StoreRewardDefinition,
  redeemedAt: string
): string => {
  const reward = normalizeStoreRewardDefinition(rewardInput);
  const redeemedTimestamp = Date.parse(redeemedAt);
  if (!Number.isFinite(redeemedTimestamp)) {
    throw new Error('STORE_REWARD_REDEEMED_AT_INVALID');
  }
  const validityEnd =
    redeemedTimestamp + reward.voucherValidityHours * 60 * 60 * 1000;
  const rewardEnd = Date.parse(reward.endsAt);
  const end = Math.min(validityEnd, rewardEnd);
  if (end <= redeemedTimestamp) {
    throw new Error('STORE_REWARD_VOUCHER_WINDOW_INVALID');
  }
  return new Date(end).toISOString();
};
