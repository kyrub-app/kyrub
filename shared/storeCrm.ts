import type { StoreRelationshipLevel } from './storeRelationship.js';

export const STORE_CRM_SCHEMA_VERSION = 1 as const;

export type StoreCrmSegment =
  | 'first_purchase'
  | 'recurring'
  | 'frequent'
  | 'loyal'
  | 'points_available'
  | 'challenge_engaged'
  | 'reward_redeemer';

export interface StoreCrmCustomer {
  customerId: string;
  name: string;
  email: string;
  avatarUrl: string;
  confirmedPurchases: number;
  totalPaid: number;
  averageTicket: number;
  lastPurchaseAt: string;
  lastActivityAt: string;
  lastOrderId: string;
  pointsBalance: number;
  relationshipLevel: StoreRelationshipLevel;
  challengeProgressCount: number;
  completedChallengeCount: number;
  availableRewardCount: number;
  rewardRedemptionCount: number;
  availableVoucherCount: number;
  segments: StoreCrmSegment[];
}

export interface StoreCrmSummary {
  schemaVersion: typeof STORE_CRM_SCHEMA_VERSION;
  storeId: string;
  generatedAt: string;
  totals: {
    customers: number;
    recurringCustomers: number;
    loyalCustomers: number;
    outstandingStorePoints: number;
    confirmedRevenue: number;
  };
  customers: StoreCrmCustomer[];
}

export const deriveStoreCrmSegments = (input: {
  confirmedPurchases: number;
  pointsBalance: number;
  challengeProgressCount: number;
  rewardRedemptionCount: number;
}): StoreCrmSegment[] => {
  if (
    !Number.isSafeInteger(input.confirmedPurchases) ||
    input.confirmedPurchases < 0 ||
    !Number.isSafeInteger(input.pointsBalance) ||
    !Number.isSafeInteger(input.challengeProgressCount) ||
    input.challengeProgressCount < 0 ||
    !Number.isSafeInteger(input.rewardRedemptionCount) ||
    input.rewardRedemptionCount < 0
  ) {
    throw new Error('STORE_CRM_SEGMENT_INPUT_INVALID');
  }

  const segments: StoreCrmSegment[] = [];
  if (input.confirmedPurchases === 1) segments.push('first_purchase');
  if (input.confirmedPurchases >= 3) segments.push('recurring');
  if (input.confirmedPurchases >= 10) segments.push('frequent');
  if (input.confirmedPurchases >= 25) segments.push('loyal');
  if (input.pointsBalance > 0) segments.push('points_available');
  if (input.challengeProgressCount > 0) segments.push('challenge_engaged');
  if (input.rewardRedemptionCount > 0) segments.push('reward_redeemer');
  return segments;
};
