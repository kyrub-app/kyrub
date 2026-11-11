import { adminAuth } from '../firebaseAdmin.js';
import { consumeGlobalChallengeActorLimit } from './globalChallengeAdminRateLimit.js';
import { authorizeIntegrationReadiness } from '../admin/integrationReadinessService.js';
import { createGlobalChallengeDraft, publishGlobalChallenge, getGlobalChallenge, listGlobalChallenges } from './globalChallengeAdminRepository.js';
import { GlobalChallengeInputError, parseGlobalChallengeDraft, parseGlobalChallengeRead, projectGlobalChallenge } from './globalChallengeAdminValidation.js';

const authorizeGlobalChallengeAdmin = async (authorization: string) => {
  const token = /^Bearer\s+(\S+)$/i.exec(authorization)?.[1];
  if (!token) throw new Error('AUTH_REQUIRED');
  // Reject malformed JWT objects before the shared verifier; its clock-skew
  // tolerance must not permit expired tokens on administrative writes.
  let authenticatedAt = 0;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error();
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (!header || typeof header !== 'object' || Array.isArray(header) ||
        !claims || typeof claims !== 'object' || Array.isArray(claims) ||
        typeof claims.exp !== 'number' || claims.exp <= Date.now() / 1000) throw new Error();
    authenticatedAt = claims.auth_time;
  } catch {
    throw new Error('AUTH_REQUIRED');
  }
  const actor = await authorizeIntegrationReadiness(authorization);
  // Keep the canonical signature/project/email/profile verifier. Consult the
  // existing Admin Auth SDK for identity state without verifying the JWT twice.
  // Compare auth_time (not iat), matching the SDK's revocation semantics.
  try {
    const identity = await adminAuth.getUser(actor.uid);
    if (identity.disabled || (identity.tokensValidAfterTime &&
        authenticatedAt * 1000 < Date.parse(identity.tokensValidAfterTime))) throw new Error('AUTH_REQUIRED');
  } catch (error) {
    if ((error as { code?: string }).code === 'auth/user-not-found') throw new Error('AUTH_REQUIRED');
    throw error; // Auth backend failures fail closed and map to sanitized 503.
  }
  return actor;
};

export const queryGlobalChallengeAdmin = async (authorization: string, query: Record<string, unknown>) => {
  const actor = await authorizeGlobalChallengeAdmin(authorization);
  const options = parseGlobalChallengeRead(query);
  await consumeGlobalChallengeActorLimit(actor.uid, 'read');
  if (options.operation === 'get') return { challenge: await getGlobalChallenge(options.challengeId, actor.uid) };
  return listGlobalChallenges(options, actor.uid);
};

export const executeGlobalChallengeAdmin = async (authorization: string, operation: string, input: unknown) => {
  const actor = await authorizeGlobalChallengeAdmin(authorization);
  const occurredAt = new Date().toISOString();
  if (operation === 'create') {
    const challenge = parseGlobalChallengeDraft(input);
    await consumeGlobalChallengeActorLimit(actor.uid);
    return projectGlobalChallenge(await createGlobalChallengeDraft(challenge, actor.uid, occurredAt));
  }
  if (operation === 'publish') {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 1 ||
        !('challengeId' in input) || typeof input.challengeId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(input.challengeId)) {
      throw new GlobalChallengeInputError('CHALLENGE_INPUT_INVALID');
    }
    await consumeGlobalChallengeActorLimit(actor.uid);
    return projectGlobalChallenge(await publishGlobalChallenge(input.challengeId, actor.uid, occurredAt));
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
