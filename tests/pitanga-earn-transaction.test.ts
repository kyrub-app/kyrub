import assert from 'node:assert/strict';
import test from 'node:test';
import { applyPitangaEarnInTransaction } from '../server/gamification/pitangaEarnTransaction.js';

const ref = (collection: string, id: string) => ({
  id, path: `users/user1/${collection}/${id}`,
  parent: { path: `users/user1/${collection}` },
});
const refs = {
  balanceRef: ref('pitangaBalance', 'balance'),
  ledgerRef: ref('rewardLedger', 'earn_award1'),
};
const input = {
  userId: 'user1', awardId: 'award1', sourceType: 'challenge' as const,
  sourceId: 'challenge1', amount: 100, occurredAt: '2026-11-11T12:00:00Z',
  ...refs,
};
const mock = (balance: number | undefined, existing?: Record<string, unknown>) => {
  const writes: Array<{ op: string; id: string; data: Record<string, unknown> }> = [];
  let reads = 0;
  const tx = {
    get: async (reference: { id: string }) => {
      reads++;
      const data = reference.id === 'balance'
        ? balance === undefined ? undefined : { userId: 'user1', availableKCoins: balance }
        : existing;
      return { exists: data !== undefined, data: () => data };
    },
    update: (r: { id: string }, data: Record<string, unknown>) =>
      writes.push({ op: 'update', id: r.id, data }),
    create: (r: { id: string }, data: Record<string, unknown>) =>
      writes.push({ op: 'create', id: r.id, data }),
  };
  return { tx, writes, get reads() { return reads; } };
};

test('earning stages one balance update and one ledger credit', async () => {
  const m = mock(75);
  assert.deepEqual(await applyPitangaEarnInTransaction(m.tx as never, input as never),
    { balance: 175, replay: false });
  assert.equal(m.writes.length, 2);
  assert.equal(m.writes[0].data.availableKCoins, 175);
  assert.equal(m.writes[1].data.deltaKCoins, 100);
  assert.equal(m.writes[1].data.economy, 'k_coin');
});

test('replaying an identical award does not create another credit', async () => {
  const m = mock(175, {
    id: 'earn_award1', userId: 'user1', type: 'earn', economy: 'k_coin',
    sourceType: 'challenge', sourceId: 'challenge1', deltaKCoins: 100,
    idempotencyKey: 'pitanga_earn_award1', occurredAt: input.occurredAt,
  });
  assert.deepEqual(await applyPitangaEarnInTransaction(m.tx as never, input as never),
    { balance: 175, replay: true });
  assert.equal(m.writes.length, 0);
});

test('replaying an award with changed amount is rejected', async () => {
  const m = mock(175, {
    id: 'earn_award1', userId: 'user1', type: 'earn', economy: 'k_coin',
    sourceType: 'challenge', sourceId: 'challenge1', deltaKCoins: 50,
    idempotencyKey: 'pitanga_earn_award1', occurredAt: input.occurredAt,
  });
  await assert.rejects(
    () => applyPitangaEarnInTransaction(m.tx as never, input as never),
    /PITANGA_EARN_IDEMPOTENCY_CONFLICT/,
  );
  assert.equal(m.writes.length, 0);
});

test('missing balance fails closed and never initializes from zero', async () => {
  const m = mock(undefined);
  await assert.rejects(
    () => applyPitangaEarnInTransaction(m.tx as never, input as never),
    /PITANGA_EARN_BALANCE_UNAVAILABLE/,
  );
  assert.equal(m.writes.length, 0);
});

test('overflow fails without writes', async () => {
  const m = mock(Number.MAX_SAFE_INTEGER);
  await assert.rejects(
    () => applyPitangaEarnInTransaction(m.tx as never, input as never),
    /PITANGA_EARN_BALANCE_INVALID/,
  );
  assert.equal(m.writes.length, 0);
});

test('cross-user ledger reference fails before transaction reads', async () => {
  const m = mock(100);
  await assert.rejects(
    () => applyPitangaEarnInTransaction(m.tx as never, {
      ...input, ledgerRef: { id: 'earn_award1',
        path: 'users/user2/rewardLedger/earn_award1',
        parent: { path: 'users/user2/rewardLedger' } },
    } as never),
    /PITANGA_EARN_REFERENCE_INVALID/,
  );
  assert.equal(m.reads, 0);
  assert.equal(m.writes.length, 0);
});
