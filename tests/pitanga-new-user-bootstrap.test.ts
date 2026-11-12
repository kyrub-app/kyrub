import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeNewUserPitangaBalanceInTransaction } from '../server/gamification/pitangaNewUserBootstrapTransaction.js';

const uid = 'new_user_1';
const refs = {
  fenceRef: { path: 'systemControl/pitangaLegacyWriterFence' },
  ledgerRef: { path: `users/${uid}/rewardLedger` },
  balanceRef: { path: `users/${uid}/pitangaBalance/balance` },
  receiptRef: { path: `users/${uid}/pitangaNewUserBootstrap/receipt` },
};
const input = {
  userId: uid,
  firebaseCreatedAt: '2026-11-12T12:00:00Z',
  campaignEffectiveAt: '2026-11-12T00:00:00Z',
  legacyWritersFenced: true,
  fenceEpoch: 'epoch_1',
  ...refs,
};
function mockTx(options: { entries?: number; balance?: unknown; receipt?: unknown; fenced?: boolean } = {}) {
  const writes: Array<{ op: string; path: string }> = [];
  const tx = {
    get: async (ref: { path: string }) => {
      if (ref.path === refs.fenceRef.path) return {
        exists: true, data: () => options.fenced === false
          ? { status: 'open', epoch: 'epoch_1', writersVerified: false }
          : { status: 'fenced', epoch: 'epoch_1', writersVerified: true },
      };
      if (ref.path === refs.ledgerRef.path) return { empty: !options.entries };
      const data = ref.path === refs.balanceRef.path ? options.balance : options.receipt;
      return { exists: data !== undefined, data: () => data };
    },
    create: (ref: { path: string }) => { writes.push({ op: 'create', path: ref.path }); },
  };
  return { tx: tx as any, writes };
}

test('new user empty ledger creates exactly balance and immutable receipt', async () => {
  const { tx, writes } = mockTx();
  assert.deepEqual(await initializeNewUserPitangaBalanceInTransaction(tx, input), { initialized: true, balance: 0 });
  assert.deepEqual(writes.map(w => w.path), [refs.balanceRef.path, refs.receiptRef.path]);
});

test('historical user and missing verified fence cannot initialize a balance', async () => {
  for (const invalid of [
    { firebaseCreatedAt: '2026-11-11T00:00:00Z' },
    { legacyWritersFenced: false },
    { fenceEpoch: '../invalid' },
  ]) {
    const { tx, writes } = mockTx();
    await assert.rejects(initializeNewUserPitangaBalanceInTransaction(tx, { ...input, ...invalid }), /UNVERIFIED/);
    assert.equal(writes.length, 0);
  }
});

test('historical ledger or open fence fails closed', async () => {
  for (const options of [{ entries: 1 }, { fenced: false }]) {
    const { tx, writes } = mockTx(options);
    await assert.rejects(initializeNewUserPitangaBalanceInTransaction(tx, input), /HISTORICAL_LEDGER|FENCE_UNVERIFIED/);
    assert.equal(writes.length, 0);
  }
});

test('existing matching balance and receipt replay without writes', async () => {
  const { tx, writes } = mockTx({
    balance: { userId: uid, availableKCoins: 1000 },
    receipt: { userId: uid, fenceEpoch: 'epoch_1', firebaseCreatedAt: input.firebaseCreatedAt },
  });
  assert.deepEqual(await initializeNewUserPitangaBalanceInTransaction(tx, input), { initialized: false, balance: 1000 });
  assert.equal(writes.length, 0);
});

test('partial or mismatched state never resets an existing balance', async () => {
  for (const options of [
    { balance: { userId: uid, availableKCoins: 1000 } },
    { receipt: { userId: uid, fenceEpoch: 'epoch_1', firebaseCreatedAt: input.firebaseCreatedAt } },
    { balance: { userId: uid, availableKCoins: 1000 }, receipt: { userId: uid, fenceEpoch: 'wrong', firebaseCreatedAt: input.firebaseCreatedAt } },
  ]) {
    const { tx, writes } = mockTx(options);
    await assert.rejects(initializeNewUserPitangaBalanceInTransaction(tx, input), /CONFLICT/);
    assert.equal(writes.length, 0);
  }
});
