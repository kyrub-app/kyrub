import test from 'node:test';
import assert from 'node:assert/strict';
import { awardVerifiedFirstStorePublicationInTransaction } from '../server/gamification/firstStorePublishedAwardTransaction.js';
import type { KyrubChallengeDefinition } from '../shared/gamification.js';

const uid = 'user_1';
const publishedAt = '2026-11-13T12:00:00.000Z';
const challenge: KyrubChallengeDefinition = {
  id: 'first_store_published', title: 'Primeira publicação', description: 'Publique sua loja',
  status: 'published', validationMode: 'deterministic', rewardKCoins: 0,
  rewardXp: 2, maxCompletionsPerUser: 1, sponsorType: 'kyrub',
};
const event = { userId: uid, storeId: 'store_1', publishedAt,
  isFirstPublication: true, isOwnerVerified: true, isMarketplaceVisible: true };
const refs = {
  receiptRef: { path: `users/${uid}/challengeRewards/first_store_${uid}` },
  xpLedgerRef: { path: `users/${uid}/xpLedger/xp_first_store_${uid}`, id: `xp_first_store_${uid}` },
  pitangaLedgerRef: { path: `users/${uid}/rewardLedger/earn_first_store_${uid}` },
};
const fixture = () => {
  const docs = new Map<string, Record<string, unknown>>();
  let writes = 0;
  const tx = {
    get: async (ref: { path: string }) => {
      const value = docs.get(ref.path);
      return { exists: value !== undefined, data: () => value };
    },
    create: (ref: { path: string }, value: Record<string, unknown>) => {
      if (docs.has(ref.path)) throw Error('ALREADY_EXISTS');
      docs.set(ref.path, value);
      writes++;
    },
  };
  const grant = () => awardVerifiedFirstStorePublicationInTransaction(tx as any,
    { challenge, event, ...refs as any });
  return { docs, grant, writes: () => writes };
};

test('first publication credits exactly 2 XP, never Pitangas; replay is read-only', async () => {
  const f = fixture();
  assert.deepEqual(await f.grant(), { replay: false, pitangas: 0, xp: 2 });
  assert.equal(f.docs.size, 2);
  assert.equal(f.docs.get(refs.xpLedgerRef.path)?.deltaXp, 2);
  assert.equal(f.docs.has(refs.pitangaLedgerRef.path), false);
  assert.deepEqual(await f.grant(), { replay: true, pitangas: 0, xp: 2 });
  assert.equal(f.writes(), 2);
});

test('valid legacy creation award suppresses a second publication award', async () => {
  const f = fixture();
  const occurredAt = '2026-11-12T12:00:00.000Z';
  f.docs.set(refs.receiptRef.path, {
    userId: uid, storeId: 'store_1', challengeId: 'first_store_created',
    pitangas: 0, xp: 2, idempotencyKey: `first_store_${uid}`, occurredAt,
  });
  f.docs.set(refs.xpLedgerRef.path, {
    userId: uid, deltaXp: 2, sourceType: 'challenge',
    sourceId: 'first_store_created', correlationId: `first_store_${uid}`,
    idempotencyKey: `first_store_${uid}`, occurredAt, economy: 'kyrub_xp',
  });
  assert.deepEqual(await f.grant(), { replay: true, pitangas: 0, xp: 2 });
  assert.equal(f.writes(), 0);
});

test('orphan ledger, mismatched receipt and Pitanga ledger fail closed', async () => {
  const a = fixture();
  a.docs.set(refs.xpLedgerRef.path, { deltaXp: 2 });
  await assert.rejects(a.grant(), /PARTIAL_STATE/);
  const b = fixture();
  b.docs.set(refs.receiptRef.path, { userId: uid });
  await assert.rejects(b.grant(), /IDEMPOTENCY_CONFLICT/);
  const c = fixture();
  c.docs.set(refs.pitangaLedgerRef.path, { deltaKCoins: 1 });
  await assert.rejects(c.grant(), /LEDGER_CONFLICT/);
});

test('tampered XP provenance and cross-user references are rejected', async () => {
  const f = fixture();
  await f.grant();
  f.docs.get(refs.xpLedgerRef.path)!.sourceId = 'other_challenge';
  await assert.rejects(f.grant(), /IDEMPOTENCY_CONFLICT/);
  await assert.rejects(awardVerifiedFirstStorePublicationInTransaction({} as any,
    { challenge, event, ...refs, receiptRef: { path: 'users/other/challengeRewards/first_store_user_1' } } as any),
    /REFERENCE_INVALID/);
});
