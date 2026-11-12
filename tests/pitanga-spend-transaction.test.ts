import assert from 'node:assert/strict';
import test from 'node:test';
import { applyPitangaSpendInTransaction } from '../server/gamification/pitangaSpendTransaction.js';

const input = {
  userId: 'user1', spendId: 'order1', sourceId: 'reward1', amount: 80,
  occurredAt: '2026-11-11T12:00:00Z',
  balanceRef: { id: 'balance', path: 'users/user1/pitangaBalance/balance',
    parent: { path: 'users/user1/pitangaBalance' } },
  debitRef: { id: 'spend_order1', path: 'users/user1/rewardLedger/spend_order1',
    parent: { path: 'users/user1/rewardLedger' } },
};
const mock = (available: number | undefined, existing?: Record<string, unknown>) => {
  const writes: Array<{ op: string; data: Record<string, unknown> }> = [];
  let reads = 0;
  const tx = {
    get: async (ref: { id: string }) => {
      reads++;
      const data = ref.id === 'balance'
        ? available === undefined ? undefined : { userId: 'user1', availableKCoins: available }
        : existing;
      return { exists: data !== undefined, data: () => data };
    },
    update: (_: unknown, data: Record<string, unknown>) => writes.push({ op: 'update', data }),
    create: (_: unknown, data: Record<string, unknown>) => writes.push({ op: 'create', data }),
  };
  return { tx, writes, get reads() { return reads; } };
};

test('spending stages atomic balance update and debit', async () => {
  const m = mock(100);
  assert.deepEqual(await applyPitangaSpendInTransaction(m.tx as never, input as never),
    { remainingPitangas: 20, replay: false });
  assert.equal(m.writes.length, 2);
  assert.equal(m.writes[0].data.availableKCoins, 20);
  assert.equal(m.writes[1].data.deltaKCoins, -80);
});

test('insufficient balance never stages writes', async () => {
  const m = mock(79);
  await assert.rejects(() => applyPitangaSpendInTransaction(m.tx as never, input as never),
    /PITANGA_SPEND_INSUFFICIENT_BALANCE/);
  assert.equal(m.writes.length, 0);
});

test('missing balance fails closed', async () => {
  const m = mock(undefined);
  await assert.rejects(() => applyPitangaSpendInTransaction(m.tx as never, input as never),
    /PITANGA_SPEND_BALANCE_UNAVAILABLE/);
  assert.equal(m.writes.length, 0);
});

test('replay preserves balance and does not duplicate debit', async () => {
  const m = mock(20, {
    id: 'spend_order1', userId: 'user1', type: 'redeem', economy: 'k_coin',
    sourceType: 'reward_redemption', sourceId: 'reward1', correlationId: 'order1', deltaKCoins: -80,
    idempotencyKey: 'pitanga_spend_order1', occurredAt: input.occurredAt,
  });
  assert.deepEqual(await applyPitangaSpendInTransaction(m.tx as never, input as never),
    { remainingPitangas: 20, replay: true });
  assert.equal(m.writes.length, 0);
});

test('replay with changed debit is rejected', async () => {
  const m = mock(20, {
    id: 'spend_order1', userId: 'user1', type: 'redeem', economy: 'k_coin',
    sourceType: 'reward_redemption', sourceId: 'reward1', deltaKCoins: -50,
    idempotencyKey: 'pitanga_spend_order1', occurredAt: input.occurredAt,
  });
  await assert.rejects(() => applyPitangaSpendInTransaction(m.tx as never, input as never),
    /PITANGA_SPEND_IDEMPOTENCY_CONFLICT/);
  assert.equal(m.writes.length, 0);
});

test('cross-user debit is rejected before reads', async () => {
  const m = mock(100);
  await assert.rejects(() => applyPitangaSpendInTransaction(m.tx as never, {
    ...input,
    debitRef: { id: 'spend_order1', path: 'users/user2/rewardLedger/spend_order1',
      parent: { path: 'users/user2/rewardLedger' } },
  } as never), /PITANGA_SPEND_REFERENCE_INVALID/);
  assert.equal(m.reads, 0);
  assert.equal(m.writes.length, 0);
});


test('spending rejects a shadow balance document before reads', async () => {
  const m = mock(100);
  await assert.rejects(() => applyPitangaSpendInTransaction(m.tx as never, {
    ...input, balanceRef: { id: 'shadow', path: 'users/user1/pitangaBalance/shadow',
      parent: { path: 'users/user1/pitangaBalance' } },
  } as never), /PITANGA_SPEND_REFERENCE_INVALID/);
  assert.equal(m.reads, 0);
});

test('replay with altered correlation ID is rejected without writes', async () => {
  const m = mock(20, {
    id: 'spend_order1', userId: 'user1', type: 'redeem', economy: 'k_coin',
    sourceType: 'reward_redemption', sourceId: 'reward1', correlationId: 'other_order',
    deltaKCoins: -80, idempotencyKey: 'pitanga_spend_order1',
    occurredAt: input.occurredAt,
  });
  await assert.rejects(() => applyPitangaSpendInTransaction(m.tx as never, input as never),
    /PITANGA_SPEND_IDEMPOTENCY_CONFLICT/);
  assert.equal(m.writes.length, 0);
});
