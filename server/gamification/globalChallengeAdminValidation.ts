import { GLOBAL_CHALLENGE_FIELDS, GLOBAL_CHALLENGE_STATUSES } from '../../shared/globalChallengeAdmin.js';
import { assertKyrubChallengeDefinition, type KyrubChallengeDefinition, type KyrubChallengeStatus } from '../../shared/gamification.js';

export class GlobalChallengeInputError extends Error {}
const fields = new Set<string>(GLOBAL_CHALLENGE_FIELDS);

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


export const parseGlobalChallengeRead = (query: Record<string, unknown>) => {
  const operation = query.operation ?? 'list';
  const allowed = new Set(['operation', 'transport', ...(operation === 'list' ? ['status', 'limit', 'cursor'] : ['challengeId'])]);
  const invalid = () => { throw new GlobalChallengeInputError('CHALLENGE_QUERY_INVALID'); };
  if (Object.keys(query).some(key => !allowed.has(key))) invalid();
  if (operation === 'get') {
    if (typeof query.challengeId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(query.challengeId)) invalid();
    return { operation, challengeId: query.challengeId as string } as const;
  }
  if (operation !== 'list') invalid();
  const status = query.status;
  if (status !== undefined && (typeof status !== 'string' || !GLOBAL_CHALLENGE_STATUSES.includes(status as KyrubChallengeStatus))) invalid();
  const limit = query.limit === undefined ? 20 : typeof query.limit === 'string' && /^[1-9]\d?$/.test(query.limit) ? Number(query.limit) : 0;
  if (limit < 1 || limit > 50) invalid();
  let after: string | undefined;
  if (query.cursor !== undefined) {
    if (typeof query.cursor !== 'string' || query.cursor.length > 512 || !/^[A-Za-z0-9_-]+$/.test(query.cursor)) invalid();
    try {
      const cursor = JSON.parse(Buffer.from(query.cursor as string, 'base64url').toString('utf8'));
      if (cursor.v !== 1 || cursor.status !== (status ?? '') || typeof cursor.after !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(cursor.after)) invalid();
      after = cursor.after;
    } catch { invalid(); }
  }
  return { operation: 'list', status: status as KyrubChallengeStatus | undefined, limit, after } as const;
};

// One explicit DTO for every administrative response. Never return arbitrary
// Firestore metadata or subcollections (audit/author IDs, secrets, future fields).
export const projectGlobalChallenge = (input: unknown): KyrubChallengeDefinition => {
  const challenge = assertKyrubChallengeDefinition(input as KyrubChallengeDefinition);
  if (challenge.sponsorType !== 'kyrub') throw new Error('GLOBAL_CHALLENGE_DATA_INVALID');
  return Object.fromEntries(GLOBAL_CHALLENGE_FIELDS.filter(key => challenge[key] !== undefined).map(key => [key, challenge[key]])) as unknown as KyrubChallengeDefinition;
};
