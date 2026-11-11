import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPitangaMigrationSnapshot } from '../server/gamification/pitangaMigrationSnapshot.js';
import { verifyPitangaMigrationCheckpoint } from '../server/gamification/pitangaMigrationCheckpointVerification.js';

const earn = {
  id: 'earn1', userId: 'user1', type: 'earn' as const,
  deltaKCoins: 1000, sourceType: 'challenge' as const, sourceId: 'challenge1',
  correlationId: 'corr1', idempotencyKey: 'earn1',
  occurredAt: '2026-11-11T12:00:00Z',
};
const docs = [{ id: earn.id, data: earn }];
const checkpoint = buildPitangaMigrationSnapshot({
  userId: 'user1', ledgerDocuments: docs,
  completeLedgerVerified: true, legacyWritersFenced: true,
});
const verify = (overrides: Record<string, unknown> = {}) =>
  verifyPitangaMigrationCheckpoint({
    checkpoint, ledgerDocuments: docs,
    completeLedgerVerified: true, legacyWritersFenced: true,
    ...overrides,
  } as never);

test('accepts identical historical ledger checkpoint', () => {
  assert.deepEqual(verify(), { verified: true, checkpoint: {
    userId: checkpoint.userId, balance: checkpoint.balance,
    entryCount: checkpoint.entryCount, ledgerSha256: checkpoint.ledgerSha256,
  } });
});

test('rejects a newly added ledger event after checkpoint', () => {
  const newEntry = {
    ...earn, id: 'earn2', deltaKCoins: 1, correlationId: 'corr2',
    idempotencyKey: 'earn2', occurredAt: '2026-11-11T12:01:00Z',
  };
  assert.throws(() => verify({
    ledgerDocuments: [...docs, { id: newEntry.id, data: newEntry }],
  }), /PITANGA_CHECKPOINT_STALE/);
});

test('rejects historical mutation even if final balance is unchanged', () => {
  assert.throws(() => verify({
    ledgerDocuments: [{ id: earn.id, data: { ...earn, correlationId: 'tampered' } }],
  }), /PITANGA_CHECKPOINT_STALE/);
});

test('rejects missing fence or incomplete ledger assertions', () => {
  assert.throws(() => verify({ legacyWritersFenced: false }),
    /PITANGA_MIGRATION_PRECONDITIONS_UNVERIFIED/);
  assert.throws(() => verify({ completeLedgerVerified: false }),
    /PITANGA_MIGRATION_PRECONDITIONS_UNVERIFIED/);
});

test('rejects corrupted checkpoint and projection drift', () => {
  assert.throws(() => verify({ checkpoint: { ...checkpoint, ledgerSha256: 'x' } }),
    /PITANGA_CHECKPOINT_INVALID/);
  assert.throws(() => verify({
    existingProjection: { userId: 'user1', availableKCoins: 999 },
  }), /PITANGA_MIGRATION_PROJECTION_CONFLICT/);
});
