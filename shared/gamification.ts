export type KyrubRewardLedgerEntryType =
  | 'earn'
  | 'redeem'
  | 'expire'
  | 'reversal';

export type KyrubChallengeValidationMode =
  | 'deterministic'
  | 'user_evidence'
  | 'feed_post'
  | 'external_integration'
  | 'community_review'
  | 'manual_review'
  | 'kyrubia_assisted';

export type KyrubChallengeStatus = 'draft' | 'published' | 'active' | 'ended' | 'cancelled';

export interface KyrubRewardLedgerEntry {
  id: string;
  userId: string;
  type: KyrubRewardLedgerEntryType;
  /** Signed K-Coin delta. Earn/reversal-credit are positive; redeem/expire/reversal-debit are negative. */
  deltaKCoins: number;
  sourceType: 'challenge' | 'reward_redemption' | 'campaign' | 'admin_adjustment' | 'reversal';
  sourceId: string;
  correlationId: string;
  idempotencyKey: string;
  occurredAt: string;
  reversalOfEntryId?: string;
}

export interface KyrubXpEntry {
  id: string;
  userId: string;
  deltaXp: number;
  sourceType: 'challenge' | 'achievement' | 'community' | 'admin_adjustment';
  sourceId: string;
  correlationId: string;
  idempotencyKey: string;
  occurredAt: string;
}

export interface KyrubChallengeDefinition {
  id: string;
  title: string;
  description: string;
  status: KyrubChallengeStatus;
  validationMode: KyrubChallengeValidationMode;
  rewardKCoins: number;
  rewardXp: number;
  startsAt?: string;
  endsAt?: string;
  maxCompletions?: number;
  maxCompletionsPerUser: number;
  sponsorType: 'kyrub' | 'store' | 'partner';
  sponsorId?: string;
}

export interface KyrubRewardDefinition {
  id: string;
  title: string;
  description: string;
  costKCoins: number;
  inventoryLimit?: number;
  startsAt?: string;
  endsAt?: string;
  fundingType: 'kyrub' | 'store' | 'partner' | 'mixed';
  storeId?: string;
  benefit:
    | { type: 'voucher'; voucherTemplateId: string }
    | { type: 'discount'; description: string }
    | { type: 'product'; productId: string }
    | { type: 'service'; serviceId: string }
    | { type: 'experience'; description: string }
    | { type: 'digital'; description: string };
}

export interface KyrubChallengeClaim {
  id: string;
  challengeId: string;
  userId: string;
  status: 'started' | 'submitted' | 'approved' | 'rejected' | 'rewarded';
  evidenceRefs: string[];
  idempotencyKey: string;
  startedAt: string;
  submittedAt?: string;
  decidedAt?: string;
  rewardedLedgerEntryId?: string;
}

const nonEmpty = (value: string, label: string): string => {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} é obrigatório.`);
  return normalized;
};

const integerAtLeast = (value: number, minimum: number, label: string): number => {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${label} deve ser um inteiro >= ${minimum}.`);
  }
  return value;
};

export const assertKyrubChallengeDefinition = (
  challenge: KyrubChallengeDefinition
): KyrubChallengeDefinition => {
  nonEmpty(challenge.id, 'challenge.id');
  nonEmpty(challenge.title, 'challenge.title');
  integerAtLeast(challenge.rewardKCoins, 0, 'challenge.rewardKCoins');
  integerAtLeast(challenge.rewardXp, 0, 'challenge.rewardXp');
  integerAtLeast(challenge.maxCompletionsPerUser, 1, 'challenge.maxCompletionsPerUser');
  if (challenge.maxCompletions !== undefined) {
    integerAtLeast(challenge.maxCompletions, 1, 'challenge.maxCompletions');
  }
  if (challenge.sponsorType !== 'kyrub') {
    nonEmpty(challenge.sponsorId ?? '', 'challenge.sponsorId');
  }
  return challenge;
};

export const assertKyrubRewardDefinition = (
  reward: KyrubRewardDefinition
): KyrubRewardDefinition => {
  nonEmpty(reward.id, 'reward.id');
  nonEmpty(reward.title, 'reward.title');
  integerAtLeast(reward.costKCoins, 1, 'reward.costKCoins');
  if (reward.inventoryLimit !== undefined) integerAtLeast(reward.inventoryLimit, 1, 'reward.inventoryLimit');
  if (reward.storeId !== undefined) nonEmpty(reward.storeId, 'reward.storeId');
  return reward;
};

export const assertKyrubRewardLedgerEntry = (
  entry: KyrubRewardLedgerEntry
): KyrubRewardLedgerEntry => {
  nonEmpty(entry.id, 'ledger.id');
  nonEmpty(entry.userId, 'ledger.userId');
  nonEmpty(entry.sourceId, 'ledger.sourceId');
  nonEmpty(entry.correlationId, 'ledger.correlationId');
  nonEmpty(entry.idempotencyKey, 'ledger.idempotencyKey');
  if (!Number.isSafeInteger(entry.deltaKCoins) || entry.deltaKCoins === 0) {
    throw new Error('ledger.deltaKCoins deve ser um inteiro diferente de zero.');
  }
  if ((entry.type === 'earn' && entry.deltaKCoins < 0) ||
      ((entry.type === 'redeem' || entry.type === 'expire') && entry.deltaKCoins > 0)) {
    throw new Error('O sinal de deltaKCoins é incompatível com o tipo do lançamento.');
  }
  if (entry.type === 'reversal') nonEmpty(entry.reversalOfEntryId ?? '', 'ledger.reversalOfEntryId');
  return entry;
};

export const kyrubKCoinBalance = (entries: KyrubRewardLedgerEntry[]): number => {
  const seen = new Set<string>();
  return entries.reduce((balance, candidate) => {
    const entry = assertKyrubRewardLedgerEntry(candidate);
    if (seen.has(entry.idempotencyKey)) {
      throw new Error(`Lançamento duplicado: ${entry.idempotencyKey}.`);
    }
    seen.add(entry.idempotencyKey);
    const next = balance + entry.deltaKCoins;
    if (next < 0) throw new Error('O Reward Ledger não permite saldo negativo de K-Coins.');
    return next;
  }, 0);
};

export const kyrubXpTotal = (entries: KyrubXpEntry[]): number => {
  const seen = new Set<string>();
  return entries.reduce((total, entry) => {
    nonEmpty(entry.id, 'xp.id');
    nonEmpty(entry.userId, 'xp.userId');
    nonEmpty(entry.idempotencyKey, 'xp.idempotencyKey');
    if (!Number.isSafeInteger(entry.deltaXp)) throw new Error('xp.deltaXp deve ser inteiro.');
    if (seen.has(entry.idempotencyKey)) throw new Error(`Lançamento XP duplicado: ${entry.idempotencyKey}.`);
    seen.add(entry.idempotencyKey);
    return Math.max(0, total + entry.deltaXp);
  }, 0);
};