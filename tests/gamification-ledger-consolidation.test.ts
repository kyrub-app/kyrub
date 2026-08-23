import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertKCoinLedgerIdempotency,
  createAuditableKCoinLedgerEntry,
} from '../shared/gamificationLedger';

const entry = createAuditableKCoinLedgerEntry({
  id: 'ledger-1',
  userId: 'user-1',
  type: 'earn',
  deltaKCoins: 50,
  origin: 'challenge',
  originId: 'challenge-1',
  challengeId: 'challenge-1',
  reason: 'Conclusão aprovada do desafio.',
  correlationId: 'corr-1',
  idempotencyKey: 'challenge-1:user-1:reward',
  occurredAt: '2026-08-23T03:00:00.000Z',
});

test('auditable K-Coin entries contain user, origin, challenge, reason, correlation and idempotency', () => {
  assert.equal(entry.economy, 'k_coin');
  assert.equal(entry.userId, 'user-1');
  assert.equal(entry.sourceType, 'challenge');
  assert.equal(entry.challengeId, 'challenge-1');
  assert.ok(entry.reason);
  assert.ok(entry.correlationId);
  assert.ok(entry.idempotencyKey);
});

test('reward ledger rejects repeated idempotency keys', () => {
  assert.throws(() => assertKCoinLedgerIdempotency([entry, { ...entry, id: 'ledger-2' }]), /IDEMPOTENCY_CONFLICT/);
});
