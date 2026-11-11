import { adminDb } from '../firebaseAdmin.js';
import { planGlobalChallengeDraft, planGlobalChallengePublication } from '../../shared/globalChallengeLifecycle.js';
import type { KyrubChallengeDefinition } from '../../shared/gamification.js';

/**
 * Trusted server-side persistence only. The calling HTTP route MUST verify
 * the Firebase ID token and active Super Admin role before invoking this service.
 * Never expose this module as a client-writable endpoint.
 */
const root = adminDb.collection('global_challenges');
const safeId = (value: string, label: string): string => {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new Error(label + '_INVALID');
  return value;
};

export const createGlobalChallengeDraft = async (
  challenge: KyrubChallengeDefinition,
  actorId: string,
  occurredAt: string,
): Promise<KyrubChallengeDefinition> => {
  safeId(actorId, 'ADMIN_ACTOR');
  safeId(challenge.id, 'CHALLENGE_ID');
  const planned = planGlobalChallengeDraft(challenge, actorId, occurredAt);
  const ref = root.doc(challenge.id);
  await adminDb.runTransaction(async tx => {
    const existing = await tx.get(ref);
    if (existing.exists) throw new Error('GLOBAL_CHALLENGE_ALREADY_EXISTS');
    tx.create(ref, { ...planned.challenge, createdAt: occurredAt, createdBy: actorId });
    tx.create(ref.collection('audit').doc('created'), planned.audit);
  });
  return planned.challenge;
};

export const publishGlobalChallenge = async (
  challengeId: string,
  actorId: string,
  occurredAt: string,
): Promise<KyrubChallengeDefinition> => {
  safeId(challengeId, 'CHALLENGE_ID');
  safeId(actorId, 'ADMIN_ACTOR');
  const ref = root.doc(challengeId);
  return adminDb.runTransaction(async tx => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) throw new Error('GLOBAL_CHALLENGE_NOT_FOUND');
    const current = snapshot.data() as KyrubChallengeDefinition;
    if (current.id !== challengeId) throw new Error('GLOBAL_CHALLENGE_ID_MISMATCH');
    const planned = planGlobalChallengePublication(current, actorId, occurredAt);
    tx.update(ref, { status: planned.challenge.status, publishedAt: occurredAt, publishedBy: actorId });
    tx.create(ref.collection('audit').doc('published'), planned.audit);
    return planned.challenge;
  });
};
