import { parseGlobalChallengeDraft } from './globalChallengeAdminValidation.js';
import { FieldPath } from 'firebase-admin/firestore';
import { GLOBAL_CHALLENGE_FIELDS } from '../../shared/globalChallengeAdmin.js';
import type { GlobalChallengePage } from '../../shared/globalChallengeAdmin.js';
import { projectGlobalChallenge } from './globalChallengeAdminValidation.js';
import type { Transaction } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import { planGlobalChallengeDraft, planGlobalChallengePublication } from '../../shared/globalChallengeLifecycle.js';
import type { KyrubChallengeDefinition, KyrubChallengeStatus } from '../../shared/gamification.js';

/**
 * Trusted server-side persistence only. The calling HTTP route MUST verify
 * the Firebase ID token and active Super Admin role before invoking this service.
 * Never expose this module as a client-writable endpoint.
 */
const root = () => adminDb.collection('global_challenges');

// Re-read authority in the write transaction, including on transaction retries.
const requireActiveSuperAdmin = async (tx: Transaction, actorId: string) => {
  const snapshot = await tx.get(adminDb.doc(`kyrub_admin/control_plane/admins/${actorId}`));
  const profile = snapshot.data();
  if (!snapshot.exists || profile?.uid !== actorId || profile.status !== 'active' || profile.role !== 'super_admin') throw new Error('FORBIDDEN');
};
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
  const planned = planGlobalChallengeDraft(parseGlobalChallengeDraft(challenge), actorId, occurredAt);
  const ref = root().doc(challenge.id);
  await adminDb.runTransaction(async tx => {
    await requireActiveSuperAdmin(tx, actorId);
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
  const ref = root().doc(challengeId);
  return adminDb.runTransaction(async tx => {
    await requireActiveSuperAdmin(tx, actorId);
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


export const getGlobalChallenge = async (challengeId: string, actorId: string) => {
  safeId(challengeId, 'CHALLENGE_ID'); safeId(actorId, 'ADMIN_ACTOR');
  return adminDb.runTransaction(async tx => {
    await requireActiveSuperAdmin(tx, actorId);
    const snapshot = await tx.get(root().doc(challengeId));
    if (!snapshot.exists) throw new Error('GLOBAL_CHALLENGE_NOT_FOUND');
    const result = projectGlobalChallenge(snapshot.data());
    if (result.id !== snapshot.id) throw new Error('GLOBAL_CHALLENGE_ID_MISMATCH');
    return result;
  });
};

export const listGlobalChallenges = async (
  options: { status?: KyrubChallengeStatus; limit: number; after?: string }, actorId: string,
): Promise<GlobalChallengePage> => {
  safeId(actorId, 'ADMIN_ACTOR');
  let query = root().orderBy(FieldPath.documentId()).limit(options.limit + 1).select(...GLOBAL_CHALLENGE_FIELDS);
  if (options.status) query = query.where('status', '==', options.status);
  if (options.after) query = query.startAfter(options.after);
  return adminDb.runTransaction(async tx => {
    await requireActiveSuperAdmin(tx, actorId);
    const snapshot = await tx.get(query);
    const page = snapshot.docs.slice(0, options.limit);
    const items = page.map(doc => {
      const item = projectGlobalChallenge(doc.data());
      if (item.id !== doc.id) throw new Error('GLOBAL_CHALLENGE_ID_MISMATCH');
      return item;
    });
    const nextCursor = snapshot.size > options.limit ? Buffer.from(JSON.stringify({ v: 1, status: options.status ?? '', after: page.at(-1)!.id })).toString('base64url') : null;
    return { items, nextCursor };
  });
};
