export type KyrubProgressionAsset = 'xp' | 'level' | 'achievement' | 'badge' | 'k_coin';

export interface KyrubLevelDefinition {
  level: number;
  minimumXp: number;
  title: string;
}

export interface KyrubAchievementDefinition {
  id: string;
  title: string;
  description: string;
  badgeId?: string;
  rewardXp?: number;
  rewardKCoins?: number;
}

export type RewardFundingSource = 'kyrub' | 'store' | 'sponsor' | 'partner' | 'mixed';

export interface RewardFundingAuthority {
  source: RewardFundingSource;
  payerIds: string[];
  correlationId: string;
}

const nonEmpty = (value: string, label: string): string => {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label}_REQUIRED`);
  return normalized;
};

export const levelForXp = (
  xp: number,
  levels: readonly KyrubLevelDefinition[]
): KyrubLevelDefinition | null => {
  if (!Number.isSafeInteger(xp) || xp < 0) throw new Error('XP_INVALID');
  const ordered = [...levels].sort((a, b) => a.minimumXp - b.minimumXp);
  let current: KyrubLevelDefinition | null = null;
  for (const level of ordered) {
    if (!Number.isSafeInteger(level.level) || level.level < 1) throw new Error('LEVEL_INVALID');
    if (!Number.isSafeInteger(level.minimumXp) || level.minimumXp < 0) throw new Error('LEVEL_XP_INVALID');
    nonEmpty(level.title, 'LEVEL_TITLE');
    if (xp >= level.minimumXp) current = level;
  }
  return current;
};

export const assertRewardFundingAuthority = (
  authority: RewardFundingAuthority
): RewardFundingAuthority => {
  nonEmpty(authority.correlationId, 'FUNDING_CORRELATION');
  if (authority.payerIds.length === 0) throw new Error('FUNDING_PAYER_REQUIRED');
  for (const payerId of authority.payerIds) nonEmpty(payerId, 'FUNDING_PAYER');
  if (authority.source !== 'mixed' && authority.payerIds.length !== 1) {
    throw new Error('FUNDING_SINGLE_PAYER_REQUIRED');
  }
  if (authority.source === 'mixed' && authority.payerIds.length < 2) {
    throw new Error('FUNDING_MIXED_REQUIRES_MULTIPLE_PAYERS');
  }
  return authority;
};

export const PROGRESSION_ASSETS: readonly KyrubProgressionAsset[] = [
  'xp',
  'level',
  'achievement',
  'badge',
  'k_coin',
];
