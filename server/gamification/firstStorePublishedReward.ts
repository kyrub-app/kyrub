import type { KyrubChallengeDefinition } from '../../shared/gamification.js';

/**
 * Pure, fail-closed contract for the FIRST verified marketplace publication.
 * The trusted publication authority must persist the evidence and call the
 * award transaction. Browser events and store creation are not proof.
 */
export const FIRST_STORE_PUBLISHED_CHALLENGE_ID = 'first_store_published';

export interface VerifiedFirstStorePublication {
  userId: string;
  storeId: string;
  publishedAt: string;
  isFirstPublication: boolean;
  isOwnerVerified: boolean;
  isMarketplaceVisible: boolean;
}

const safeId = (value: string): boolean =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);

export const planFirstStorePublishedReward = (
  challenge: KyrubChallengeDefinition,
  event: VerifiedFirstStorePublication,
): { userId: string; storeId: string; challengeId: string; pitangas: 0; xp: 2; idempotencyKey: string } => {
  const published = Date.parse(event.publishedAt);
  if (!safeId(event.userId) || !safeId(event.storeId) ||
      !Number.isFinite(published) || event.isFirstPublication !== true ||
      event.isOwnerVerified !== true || event.isMarketplaceVisible !== true) {
    throw new Error('FIRST_STORE_PUBLICATION_UNVERIFIED');
  }
  if (challenge.id !== FIRST_STORE_PUBLISHED_CHALLENGE_ID ||
      !['published', 'active'].includes(challenge.status) ||
      challenge.sponsorType !== 'kyrub' ||
      challenge.validationMode !== 'deterministic' ||
      challenge.maxCompletionsPerUser !== 1 ||
      challenge.rewardKCoins !== 0 || challenge.rewardXp !== 2) {
    throw new Error('FIRST_STORE_PUBLICATION_CHALLENGE_NOT_ELIGIBLE');
  }
  const starts = challenge.startsAt ? Date.parse(challenge.startsAt) : undefined;
  const ends = challenge.endsAt ? Date.parse(challenge.endsAt) : undefined;
  if ((starts !== undefined && !Number.isFinite(starts)) ||
      (ends !== undefined && !Number.isFinite(ends)) ||
      (starts !== undefined && ends !== undefined && starts >= ends) ||
      (starts !== undefined && published < starts) ||
      (ends !== undefined && published >= ends)) {
    throw new Error('FIRST_STORE_PUBLICATION_OUTSIDE_WINDOW');
  }
  return {
    userId: event.userId,
    storeId: event.storeId,
    challengeId: challenge.id,
    pitangas: 0,
    xp: 2,
    // Shared with the legacy creation challenge to avoid a second award
    // when migrating users who already received the original 2 XP.
    idempotencyKey: `first_store_${event.userId}`,
  };
};
