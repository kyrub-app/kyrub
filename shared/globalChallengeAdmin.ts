import type { KyrubChallengeDefinition, KyrubChallengeStatus, KyrubChallengeValidationMode } from './gamification.js';

export const GLOBAL_CHALLENGE_STATUSES: readonly KyrubChallengeStatus[] = ['draft', 'published', 'active', 'ended', 'cancelled'];
export const GLOBAL_CHALLENGE_MODES: readonly KyrubChallengeValidationMode[] = ['deterministic', 'user_evidence', 'feed_post', 'external_integration', 'community_review', 'manual_review', 'kyrubia_assisted'];
export const GLOBAL_CHALLENGE_FIELDS = ['id', 'title', 'description', 'status', 'validationMode', 'rewardKCoins', 'rewardXp', 'startsAt', 'endsAt', 'maxCompletions', 'maxCompletionsPerUser', 'sponsorType', 'sponsorId'] as const;
export interface GlobalChallengePage { items: KyrubChallengeDefinition[]; nextCursor: string | null }
export interface GlobalChallengeListOptions { status?: KyrubChallengeStatus; limit?: number; cursor?: string }

/** The institutional destination is server-owned, not a community name or client flag. */
export type OfficialCommunityCandidate = { communityId: string; name: string };
export type OfficialCommunityBinding =
  | { state: 'unlinked'; candidates: OfficialCommunityCandidate[]; truncated: boolean }
  | { state: 'linked'; community: OfficialCommunityCandidate }
  | { state: 'unavailable' };

// The synthetic author is not a personal UID or a rewards account.
export const OFFICIAL_CHALLENGE_AUTHOR_ID='kyrub:institutional' as const;
export interface OfficialChallengeDisclosure {challengeId:string;communityId:string;postId:string;sharedToSquare:boolean;replay:boolean}
export function institutionalChallengeId(data:Record<string,unknown>):string|undefined {
 return data.authorId===OFFICIAL_CHALLENGE_AUTHOR_ID&&typeof data.institutionalChallengeId==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(data.institutionalChallengeId)?data.institutionalChallengeId:undefined;
}
