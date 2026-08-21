import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import {
  normalizeKyrubDomainEvent,
  type KyrubDomainEvent,
} from '../../shared/kyrubDomainEvents.js';
import { adminDb } from '../firebaseAdmin.js';

const DOMAIN_EVENT_LEDGER = 'domainEventLedger';

const stableHash = (event: KyrubDomainEvent): string => createHash('sha256')
  .update(JSON.stringify(event))
  .digest('hex');

export type AppendKyrubDomainEventResult = {
  status: 'recorded' | 'already_recorded';
  eventId: string;
  correlationId: string;
};

export const appendKyrubDomainEvent = async (
  rawEvent: KyrubDomainEvent
): Promise<AppendKyrubDomainEventResult> => {
  const event = normalizeKyrubDomainEvent(rawEvent);
  const payloadHash = stableHash(event);
  const reference = adminDb.doc(`${DOMAIN_EVENT_LEDGER}/${event.eventId}`);

  const status = await adminDb.runTransaction(async transaction => {
    const existing = await transaction.get(reference);
    if (existing.exists) {
      const current = existing.data() as Record<string, unknown>;
      if (current.payloadHash === payloadHash) return 'already_recorded' as const;
      throw new Error('DOMAIN_EVENT_ID_CONFLICT');
    }

    transaction.create(reference, {
      ...event,
      payloadHash,
      recordedAt: FieldValue.serverTimestamp(),
    });
    return 'recorded' as const;
  });

  return {
    status,
    eventId: event.eventId,
    correlationId: event.correlationId,
  };
};

export const deterministicKyrubDomainEventId = (input: {
  correlationId: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  dedupeKey: string;
}): string => `evt_${createHash('sha256')
  .update([
    input.correlationId,
    input.eventType,
    input.aggregateType,
    input.aggregateId,
    input.dedupeKey,
  ].join(':'))
  .digest('hex')
  .slice(0, 40)}`;

export const deterministicKyrubCorrelationId = (seed: string): string =>
  `corr_${createHash('sha256').update(seed).digest('hex').slice(0, 40)}`;
