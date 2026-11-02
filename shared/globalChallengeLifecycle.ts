import {
  assertKyrubChallengeDefinition,
  type KyrubChallengeDefinition,
} from './gamification.js';

export interface KyrubChallengeAuditEvent {
  challengeId: string;
  actorId: string;
  action: 'created' | 'published' | 'cancelled';
  occurredAt: string;
}

const requireValue = (value: string, name: string) => {
  if (!value.trim()) throw new Error(`${name}_REQUIRED`);
  return value.trim();
};

export const planGlobalChallengeDraft = (
  challenge: KyrubChallengeDefinition,
  actorId: string,
  occurredAt: string
): { challenge: KyrubChallengeDefinition; audit: KyrubChallengeAuditEvent } => {
  requireValue(actorId, 'ADMIN_ACTOR');
  requireValue(occurredAt, 'AUDIT_TIME');
  if (challenge.sponsorType !== 'kyrub') throw new Error('GLOBAL_CHALLENGE_SPONSOR_INVALID');
  if (challenge.status !== 'draft') throw new Error('GLOBAL_CHALLENGE_MUST_START_AS_DRAFT');
  return {
    challenge: assertKyrubChallengeDefinition(challenge),
    audit: { challengeId: challenge.id, actorId, action: 'created', occurredAt },
  };
};

export const planGlobalChallengePublication = (
  current: KyrubChallengeDefinition,
  actorId: string,
  occurredAt: string
): { challenge: KyrubChallengeDefinition; audit: KyrubChallengeAuditEvent } => {
  requireValue(actorId, 'ADMIN_ACTOR');
  requireValue(occurredAt, 'AUDIT_TIME');
  if (current.sponsorType !== 'kyrub') throw new Error('GLOBAL_CHALLENGE_SPONSOR_INVALID');
  if (current.status !== 'draft') throw new Error('GLOBAL_CHALLENGE_NOT_DRAFT');
  if (current.startsAt && !Number.isFinite(Date.parse(current.startsAt))) throw new Error('CHALLENGE_START_INVALID');
  if (current.endsAt && !Number.isFinite(Date.parse(current.endsAt))) throw new Error('CHALLENGE_END_INVALID');
  if (current.startsAt && current.endsAt && Date.parse(current.endsAt) <= Date.parse(current.startsAt)) {
    throw new Error('CHALLENGE_PERIOD_INVALID');
  }
  if (current.endsAt && Date.parse(current.endsAt) <= Date.parse(occurredAt)) throw new Error('CHALLENGE_ALREADY_ENDED');
  const challenge = assertKyrubChallengeDefinition({ ...current, status: 'published' });
  return { challenge, audit: { challengeId: challenge.id, actorId, action: 'published', occurredAt } };
};
