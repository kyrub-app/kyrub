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
  sourceType: 'challenge' | 'reward_redemption' | 'conversion' | 'campaign' | 'admin_adjustment' | 'reversal';
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
  sourceType: 'challenge' | 'achievement' | 'community' | 'conversion' | 'admin_adjustment';
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

const assertSingleUser = (expectedUserId: string, candidateUserId: string, ledger: string): void => {
  if (candidateUserId !== expectedUserId) {
    throw new Error(`${ledger} não pode agregar lançamentos de usuários diferentes.`);
  }
};

export const assertKyrubChallengeDefinition = (
  challenge: KyrubChallengeDefinition
): KyrubChallengeDefinition => {
  if (!challenge || typeof challenge !== 'object') throw new Error('CHALLENGE_INVALID');
  if (typeof challenge.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(challenge.id)) throw new Error('CHALLENGE_ID_INVALID');
  for (const [key, max] of [['title', 200], ['description', 5000]] as const) {
    const value = challenge[key];
    if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error('CHALLENGE_TEXT_INVALID');
  }
  if (!['draft', 'published', 'active', 'ended', 'cancelled'].includes(challenge.status)) throw new Error('CHALLENGE_STATUS_INVALID');
  if (!['deterministic', 'user_evidence', 'feed_post', 'external_integration', 'community_review', 'manual_review', 'kyrubia_assisted'].includes(challenge.validationMode)) throw new Error('CHALLENGE_VALIDATION_MODE_INVALID');
  if (!['kyrub', 'store', 'partner'].includes(challenge.sponsorType)) throw new Error('CHALLENGE_SPONSOR_INVALID');
  for (const value of [challenge.startsAt, challenge.endsAt]) {
    if (value !== undefined && (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value)))) throw new Error('CHALLENGE_DATE_INVALID');
  }
  if (challenge.startsAt && challenge.endsAt && Date.parse(challenge.endsAt) <= Date.parse(challenge.startsAt)) throw new Error('CHALLENGE_PERIOD_INVALID');
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
  nonEmpty(entry.occurredAt, 'ledger.occurredAt');
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
  let ledgerUserId = '';
  // Firestore collection reads are not guaranteed to arrive in event order.
  // Validate chronology deterministically before checking historical nonnegative balances.
  const ordered = entries.map(assertKyrubRewardLedgerEntry).sort((a, b) => {
    const aTime = Date.parse(a.occurredAt);
    const bTime = Date.parse(b.occurredAt);
    if (!Number.isFinite(aTime) || !Number.isFinite(bTime)) throw new Error('REWARD_LEDGER_DATE_INVALID');
    return aTime - bTime || a.id.localeCompare(b.id);
  });
  if (ordered.some(entry => !Number.isFinite(Date.parse(entry.occurredAt)))) {
    throw new Error('REWARD_LEDGER_DATE_INVALID');
  }
  return ordered.reduce((balance, candidate) => {
    const entry = assertKyrubRewardLedgerEntry(candidate);
    if (!ledgerUserId) ledgerUserId = entry.userId;
    else assertSingleUser(ledgerUserId, entry.userId, 'Reward Ledger');
    if (seen.has(entry.idempotencyKey)) {
      throw new Error(`Lançamento duplicado: ${entry.idempotencyKey}.`);
    }
    seen.add(entry.idempotencyKey);
    const next = balance + entry.deltaKCoins;
    if (!Number.isSafeInteger(next)) throw new Error('REWARD_LEDGER_BALANCE_OVERFLOW');
    if (next < 0) throw new Error('O Reward Ledger não permite saldo negativo de K-Coins.');
    return next;
  }, 0);
};

export const kyrubXpTotal = (entries: KyrubXpEntry[]): number => {
  const seen = new Set<string>();
  let ledgerUserId = '';
  return entries.reduce((total, entry) => {
    nonEmpty(entry.id, 'xp.id');
    nonEmpty(entry.userId, 'xp.userId');
    nonEmpty(entry.sourceId, 'xp.sourceId');
    nonEmpty(entry.correlationId, 'xp.correlationId');
    nonEmpty(entry.idempotencyKey, 'xp.idempotencyKey');
    nonEmpty(entry.occurredAt, 'xp.occurredAt');
    if (!ledgerUserId) ledgerUserId = entry.userId;
    else assertSingleUser(ledgerUserId, entry.userId, 'XP Ledger');
    if (!Number.isSafeInteger(entry.deltaXp)) throw new Error('xp.deltaXp deve ser inteiro.');
    if (seen.has(entry.idempotencyKey)) throw new Error(`Lançamento XP duplicado: ${entry.idempotencyKey}.`);
    seen.add(entry.idempotencyKey);
    return Math.max(0, total + entry.deltaXp);
  }, 0);
};

/** Canonical public/domain name. The legacy K-Coin fields remain the persisted wire format until the authoritative writer is inventoried. */
export type KyrubPitangaLedgerEntry = KyrubRewardLedgerEntry;

/** Canonical name for computing the global Pitanga balance; accepts legacy ledger entries without rewriting persisted data. */
export const kyrubPitangaBalance: typeof kyrubKCoinBalance = kyrubKCoinBalance;
