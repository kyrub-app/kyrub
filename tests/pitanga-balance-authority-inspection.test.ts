import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectPitangaBalanceAuthority } from '../server/gamification/pitangaBalanceAuthorityInspection.js';

const entry = {
  id: 'earn1', userId: 'user1', type: 'earn', deltaKCoins: 100,
  sourceType: 'challenge', sourceId: 'challenge1', correlationId: 'award1',
  idempotencyKey: 'award1', occurredAt: '2026-11-11T12:00:00Z',
};
const mockDb = (projection?: Record<string, unknown>, ledgerEntries = [entry]) => ({
  collection: (path: string) => {
    assert.equal(path, 'users/user1/rewardLedger');
    return { get: async () => ({ docs: ledgerEntries.map(e => ({
      id: e.id, data: () => e,
    })) }) };
  },
  doc: (path: string) => {
    assert.equal(path, 'users/user1/pitangaBalance/balance');
    return { get: async () => ({
      exists: projection !== undefined, data: () => projection,
    }) };
  },
});

test('missing projection is reported, never created', async () => {
  assert.deepEqual(await inspectPitangaBalanceAuthority(mockDb() as never, 'user1'),
    { status: 'projection_missing', ledgerBalance: 100,
      projectedBalance: null, entryCount: 1 });
});

test('matching projection is consistent', async () => {
  assert.deepEqual(await inspectPitangaBalanceAuthority(
    mockDb({ userId: 'user1', availableKCoins: 100 }) as never, 'user1'),
    { status: 'consistent', ledgerBalance: 100,
      projectedBalance: 100, entryCount: 1 });
});

test('stale projection is inconsistent', async () => {
  const result = await inspectPitangaBalanceAuthority(
    mockDb({ userId: 'user1', availableKCoins: 0 }) as never, 'user1');
  assert.equal(result.status, 'inconsistent');
  assert.equal(result.ledgerBalance, 100);
  assert.equal(result.projectedBalance, 0);
});

test('foreign ledger entry fails closed', async () => {
  await assert.rejects(() => inspectPitangaBalanceAuthority(
    mockDb(undefined, [{ ...entry, userId: 'user2' }]) as never, 'user1'),
    /PITANGA_INSPECTION_LEDGER_SCOPE_INVALID/);
});

test('foreign projection owner is inconsistent', async () => {
  const result = await inspectPitangaBalanceAuthority(
    mockDb({ userId: 'user2', availableKCoins: 100 }) as never, 'user1');
  assert.equal(result.status, 'inconsistent');
});
