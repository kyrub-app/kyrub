import type { KyrubChallengeValidationMode } from './gamification';

export type KyrubChallengeAudience =
  | 'all_users'
  | 'entrepreneurs'
  | 'students'
  | 'freelancers'
  | 'couriers'
  | 'buyers'
  | 'sellers'
  | 'community'
  | 'store_customers';

export type KyrubChallengeEvidenceKind =
  | 'none'
  | 'event'
  | 'attachment'
  | 'feed_post'
  | 'external_reference'
  | 'community_votes'
  | 'manual_review';

export interface KyrubChallengeEngineDefinition {
  id: string;
  objective: string;
  description: string;
  startsAt: string;
  endsAt: string;
  audience: KyrubChallengeAudience[];
  criteria: string[];
  validationMode: KyrubChallengeValidationMode;
  evidenceKind: KyrubChallengeEvidenceKind;
  rewardKCoins: number;
  rewardXp: number;
  budgetUnits: number;
  status: 'draft' | 'published' | 'active' | 'ended' | 'cancelled';
}

const required = (value: string, code: string): void => {
  if (!value.trim()) throw new Error(code);
};

export const assertChallengeEngineDefinition = (
  challenge: KyrubChallengeEngineDefinition
): KyrubChallengeEngineDefinition => {
  required(challenge.id, 'CHALLENGE_ID_REQUIRED');
  required(challenge.objective, 'CHALLENGE_OBJECTIVE_REQUIRED');
  required(challenge.description, 'CHALLENGE_DESCRIPTION_REQUIRED');
  if (!challenge.audience.length) throw new Error('CHALLENGE_AUDIENCE_REQUIRED');
  if (!challenge.criteria.length || challenge.criteria.some((item) => !item.trim())) {
    throw new Error('CHALLENGE_CRITERIA_REQUIRED');
  }
  if (!Number.isSafeInteger(challenge.rewardKCoins) || challenge.rewardKCoins < 0) {
    throw new Error('CHALLENGE_KCOINS_INVALID');
  }
  if (!Number.isSafeInteger(challenge.rewardXp) || challenge.rewardXp < 0) {
    throw new Error('CHALLENGE_XP_INVALID');
  }
  if (!Number.isSafeInteger(challenge.budgetUnits) || challenge.budgetUnits < 0) {
    throw new Error('CHALLENGE_BUDGET_INVALID');
  }
  if (Date.parse(challenge.startsAt) >= Date.parse(challenge.endsAt)) {
    throw new Error('CHALLENGE_PERIOD_INVALID');
  }
  if (challenge.validationMode === 'deterministic' && challenge.evidenceKind !== 'event') {
    throw new Error('CHALLENGE_AUTOMATIC_REQUIRES_EVENT_EVIDENCE');
  }
  if (challenge.validationMode === 'feed_post' && challenge.evidenceKind !== 'feed_post') {
    throw new Error('CHALLENGE_FEED_REQUIRES_FEED_EVIDENCE');
  }
  if (challenge.validationMode === 'community_review' && challenge.evidenceKind !== 'community_votes') {
    throw new Error('CHALLENGE_COMMUNITY_REQUIRES_VOTES');
  }
  return challenge;
};

export const challengeRequiresHumanDecision = (mode: KyrubChallengeValidationMode): boolean =>
  mode === 'user_evidence' || mode === 'feed_post' || mode === 'community_review' || mode === 'manual_review' || mode === 'kyrubia_assisted';

export const challengeCanAutoComplete = (mode: KyrubChallengeValidationMode): boolean =>
  mode === 'deterministic' || mode === 'external_integration';
