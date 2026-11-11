import assert from 'node:assert/strict';
import test from 'node:test';
import { applyPitangaXpConversionInTransaction } from '../server/gamification/pitangaXpConversionTransaction.js';

const ref = (id: string) => ({ id });
const makeTx = (balance: number, replay = false) => {
  const refs = { balanceRef: ref('balance'), debitRef: ref('debit'), xpRef: ref('xp'), receiptRef: ref('receipt') };
  const snapshots = new Map<string, Record<string, unknown>>([
    ['balance', { userId: 'user1', availableKCoins: balance }],
  ]);
  if (replay) {
    snapshots.set('receipt', { userId: 'user1', requestId: 'req1', requestedXp: 1, availablePitangasBefore: 100, status: 'committed' });
    snapshots.set('debit', { id: 'debit', userId: 'user1', idempotencyKey: 'pitanga_xp_req1', type: 'redeem', sourceType: 'reward_redemption', sourceId: 'req1', deltaKCoins: -100 });
    snapshots.set('xp', { id: 'xp', userId: 'user1', idempotencyKey: 'pitanga_xp_req1', sourceType: 'conversion', sourceId: 'req1', deltaXp: 1 });
  }
  const writes: Array<{ op: string; id: string; value: Record<string, unknown> }> = [];
  const tx = {
    get: async (r: { id: string }) => ({
      exists: snapshots.has(r.id), data: () => snapshots.get(r.id),
    }),
    create: (r: { id: string }, value: Record<string, unknown>) => { writes.push({ op: 'create', id: r.id, value }); },
    update: (r: { id: string }, value: Record<string, unknown>) => { writes.push({ op: 'update', id: r.id, value }); },
  };
  return { refs, tx, writes };
};

test('stages balance update, debit, XP credit and receipt together', async () => {
  const { refs, tx, writes } = makeTx(100);
  const result = await applyPitangaXpConversionInTransaction(tx as never, {
    ...refs, userId: 'user1', requestId: 'req1', requestedXp: 1, occurredAt: '2026-11-11T12:00:00Z',
  } as never);
  assert.deepEqual(result, { xpCredited: 1, pitangasDebited: 100, remainingPitangas: 0, replay: false });
  assert.equal(writes.length, 4);
  assert.equal(writes.find(w => w.id === 'balance')?.value.availableKCoins, 0);
  assert.equal(writes.find(w => w.id === 'debit')?.value.deltaKCoins, -100);
  assert.equal(writes.find(w => w.id === 'xp')?.value.deltaXp, 1);
  assert.equal(writes.find(w => w.id === 'xp')?.value.sourceType, 'conversion');
});

test('same request replay does not stage additional writes', async () => {
  const { refs, tx, writes } = makeTx(0, true);
  const result = await applyPitangaXpConversionInTransaction(tx as never, {
    ...refs, userId: 'user1', requestId: 'req1', requestedXp: 1, occurredAt: '2026-11-11T12:00:00Z',
  } as never);
  assert.equal(result.replay, true);
  assert.equal(writes.length, 0);
});

test('insufficient balance fails without writes', async () => {
  const { refs, tx, writes } = makeTx(99);
  await assert.rejects(() => applyPitangaXpConversionInTransaction(tx as never, {
    ...refs, userId: 'user1', requestId: 'req1', requestedXp: 1, occurredAt: '2026-11-11T12:00:00Z',
  } as never), /PITANGA_BALANCE_INSUFFICIENT/);
  assert.equal(writes.length, 0);
});

test('conflicting replay rejects', async () => {
  const { refs, tx } = makeTx(0, true);
  await assert.rejects(() => applyPitangaXpConversionInTransaction(tx as never, {
    ...refs, userId: 'user1', requestId: 'req1', requestedXp: 2, occurredAt: '2026-11-11T12:00:00Z',
  } as never), /CONVERSION_IDEMPOTENCY_CONFLICT/);
});

test('missing authoritative balance fails closed', async () => {
  const { refs, tx, writes } = makeTx(100);
  const missingBalanceTx = {
    ...tx,
    get: async (r: { id: string }) => r.id === 'balance'
      ? { exists: false, data: () => undefined }
      : tx.get(r),
  };
  await assert.rejects(() => applyPitangaXpConversionInTransaction(missingBalanceTx as never, {
    ...refs, userId: 'user1', requestId: 'req1', requestedXp: 1, occurredAt: '2026-11-11T12:00:00Z',
  } as never), /CONVERSION_BALANCE_NOT_INITIALIZED/);
  assert.equal(writes.length, 0);
});

test('partial ledger state fails closed without additional writes', async () => {
  const { refs, tx, writes } = makeTx(100);
  const partialTx = {
    ...tx,
    get: async (r: { id: string }) => r.id === 'debit'
      ? { exists: true, data: () => ({ deltaKCoins: -100 }) }
      : tx.get(r),
  };
  await assert.rejects(() => applyPitangaXpConversionInTransaction(partialTx as never, {
    ...refs, userId: 'user1', requestId: 'req1', requestedXp: 1, occurredAt: '2026-11-11T12:00:00Z',
  } as never), /CONVERSION_PARTIAL_STATE/);
  assert.equal(writes.length, 0);
});

test('inconsistent replay receipt fails closed', async () => {
  const { refs, tx, writes } = makeTx(0, true);
  const inconsistentTx = {
    ...tx,
    get: async (r: { id: string }) => r.id === 'xp'
      ? { exists: true, data: () => ({ deltaXp: 2 }) }
      : tx.get(r),
  };
  await assert.rejects(() => applyPitangaXpConversionInTransaction(inconsistentTx as never, {
    ...refs, userId: 'user1', requestId: 'req1', requestedXp: 1, occurredAt: '2026-11-11T12:00:00Z',
  } as never), /CONVERSION_LEDGER_INCONSISTENT/);
  assert.equal(writes.length, 0);
});

test('replay with ledger belonging to another user is rejected', async () => {
  const { refs, tx, writes } = makeTx(0, true);
  const tampered = {
    ...tx,
    get: async (r: { id: string }) => r.id === 'xp'
      ? { exists: true, data: () => ({ id: 'xp', userId: 'other_user', idempotencyKey: 'pitanga_xp_req1', sourceType: 'conversion', deltaXp: 1 }) }
      : tx.get(r),
  };
  await assert.rejects(() => applyPitangaXpConversionInTransaction(tampered as never, {
    ...refs, userId: 'user1', requestId: 'req1', requestedXp: 1, occurredAt: '2026-11-11T12:00:00Z',
  } as never), /CONVERSION_LEDGER_INCONSISTENT/);
  assert.equal(writes.length, 0);
});

test('invalid XP amount fails before any transaction reads', async () => {
  const { refs, writes } = makeTx(100);
  let reads = 0;
  const tx = { get: async () => { reads++; throw new Error('SHOULD_NOT_READ'); } };
  await assert.rejects(() => applyPitangaXpConversionInTransaction(tx as never, {
    ...refs, userId: 'user1', requestId: 'req1', requestedXp: 0, occurredAt: '2026-11-11T12:00:00Z',
  } as never), /XP_CONVERSION_AMOUNT_INVALID/);
  assert.equal(reads, 0);
  assert.equal(writes.length, 0);
});
