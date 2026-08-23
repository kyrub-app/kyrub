import type { KyrubChallengeValidationMode } from './gamification';

export interface KyrubGlobalRewardCatalogItem {
  id: string;
  title: string;
  description: string;
  costKCoins: number;
  benefitType: 'voucher' | 'discount' | 'product' | 'service' | 'experience' | 'digital';
  fundingType: 'kyrub' | 'store' | 'partner' | 'mixed';
  storeId?: string;
  startsAt?: string;
  endsAt?: string;
  status: 'draft' | 'active' | 'paused' | 'ended';
}

export interface KyrubStoreClub {
  storeId: string;
  status: 'draft' | 'active' | 'paused';
  loyaltyUnitName: string;
  memberCount: number;
  activeCampaignIds: string[];
  benefitIds: string[];
  rulesVersion: string;
}

export interface KyrubStoreChallenge {
  id: string;
  storeId: string;
  title: string;
  description: string;
  validationMode: KyrubChallengeValidationMode;
  reward: { type: 'store_points'; amount: number } | { type: 'store_voucher'; benefitId: string };
  status: 'draft' | 'published' | 'active' | 'ended' | 'cancelled';
}

const required = (value: string, code: string): void => {
  if (!value.trim()) throw new Error(code);
};

export const assertGlobalRewardCatalogItem = (item: KyrubGlobalRewardCatalogItem): KyrubGlobalRewardCatalogItem => {
  required(item.id, 'REWARD_ID_REQUIRED');
  required(item.title, 'REWARD_TITLE_REQUIRED');
  if (!Number.isSafeInteger(item.costKCoins) || item.costKCoins <= 0) throw new Error('REWARD_KCOIN_COST_INVALID');
  if (item.fundingType === 'store') required(item.storeId ?? '', 'REWARD_STORE_REQUIRED');
  if (item.startsAt && item.endsAt && Date.parse(item.startsAt) >= Date.parse(item.endsAt)) {
    throw new Error('REWARD_PERIOD_INVALID');
  }
  return item;
};

export const assertStoreClub = (club: KyrubStoreClub): KyrubStoreClub => {
  required(club.storeId, 'STORE_CLUB_STORE_REQUIRED');
  required(club.loyaltyUnitName, 'STORE_CLUB_UNIT_REQUIRED');
  required(club.rulesVersion, 'STORE_CLUB_RULES_VERSION_REQUIRED');
  if (!Number.isSafeInteger(club.memberCount) || club.memberCount < 0) throw new Error('STORE_CLUB_MEMBER_COUNT_INVALID');
  return club;
};

export const assertStoreChallenge = (challenge: KyrubStoreChallenge): KyrubStoreChallenge => {
  required(challenge.id, 'STORE_CHALLENGE_ID_REQUIRED');
  required(challenge.storeId, 'STORE_CHALLENGE_STORE_REQUIRED');
  required(challenge.title, 'STORE_CHALLENGE_TITLE_REQUIRED');
  if (challenge.reward.type === 'store_points') {
    if (!Number.isSafeInteger(challenge.reward.amount) || challenge.reward.amount <= 0) {
      throw new Error('STORE_CHALLENGE_POINTS_INVALID');
    }
  } else {
    required(challenge.reward.benefitId, 'STORE_CHALLENGE_BENEFIT_REQUIRED');
  }
  return challenge;
};

export const storePointsCanConvertToKCoins = (): false => false;
