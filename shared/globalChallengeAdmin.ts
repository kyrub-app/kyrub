import type { KyrubChallengeDefinition, KyrubChallengeStatus, KyrubChallengeValidationMode } from './gamification.js';

export const GLOBAL_CHALLENGE_STATUSES: readonly KyrubChallengeStatus[] = ['draft', 'published', 'active', 'ended', 'cancelled'];
export const GLOBAL_CHALLENGE_MODES: readonly KyrubChallengeValidationMode[] = ['deterministic', 'user_evidence', 'feed_post', 'external_integration', 'community_review', 'manual_review', 'kyrubia_assisted'];
export const GLOBAL_CHALLENGE_FIELDS = ['id', 'title', 'description', 'status', 'validationMode', 'rewardKCoins', 'rewardXp', 'startsAt', 'endsAt', 'maxCompletions', 'maxCompletionsPerUser', 'sponsorType', 'sponsorId'] as const;
export interface GlobalChallengePage { items: KyrubChallengeDefinition[]; nextCursor: string | null }
export interface GlobalChallengeListOptions { status?: KyrubChallengeStatus; limit?: number; cursor?: string }
