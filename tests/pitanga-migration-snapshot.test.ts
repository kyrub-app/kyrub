import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPitangaMigrationSnapshot } from '../server/gamification/pitangaMigrationSnapshot.js';

const earn = {
  id: 'earn1', userId: 'user1', type: 'earn' as const, deltaKCoins: 1200,
  sourceType: 'challenge' as const, sourceId: 'challenge1',
  correlationId: 'c1', idempotencyKey: 'earn1', occurredAt: '2026-11-11T12:00:00Z',
};
const spend = {
  id: 'spend1', userId: 'user1', type: 'redeem' as const, deltaKCoins: -200,
  sourceType: 'reward_redemption' as const, sourceId: 'reward1',
  correlationId: 'c2', idempotencyKey: 'spend1', occurredAt: '2026-11-11T12:01:00Z',
};
const docs = [{ id: 'earn1', data: earn }, { id: 'spend1', data: spend }];
const input = {
  userId: 'user1', ledgerDocuments: docs,
  completeLedgerVerified: true, legacyWritersFenced: true,
};

test('historical ledger produces stable evidence independent of read order', () => {
  const a = buildPitangaMigrationSnapshot(input);
  const b = buildPitangaMigrationSnapshot({ ...input, ledgerDocuments: [...docs].reverse() });
  assert.deepEqual(a, b);
  assert.equal(a.balance, 1000);
  assert.equal(a.entryCount, 2);
  assert.match(a.ledgerSha256, /^[a-f0-9]{64}$/);
});

test('does not authorize migration without verified completeness and writer fence', () => {
  for (const override of [
    { completeLedgerVerified: false },
    { legacyWritersFenced: false },
  ]) {
    assert.throws(() => buildPitangaMigrationSnapshot({ ...input, ...override }),
      /PITANGA_MIGRATION_PRECONDITIONS_UNVERIFIED/);
  }
});

test('rejects duplicate, foreign and mismatched document IDs', () => {
  for (const ledgerDocuments of [
    [...docs, docs[0]],
    [{ id: 'other', data: earn }],
    [{ id: 'earn1', data: { ...earn, userId: 'user2' } }],
  ]) {
    assert.throws(() => buildPitangaMigrationSnapshot({ ...input, ledgerDocuments }),
      /PITANGA_MIGRATION_LEDGER_SCOPE_INVALID/);
  }
});

test('rejects inconsistent existing projection instead of overwriting it', () => {
  assert.throws(() => buildPitangaMigrationSnapshot({
    ...input, existingProjection: { userId: 'user1', availableKCoins: 0 },
  }), /PITANGA_MIGRATION_PROJECTION_CONFLICT/);
  assert.equal(buildPitangaMigrationSnapshot({
    ...input, existingProjection: { userId: 'user1', availableKCoins: 1000 },
  }).balance, 1000);
});

test('rejects duplicate ledger idempotency and negative historical balance', () => {
  assert.throws(() => buildPitangaMigrationSnapshot({
    ...input, ledgerDocuments: [{ id: 'earn1', data: earn },
      { id: 'spend1', data: { ...spend, idempotencyKey: 'earn1' } }],
  }), /Lançamento duplicado/);
  assert.throws(() => buildPitangaMigrationSnapshot({
    ...input, ledgerDocuments: [{ id: 'spend1', data: spend }],
  }), /saldo negativo/);
});
