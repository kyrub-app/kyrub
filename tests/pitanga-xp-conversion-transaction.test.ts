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
    snapshots.set('debit', { deltaKCoins: -100 });
    snapshots.set('xp', { deltaXp: 1 });
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
