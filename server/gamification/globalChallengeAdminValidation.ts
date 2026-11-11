import { assertKyrubChallengeDefinition, type KyrubChallengeDefinition } from '../../shared/gamification.js';

export class GlobalChallengeInputError extends Error {}
const fields = new Set(['id', 'title', 'description', 'status', 'validationMode', 'rewardKCoins', 'rewardXp',
  'startsAt', 'endsAt', 'maxCompletions', 'maxCompletionsPerUser', 'sponsorType', 'sponsorId']);

export const parseGlobalChallengeDraft = (input: unknown): KyrubChallengeDefinition => {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some(key => !fields.has(key))) throw new GlobalChallengeInputError('CHALLENGE_INPUT_INVALID');
  try {
    const challenge = assertKyrubChallengeDefinition(input as KyrubChallengeDefinition);
    if (challenge.status !== 'draft' || challenge.sponsorType !== 'kyrub' || challenge.sponsorId !== undefined) {
      throw new Error('GLOBAL_CHALLENGE_DRAFT_INVALID');
    }
    return challenge;
  } catch {
    throw new GlobalChallengeInputError('CHALLENGE_INPUT_INVALID');
  }
};
