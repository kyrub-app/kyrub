export interface CampaignBudgetPolicy {
  budgetKCoins: number;
  issuanceCap: number;
  redemptionCap: number;
  startsAt: string;
  endsAt: string;
  killSwitch: boolean;
}

export interface CampaignBudgetUsage {
  issuedKCoins: number;
  redeemedKCoins: number;
  redemptions: number;
}

export const assertCampaignBudgetPolicy = (
  policy: CampaignBudgetPolicy
): CampaignBudgetPolicy => {
  for (const [label, value] of [
    ['budgetKCoins', policy.budgetKCoins],
    ['issuanceCap', policy.issuanceCap],
    ['redemptionCap', policy.redemptionCap],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`CAMPAIGN_${label.toUpperCase()}_INVALID`);
  }
  if (Date.parse(policy.endsAt) <= Date.parse(policy.startsAt)) {
    throw new Error('CAMPAIGN_PERIOD_INVALID');
  }
  if (policy.issuanceCap > policy.budgetKCoins) {
    throw new Error('CAMPAIGN_ISSUANCE_EXCEEDS_BUDGET');
  }
  return policy;
};

export const canIssueCampaignReward = (input: {
  policy: CampaignBudgetPolicy;
  usage: CampaignBudgetUsage;
  rewardKCoins: number;
  now: string;
}): boolean => {
  const policy = assertCampaignBudgetPolicy(input.policy);
  if (policy.killSwitch) return false;
  const now = Date.parse(input.now);
  if (now < Date.parse(policy.startsAt) || now > Date.parse(policy.endsAt)) return false;
  if (!Number.isSafeInteger(input.rewardKCoins) || input.rewardKCoins <= 0) return false;
  if (input.usage.issuedKCoins + input.rewardKCoins > policy.issuanceCap) return false;
  if (input.usage.issuedKCoins + input.rewardKCoins > policy.budgetKCoins) return false;
  if (input.usage.redemptions >= policy.redemptionCap) return false;
  return true;
};
