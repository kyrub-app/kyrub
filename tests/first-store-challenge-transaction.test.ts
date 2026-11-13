import test from 'node:test';
import assert from 'node:assert/strict';
import { awardVerifiedFirstStoreChallengeInTransaction } from '../server/gamification/firstStoreChallengeAwardTransaction.js';
import type { KyrubChallengeDefinition } from '../shared/gamification.js';

const uid = 'user_1';
const occurredAt = '2026-11-12T12:00:00.000Z';
const challenge: KyrubChallengeDefinition = {
  id: 'first_store_created', title: 'Primeira loja', description: 'Crie uma loja',
  status: 'published', validationMode: 'deterministic',
  rewardKCoins: 0, rewardXp: 2, maxCompletionsPerUser: 1, sponsorType: 'kyrub',
};
const event = { userId: uid, storeId: 'store_1', createdAt: occurredAt, isFirstStore: true };
const refs = {
  balanceRef: { path: `users/${uid}/pitangaBalance/balance` },
  pitangaLedgerRef: { path: `users/${uid}/rewardLedger/earn_first_store_${uid}` },
  xpLedgerRef: { path: `users/${uid}/xpLedger/xp_first_store_${uid}`, id: `xp_first_store_${uid}` },
  receiptRef: { path: `users/${uid}/challengeRewards/first_store_${uid}` },
};
const fixture = () => {
  const docs = new Map<string, Record<string, unknown>>();
  let reads = 0;
  let writes = 0;
  const tx = {
    get: async (ref: { path: string }) => {
      reads++;
      const value = docs.get(ref.path);
      return { exists: value !== undefined, data: () => value };
    },
    create: (ref: { path: string }, value: Record<string, unknown>) => {
      if (docs.has(ref.path)) throw Error('ALREADY_EXISTS');
      docs.set(ref.path, value);
      writes++;
    },
  };
  const grant = () => awardVerifiedFirstStoreChallengeInTransaction(tx as any, {
    challenge, event, ...refs as any,
  });
  return { docs, grant, counts: () => ({ reads, writes }) };
};

test('first-store XP award creates only XP and receipt; replay is read-only', async () => {
  const f = fixture();
  assert.deepEqual(await f.grant(), { replay: false, pitangas: 0, xp: 2 });
  assert.equal(f.docs.size, 2);
  assert.equal(f.docs.get(refs.xpLedgerRef.path)?.deltaXp, 2);
  assert.equal(f.docs.get(refs.receiptRef.path)?.userId, uid);
  assert.equal(f.docs.has(refs.balanceRef.path), false);
  assert.equal(f.docs.has(refs.pitangaLedgerRef.path), false);
  const before = f.counts().writes;
  assert.deepEqual(await f.grant(), { replay: true, pitangas: 0, xp: 2 });
  assert.equal(f.counts().writes, before);
});

test('first-store XP refuses an orphan ledger or orphan receipt', async () => {
  const f = fixture();
  f.docs.set(refs.xpLedgerRef.path, { deltaXp: 2 });
  await assert.rejects(f.grant(), /FIRST_STORE_REWARD_PARTIAL_STATE/);
  assert.equal(f.counts().writes, 0);

  const g = fixture();
  g.docs.set(refs.receiptRef.path, { userId: uid });
  await assert.rejects(g.grant(), /FIRST_STORE_REWARD_IDEMPOTENCY_CONFLICT/);
  assert.equal(g.counts().writes, 0);
});

test('first-store XP refuses unexpected Pitanga ledger even on replay', async () => {
  const f = fixture();
  await f.grant();
  f.docs.set(refs.pitangaLedgerRef.path, { deltaKCoins: 1000 });
  await assert.rejects(f.grant(), /FIRST_STORE_REWARD_IDEMPOTENCY_CONFLICT/);
  assert.equal(f.counts().writes, 2);
});

test('first-store XP rejects cross-user reference substitution before writes', async () => {
  const f = fixture();
  await assert.rejects(
    awardVerifiedFirstStoreChallengeInTransaction({
      get: async () => { throw Error('SHOULD_NOT_READ'); },
    } as any, { challenge, event, ...refs, xpLedgerRef: { path: 'users/other/xpLedger/xp_first_store_user_1', id: 'x' } } as any),
    /FIRST_STORE_REWARD_REFERENCE_INVALID/,
  );
  assert.equal(f.counts().writes, 0);
});

test('first-store XP replay rejects altered ledger provenance', async () => {
  for (const [field, value] of [
    ['sourceType', 'manual'], ['economy', 'pitanga'], ['correlationId', 'other'],
    ['occurredAt', '2026-11-01T00:00:00.000Z'],
  ] as const) {
    const f = fixture();
    await f.grant();
    const ledger = f.docs.get(refs.xpLedgerRef.path);
    assert.ok(ledger);
    ledger[field] = value;
    await assert.rejects(f.grant(), /FIRST_STORE_REWARD_IDEMPOTENCY_CONFLICT/);
    assert.equal(f.counts().writes, 2);
  }
});
