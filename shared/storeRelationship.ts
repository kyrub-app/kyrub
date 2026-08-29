export const STORE_RELATIONSHIP_SCHEMA_VERSION = 1 as const;

export type StoreRelationshipLevelKey =
  | 'first_contact'
  | 'customer'
  | 'recurring'
  | 'frequent'
  | 'loyal';

export interface StoreRelationshipLevel {
  key: StoreRelationshipLevelKey;
  label: string;
  confirmedPurchases: number;
  nextLabel: string;
  nextAtPurchases: number;
  progressPercent: number;
}

export interface StoreRelationshipPointsSummary {
  balance: number;
  lifetimeEarned: number;
  lifetimeRedeemed: number;
}

export interface StoreRelationshipChallengeSummary {
  id: string;
  title: string;
  description: string;
  metric: 'purchase_count' | 'spend_minor';
  target: number;
  progress: number;
  progressPercent: number;
  rewardPoints: number;
  status: 'active' | 'paused' | 'ended' | 'completed';
  endsAt: string;
  completedAt: string;
}

export interface StoreRelationshipRewardSummary {
  id: string;
  title: string;
  description: string;
  costPoints: number;
  discountType: 'percentage' | 'fixed';
  discountValue: number;
  productIds: string[];
  endsAt: string;
  redeemed: boolean;
  canRedeem: boolean;
  voucherCode: string;
  voucherEndsAt: string;
}

export interface StoreRelationshipCouponSummary {
  id: string;
  code: string;
  title: string;
  badge: string;
  discountType: 'percentage' | 'fixed';
  discountValue: number;
  productIds: string[];
  endsAt: string;
}

export interface StoreRelationshipVoucherSummary {
  redemptionId: string;
  rewardId: string;
  title: string;
  code: string;
  promotionId: string;
  endsAt: string;
  status: 'available' | 'used' | 'expired' | 'inactive';
}

export type StoreRelationshipHistoryKind =
  | 'purchase_points'
  | 'bonus_points'
  | 'points_reversal'
  | 'reward_redemption';

export interface StoreRelationshipHistoryItem {
  id: string;
  kind: StoreRelationshipHistoryKind;
  amount: number;
  label: string;
  occurredAt: string;
  orderId: string;
}

export interface StoreRelationshipSummary {
  schemaVersion: typeof STORE_RELATIONSHIP_SCHEMA_VERSION;
  storeId: string;
  customerId: string;
  generatedAt: string;
  points: StoreRelationshipPointsSummary;
  level: StoreRelationshipLevel;
  challenges: StoreRelationshipChallengeSummary[];
  rewards: StoreRelationshipRewardSummary[];
  coupons: StoreRelationshipCouponSummary[];
  vouchers: StoreRelationshipVoucherSummary[];
  history: StoreRelationshipHistoryItem[];
}

const safeNonNegativeInteger = (value: number, code: string): number => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(code);
  return value;
};

const LEVELS: ReadonlyArray<{
  key: StoreRelationshipLevelKey;
  label: string;
  minPurchases: number;
}> = [
  { key: 'first_contact', label: 'Primeiro contato', minPurchases: 0 },
  { key: 'customer', label: 'Cliente', minPurchases: 1 },
  { key: 'recurring', label: 'Cliente recorrente', minPurchases: 3 },
  { key: 'frequent', label: 'Cliente frequente', minPurchases: 10 },
  { key: 'loyal', label: 'Cliente fiel', minPurchases: 25 },
] as const;

export const deriveStoreRelationshipLevel = (
  confirmedPurchasesInput: number
): StoreRelationshipLevel => {
  const confirmedPurchases = safeNonNegativeInteger(
    confirmedPurchasesInput,
    'STORE_RELATIONSHIP_PURCHASE_COUNT_INVALID'
  );
  let current = LEVELS[0]!;
  for (const level of LEVELS) {
    if (confirmedPurchases >= level.minPurchases) current = level;
  }
  const currentIndex = LEVELS.findIndex(level => level.key === current.key);
  const next = LEVELS[currentIndex + 1];
  if (!next) {
    return {
      key: current.key,
      label: current.label,
      confirmedPurchases,
      nextLabel: '',
      nextAtPurchases: 0,
      progressPercent: 100,
    };
  }

  const span = next.minPurchases - current.minPurchases;
  const progress = confirmedPurchases - current.minPurchases;
  return {
    key: current.key,
    label: current.label,
    confirmedPurchases,
    nextLabel: next.label,
    nextAtPurchases: next.minPurchases,
    progressPercent: Math.max(0, Math.min(100, Math.floor(progress * 100 / span))),
  };
};

export const relationshipProgressPercent = (
  progressInput: number,
  targetInput: number
): number => {
  const progress = safeNonNegativeInteger(
    progressInput,
    'STORE_RELATIONSHIP_PROGRESS_INVALID'
  );
  if (!Number.isSafeInteger(targetInput) || targetInput <= 0) {
    throw new Error('STORE_RELATIONSHIP_TARGET_INVALID');
  }
  return Math.max(0, Math.min(100, Math.floor(progress * 100 / targetInput)));
};