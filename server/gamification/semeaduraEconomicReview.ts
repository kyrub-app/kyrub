import type { Firestore } from 'firebase-admin/firestore';
import { semeaduraEconomicPilotEnabled } from './semeaduraEconomicPilot.js';

type Scope = 'author' | 'actor' | 'post';
type Status = 'held' | 'cleared';
type ReviewCommand = {
  scope: Scope; target: string; caseId: string; eventId: string;
  status: Status; expectedRevision: number;
};
const uid = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v);
const root = 'systemControl/semeaduraEconomicReview';

/**
 * Isolated server-only review workflow. No HTTP route, no production
 * moderator authority. The reviewer ID must originate from a trusted
 * caller; the explicit fixture allowlist is NOT an authentication layer.
 * No mutation of receipts, balances, XP or daily allowance.
 */
export async function recordIsolatedSemeaduraReview(
  db: Firestore, reviewerId: string, command: ReviewCommand,
): Promise<{ revision: number; replayed: boolean }> {
  if (!semeaduraEconomicPilotEnabled(db)) throw Error('SEMEADURA_REVIEW_PILOT_DISABLED');
  if (!uid(reviewerId) || !command ||
      !['author', 'actor', 'post'].includes(command.scope) ||
      !(command.scope === 'post' ? /^[a-f0-9]{64}$/.test(command.target) : uid(command.target)) ||
      typeof command.target !== 'string' || !uid(command.caseId) || !uid(command.eventId) ||
      !['held', 'cleared'].includes(command.status) ||
      !Number.isSafeInteger(command.expectedRevision) || command.expectedRevision < 0 ||
      !Number.isSafeInteger(command.expectedRevision + 1)) throw Error('SEMEADURA_REVIEW_INPUT_INVALID');

  const {scope, target, caseId, eventId, status, expectedRevision} = command;
  const reviewerRef = db.doc(root + '/reviewers/' + reviewerId);
  const holdRef = db.doc(root + '/holds/' + scope + '_' + target);
  const eventRef = db.doc(root + '/events/' + eventId);
  const identity = {scope, target, caseId, eventId, status, expectedRevision, reviewedBy: reviewerId};
  return db.runTransaction(async tx => {
    const [reviewer, hold, event] = await Promise.all([
      tx.get(reviewerRef), tx.get(holdRef), tx.get(eventRef),
    ]);
    if (reviewer.get('schemaVersion') !== 1 || reviewer.get('reviewerId') !== reviewerId ||
        reviewer.get('active') !== true || reviewer.get('fixtureOnly') !== true)
      throw Error('SEMEADURA_REVIEW_NOT_AUTHORIZED');
    if (event.exists) {
      const prior = event.data();
      if (prior?.schemaVersion !== 1 || prior.revision !== expectedRevision + 1 ||
          Object.entries(identity).some(([k,v]) => prior[k] !== v))
        throw Error('SEMEADURA_REVIEW_EVENT_CONFLICT');
      return {revision: expectedRevision + 1, replayed: true};
    }
    const current = hold.data();
    if (hold.exists) {
      if (!current || current.schemaVersion !== 1 || current.scope !== scope || current.target !== target ||
          !uid(current.caseId) || !uid(current.eventId) || !uid(current.reviewedBy) ||
          !['held', 'cleared'].includes(current.status) ||
          !Number.isSafeInteger(current.revision) || current.revision < 1)
        throw Error('SEMEADURA_REVIEW_STATE_INVALID');
      // The projection must have an immutable matching previous event.
      const previous = await tx.get(db.doc(root + '/events/' + current.eventId));
      const evidence = previous.data();
      if (!evidence || evidence.schemaVersion !== 1 ||
          ['scope','target','caseId','eventId','status','reviewedBy','revision','updatedAt']
            .some(k => evidence[k] !== current[k]))
        throw Error('SEMEADURA_REVIEW_STATE_INVALID');
    }
    const revision = (current?.revision ?? 0) as number;
    if (revision !== expectedRevision) throw Error('SEMEADURA_REVIEW_REVISION_CONFLICT');
    if ((!current && status !== 'held') || (current && current.status === status) ||
        (status === 'cleared' && current?.caseId !== caseId))
      throw Error('SEMEADURA_REVIEW_TRANSITION_INVALID');
    const next = {schemaVersion: 1, ...identity, revision: revision + 1, updatedAt: new Date().toISOString()};
    tx.create(eventRef, next);
    tx.set(holdRef, next);
    return {revision: next.revision, replayed: false};
  });
}
