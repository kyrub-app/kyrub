import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  normalizeKyrubDomainEvent,
  normalizeKyrubDomainEventAttributes,
} from '../shared/kyrubDomainEvents';
import {
  deterministicKyrubCorrelationId,
  deterministicKyrubDomainEventId,
} from '../server/events/domainEventLedger';

test('domain event normalization keeps the correlation chain and bounded scalar attributes', () => {
  const event = normalizeKyrubDomainEvent({
    schemaVersion: 1,
    eventId: 'evt-1',
    correlationId: 'corr-1',
    causationId: 'evt-0',
    eventType: 'order.payment_confirmed',
    domain: 'orders',
    aggregateType: 'order',
    aggregateId: 'order-1',
    actorType: 'integration',
    actorId: 'mercado-pago',
    origin: 'provider_webhook',
    occurredAt: '2026-08-21T12:30:00.000Z',
    attributes: { status: 'paid', amountMinor: 3200 },
  });

  assert.equal(event.correlationId, 'corr-1');
  assert.equal(event.causationId, 'evt-0');
  assert.deepEqual(event.attributes, { amountMinor: 3200, status: 'paid' });
});

test('event attributes reject nested/unbounded objects instead of turning the ledger into a document dump', () => {
  assert.deepEqual(
    normalizeKyrubDomainEventAttributes({
      safe: 'ok',
      nested: { secret: 'no' },
      list: ['no'],
      nullable: null,
    }),
    { nullable: null, safe: 'ok' }
  );
});

test('correlation and event IDs are deterministic for retry-safe flows', () => {
  const correlation = deterministicKyrubCorrelationId('checkout:user-1:intent-1');
  assert.equal(correlation, deterministicKyrubCorrelationId('checkout:user-1:intent-1'));
  const first = deterministicKyrubDomainEventId({
    correlationId: correlation,
    eventType: 'payment.paid',
    aggregateType: 'payment',
    aggregateId: 'payment-1',
    dedupeKey: 'provider-event-9',
  });
  const second = deterministicKyrubDomainEventId({
    correlationId: correlation,
    eventType: 'payment.paid',
    aggregateType: 'payment',
    aggregateId: 'payment-1',
    dedupeKey: 'provider-event-9',
  });
  assert.equal(first, second);
});

test('ledger implementation is append-only and idempotent by payload hash', () => {
  const source = readFileSync('server/events/domainEventLedger.ts', 'utf8');
  assert.match(source, /transaction\.create\(reference/);
  assert.match(source, /already_recorded/);
  assert.match(source, /payloadHash/);
  assert.doesNotMatch(source, /transaction\.update\(reference/);
  assert.doesNotMatch(source, /transaction\.delete\(reference/);
});
