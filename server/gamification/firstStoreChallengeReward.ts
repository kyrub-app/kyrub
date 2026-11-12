import type { KyrubChallengeDefinition } from '../../shared/gamification.js';

/**
 * Server-side eligibility gate for the first-store onboarding challenge.
 * This is a pure contract: it never credits rewards, trusts client evidence,
 * or changes the store lifecycle. A trusted store-creation transaction must
 * establish first-store ownership before invoking a reward writer.
 */
export const FIRST_STORE_CHALLENGE_ID = 'first_store_created';

export interface VerifiedFirstStoreEvent {
  userId: string;
  storeId: string;
  /** Persisted server timestamp, never supplied by the browser. */
  createdAt: string;
  /** Verified by the store authority, not a client-side claim. */
  isFirstStore: boolean;
}

const safeId = (value: string): boolean =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);

export const planFirstStoreChallengeReward = (
  challenge: KyrubChallengeDefinition,
  event: VerifiedFirstStoreEvent,
): { userId: string; storeId: string; challengeId: string; pitangas: number; xp: number; idempotencyKey: string } => {
  if (!safeId(event.userId) || !safeId(event.storeId) ||
      !Number.isFinite(Date.parse(event.createdAt)) || event.isFirstStore !== true) {
    throw new Error('FIRST_STORE_EVENT_UNVERIFIED');
  }
  if (challenge.id !== FIRST_STORE_CHALLENGE_ID ||
      !['published', 'active'].includes(challenge.status) ||
      challenge.sponsorType !== 'kyrub' ||
      challenge.validationMode !== 'deterministic' ||
      challenge.maxCompletionsPerUser !== 1 ||
      !Number.isSafeInteger(challenge.rewardKCoins) || challenge.rewardKCoins !== 0 ||
      !Number.isSafeInteger(challenge.rewardXp) || challenge.rewardXp < 0 ||
      challenge.rewardXp !== 2) {
    throw new Error('FIRST_STORE_CHALLENGE_NOT_ELIGIBLE');
  }
  const created = Date.parse(event.createdAt);
  if ((challenge.startsAt && created < Date.parse(challenge.startsAt)) ||
      (challenge.endsAt && created >= Date.parse(challenge.endsAt))) {
    throw new Error('FIRST_STORE_CHALLENGE_OUTSIDE_WINDOW');
  }
  return {
    userId: event.userId,
    storeId: event.storeId,
    challengeId: challenge.id,
    pitangas: challenge.rewardKCoins,
    xp: challenge.rewardXp,
    // Stable across retries and store re-publication.
    idempotencyKey: `first_store_${event.userId}`,
  };
};
