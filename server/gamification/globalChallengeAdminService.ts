import { consumeGlobalChallengeActorLimit } from './globalChallengeAdminRateLimit.js';
import { authorizeIntegrationReadiness } from '../admin/integrationReadinessService.js';
import { createGlobalChallengeDraft, publishGlobalChallenge } from './globalChallengeAdminRepository.js';
import { GlobalChallengeInputError, parseGlobalChallengeDraft } from './globalChallengeAdminValidation.js';

export const executeGlobalChallengeAdmin = async (authorization: string, operation: string, input: unknown) => {
  const token = /^Bearer\s+(\S+)$/i.exec(authorization)?.[1];
  if (!token) throw new Error('AUTH_REQUIRED');
  // Reject malformed JWT objects before the shared verifier; its clock-skew
  // tolerance must not permit expired tokens on administrative writes.
  try {
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error();
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (!header || typeof header !== 'object' || Array.isArray(header) ||
        !claims || typeof claims !== 'object' || Array.isArray(claims) ||
        typeof claims.exp !== 'number' || claims.exp <= Date.now() / 1000) throw new Error();
  } catch {
    throw new Error('AUTH_REQUIRED');
  }
  const actor = await authorizeIntegrationReadiness(authorization);
  const occurredAt = new Date().toISOString();
  if (operation === 'create') {
    const challenge = parseGlobalChallengeDraft(input);
    await consumeGlobalChallengeActorLimit(actor.uid);
    return createGlobalChallengeDraft(challenge, actor.uid, occurredAt);
  }
  if (operation === 'publish') {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 1 ||
        !('challengeId' in input) || typeof input.challengeId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(input.challengeId)) {
      throw new GlobalChallengeInputError('CHALLENGE_INPUT_INVALID');
    }
    await consumeGlobalChallengeActorLimit(actor.uid);
    return publishGlobalChallenge(input.challengeId, actor.uid, occurredAt);
  }
  throw new GlobalChallengeInputError('CHALLENGE_OPERATION_INVALID');
};

export const mapGlobalChallengeAdminError = (error: unknown) => {
  const message = error instanceof Error ? error.message : '';
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  if (message === 'AUTH_REQUIRED' || code === 'AUTH_REQUIRED') return { status: 401, body: { code: 'AUTH_REQUIRED' } };
  if (message === 'FORBIDDEN' || message === 'EMAIL_NOT_VERIFIED') return { status: 403, body: { code: 'FORBIDDEN' } };
  if (message === 'GLOBAL_CHALLENGE_NOT_FOUND') return { status: 404, body: { code: message } };
  if (['GLOBAL_CHALLENGE_ALREADY_EXISTS', 'GLOBAL_CHALLENGE_NOT_DRAFT', 'GLOBAL_CHALLENGE_ID_MISMATCH'].includes(message)) return { status: 409, body: { code: message } };
  if (error instanceof GlobalChallengeInputError || /^CHALLENGE_|^GLOBAL_CHALLENGE_SPONSOR_INVALID/.test(message)) return { status: 400, body: { code: 'CHALLENGE_INPUT_INVALID' } };
  return { status: 503, body: { code: 'GLOBAL_CHALLENGE_UNAVAILABLE' } };
};
