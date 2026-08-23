export type StoreClubCampaignStatus = 'draft' | 'active' | 'paused' | 'ended' | 'cancelled';

export interface StoreClubFundingPolicy {
  storeId: string;
  fundingSource: 'store';
  budgetUnits: number;
  issuanceCap: number;
  redemptionCap: number;
  killSwitch: boolean;
}

export interface KyrubClubStoreBenefitOffer {
  id: string;
  storeId: string;
  title: string;
  kCoinCost: number;
  benefitId: string;
  startsAt?: string;
  endsAt?: string;
  status: 'draft' | 'active' | 'paused' | 'ended';
  fundedBy: 'store';
}

export interface StoreClubCampaignMetrics {
  campaignId: string;
  storeId: string;
  budgetUnits: number;
  participants: number;
  redemptions: number;
  conversions: number;
  attributedRevenueMinor: number;
}

const nonNegativeInteger = (value: number, code: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(code);
};

export const assertStoreClubFundingPolicy = (policy: StoreClubFundingPolicy): StoreClubFundingPolicy => {
  if (!policy.storeId.trim()) throw new Error('STORE_FUNDING_STORE_REQUIRED');
  nonNegativeInteger(policy.budgetUnits, 'STORE_FUNDING_BUDGET_INVALID');
  nonNegativeInteger(policy.issuanceCap, 'STORE_FUNDING_ISSUANCE_CAP_INVALID');
  nonNegativeInteger(policy.redemptionCap, 'STORE_FUNDING_REDEMPTION_CAP_INVALID');
  if (policy.issuanceCap > policy.budgetUnits) throw new Error('STORE_FUNDING_ISSUANCE_EXCEEDS_BUDGET');
  if (policy.redemptionCap > policy.issuanceCap) throw new Error('STORE_FUNDING_REDEMPTION_EXCEEDS_ISSUANCE');
  return policy;
};

export const assertKyrubClubStoreBenefitOffer = (offer: KyrubClubStoreBenefitOffer): KyrubClubStoreBenefitOffer => {
  if (!offer.id.trim()) throw new Error('STORE_BENEFIT_ID_REQUIRED');
  if (!offer.storeId.trim()) throw new Error('STORE_BENEFIT_STORE_REQUIRED');
  if (!offer.title.trim()) throw new Error('STORE_BENEFIT_TITLE_REQUIRED');
  if (!offer.benefitId.trim()) throw new Error('STORE_BENEFIT_REFERENCE_REQUIRED');
  if (!Number.isSafeInteger(offer.kCoinCost) || offer.kCoinCost <= 0) throw new Error('STORE_BENEFIT_KCOIN_COST_INVALID');
  if (offer.startsAt && offer.endsAt && Date.parse(offer.startsAt) >= Date.parse(offer.endsAt)) {
    throw new Error('STORE_BENEFIT_PERIOD_INVALID');
  }
  return offer;
};

export const assertStoreClubCampaignMetrics = (metrics: StoreClubCampaignMetrics): StoreClubCampaignMetrics => {
  if (!metrics.campaignId.trim() || !metrics.storeId.trim()) throw new Error('STORE_CAMPAIGN_SCOPE_REQUIRED');
  nonNegativeInteger(metrics.budgetUnits, 'STORE_CAMPAIGN_BUDGET_INVALID');
  nonNegativeInteger(metrics.participants, 'STORE_CAMPAIGN_PARTICIPANTS_INVALID');
  nonNegativeInteger(metrics.redemptions, 'STORE_CAMPAIGN_REDEMPTIONS_INVALID');
  nonNegativeInteger(metrics.conversions, 'STORE_CAMPAIGN_CONVERSIONS_INVALID');
  nonNegativeInteger(metrics.attributedRevenueMinor, 'STORE_CAMPAIGN_REVENUE_INVALID');
  if (metrics.redemptions > metrics.participants) throw new Error('STORE_CAMPAIGN_REDEMPTIONS_EXCEED_PARTICIPANTS');
  if (metrics.conversions > metrics.participants) throw new Error('STORE_CAMPAIGN_CONVERSIONS_EXCEED_PARTICIPANTS');
  return metrics;
};
