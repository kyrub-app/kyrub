import { assertKyrubChallengeDefinition, type KyrubChallengeDefinition } from './gamification.js';

/** Public projection only: never exposes draft challenges or administrative metadata. */
export const listVisibleGlobalChallenges = (
  challenges: readonly KyrubChallengeDefinition[],
  now: string
): KyrubChallengeDefinition[] => {
  const timestamp = Date.parse(now);
  if (!Number.isFinite(timestamp)) throw new Error('CHALLENGE_CLOCK_INVALID');
  return challenges.filter((challenge) => {
    if (challenge.sponsorType !== 'kyrub') return false;
    if (challenge.status !== 'published' && challenge.status !== 'active') return false;
    if (challenge.startsAt && (!Number.isFinite(Date.parse(challenge.startsAt)) || Date.parse(challenge.startsAt) > timestamp)) return false;
    if (challenge.endsAt && (!Number.isFinite(Date.parse(challenge.endsAt)) || Date.parse(challenge.endsAt) <= timestamp)) return false;
    assertKyrubChallengeDefinition(challenge);
    return true;
  });
};
