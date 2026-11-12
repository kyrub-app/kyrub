import assert from 'node:assert/strict';
import test from 'node:test';
import { reconcilePitangaBalance } from '../server/gamification/pitangaBalanceReconciliation.js';
import type { KyrubRewardLedgerEntry } from '../shared/gamification.js';

const earn: KyrubRewardLedgerEntry = {
  id: 'earn1', userId: 'user1', type: 'earn', deltaKCoins: 150,
  sourceType: 'challenge', sourceId: 'challenge1',
  correlationId: 'award1', idempotencyKey: 'award1',
  occurredAt: '2026-11-11T12:00:00Z',
};
const debit: KyrubRewardLedgerEntry = {
  id: 'debit1', userId: 'user1', type: 'redeem', deltaKCoins: -50,
  sourceType: 'reward_redemption', sourceId: 'reward1',
  correlationId: 'spend1', idempotencyKey: 'spend1',
  occurredAt: '2026-11-11T12:01:00Z',
};
const base = { userId: 'user1', ledgerEntries: [earn, debit],
  projectedBalance: 100, projectionUserId: 'user1' };

test('complete ledger and projected balance agree', () => {
  assert.deepEqual(reconcilePitangaBalance(base),
    { userId: 'user1', ledgerBalance: 100, consistent: true });
});

test('mismatched projection blocks adoption', () => {
  assert.throws(() => reconcilePitangaBalance({ ...base, projectedBalance: 150 }),
    /PITANGA_RECONCILIATION_BALANCE_MISMATCH/);
});

test('foreign user entry blocks adoption', () => {
  assert.throws(() => reconcilePitangaBalance({
    ...base, ledgerEntries: [{ ...earn, userId: 'user2' }],
  }), /PITANGA_RECONCILIATION_LEDGER_OWNER_MISMATCH/);
});

test('invalid projection blocks adoption', () => {
  for (const projectedBalance of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, undefined]) {
    assert.throws(() => reconcilePitangaBalance({ ...base, projectedBalance }),
      /PITANGA_RECONCILIATION_PROJECTION_INVALID/);
  }
});

test('duplicate ledger idempotency blocks adoption', () => {
  assert.throws(() => reconcilePitangaBalance({
    ...base, ledgerEntries: [earn, { ...debit, idempotencyKey: earn.idempotencyKey }],
  }), /Lançamento duplicado/);
});
