import type { User } from 'firebase/auth';
import type { KyrubActivityEvent } from '../../shared/kyrubActivityEvents';
import { verifyKyrubActionReceipt } from '../actions/kyrubActionReceiptService';
import {
  readRecentKyrubActivityEvents,
  type KyrubActivityStorage,
} from './kyrubActivityLog';
import {
  readAuthoritativeActivityRuntimeEvents,
  rememberAuthoritativeActivityRuntimeEvent,
} from './kyrubAuthoritativeActivityRuntime';

const EXECUTION_ID_PATTERN = /^exec_[a-f0-9]{40}$/;

export type KyrubReceiptVerificationCandidate = {
  attempt: KyrubActivityEvent;
  storedResult: KyrubActivityEvent;
  executionId: string;
  proposalId: string;
};

const eventTime = (event: KyrubActivityEvent): number => {
  const parsed = Date.parse(event.occurredAt);
  return Number.isFinite(parsed) ? parsed : 0;
};

const latestAttempt = (
  events: KyrubActivityEvent[]
): KyrubActivityEvent | null => {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.type === 'interaction.action_attempted' && event.actionId) {
      return event;
    }
  }
  return null;
};

export const findKyrubReceiptVerificationCandidate = (
  events: KyrubActivityEvent[]
): KyrubReceiptVerificationCandidate | null => {
  const attempt = latestAttempt(events);
  if (!attempt?.actionId) return null;
  const attemptTime = eventTime(attempt);

  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (
      event.type !== 'result.action_succeeded' ||
      event.source !== 'authoritative_write_ack' ||
      event.actionId !== attempt.actionId ||
      !event.entityId ||
      eventTime(event) < attemptTime
    ) {
      continue;
    }

    const executionId = typeof event.metadata?.execution_id === 'string'
      ? event.metadata.execution_id.trim()
      : '';
    const proposalId = typeof event.metadata?.proposal_id === 'string'
      ? event.metadata.proposal_id.trim()
      : '';
    if (!EXECUTION_ID_PATTERN.test(executionId) || !proposalId) continue;

    return {
      attempt,
      storedResult: event,
      executionId,
      proposalId,
    };
  }

  return null;
};

const alreadyAuthoritativeInRuntime = (
  uid: string,
  candidate: KyrubReceiptVerificationCandidate
): boolean => {
  const attemptTime = eventTime(candidate.attempt);
  return readAuthoritativeActivityRuntimeEvents(uid, 12).some(event =>
    event.actionId === candidate.attempt.actionId &&
    event.type === 'result.action_succeeded' &&
    event.authority === 'confirmed_result' &&
    eventTime(event) >= attemptTime
  );
};

export const rehydrateKyrubiaAuthoritativeReceipt = async (
  storage: KyrubActivityStorage,
  user: User
): Promise<boolean> => {
  const candidate = findKyrubReceiptVerificationCandidate(
    readRecentKyrubActivityEvents(storage, user.uid, 24)
  );
  if (!candidate?.attempt.actionId || !candidate.storedResult.entityId) {
    return false;
  }
  if (alreadyAuthoritativeInRuntime(user.uid, candidate)) return true;

  const verified = await verifyKyrubActionReceipt(user, {
    executionId: candidate.executionId,
    actionType: candidate.attempt.actionId,
    proposalId: candidate.proposalId,
    entityId: candidate.storedResult.entityId,
  });
  if (
    !verified ||
    verified.executionId !== candidate.executionId ||
    verified.actionType !== candidate.attempt.actionId ||
    verified.proposalId !== candidate.proposalId ||
    verified.entityId !== candidate.storedResult.entityId
  ) {
    return false;
  }

  rememberAuthoritativeActivityRuntimeEvent({
    schemaVersion: 1,
    id: `server-confirmed:${verified.executionId}`,
    actorUid: user.uid,
    type: 'result.action_succeeded',
    domain: 'kyrubia',
    source: 'server_confirmed',
    authority: 'confirmed_result',
    occurredAt: new Date().toISOString(),
    actionId: verified.actionType,
    entityType: verified.entityType,
    entityId: verified.entityId,
  });

  return true;
};
