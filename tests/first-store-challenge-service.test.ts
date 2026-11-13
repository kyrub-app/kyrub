import test from 'node:test';
import assert from 'node:assert/strict';
import { awardFirstStoreChallengeForCanonicalStore } from '../server/gamification/firstStoreChallengeAwardService.js';

const uid = 'user_1';
const storeId = 'store_1';
const now = '2026-11-12T12:00:00.000Z';
const base = {
  store: { id: storeId, ownerId: uid, firstStoreCreationVerified: true, activatedAt: now },
  event: { id: 'first_store_created', userId: uid, storeId, challengeId: 'first_store_created', status: 'pending', createdAt: now },
};
const fakeDb = (event: Record<string, unknown>) => {
  let reads = 0;
  let writes = 0;
  const documents: Record<string, Record<string, unknown> | undefined> = {
    [`stores/${storeId}`]: base.store,
    'global_challenges/first_store_created': { id: 'first_store_created' },
    [`users/${uid}/verifiedStoreEvents/first_store_created`]: event,
  };
  const ref = (path: string): any => ({
    path, id: path.split('/').at(-1),
    collection: (name: string) => ({ doc: (id: string) => ref(`${path}/${name}/${id}`) }),
  });
  const db = {
    doc: ref,
    collection: (name: string) => ({ doc: (id: string) => ref(`${name}/${id}`) }),
    runTransaction: async (fn: (tx: any) => Promise<unknown>) => fn({
      get: async (r: { path: string }) => {
        reads++;
        const data = documents[r.path];
        return { exists: data !== undefined, data: () => data, get: (key: string) => data?.[key] };
      },
      create: () => { writes++; },
    }),
  };
  return { db: db as any, counts: () => ({ reads, writes }) };
};

test('first-store service refuses mismatched event challenge identifier', async () => {
  const f = fakeDb({ ...base.event, challengeId: 'another_challenge' });
  await assert.rejects(
    awardFirstStoreChallengeForCanonicalStore(f.db, { userId: uid, canonicalStoreId: storeId }),
    /FIRST_STORE_EVENT_UNVERIFIED/,
  );
  assert.deepEqual(f.counts(), { reads: 3, writes: 0 });
});

test('first-store service refuses unexpected event lifecycle state', async () => {
  for (const status of ['cancelled', 'revoked', 'complete', undefined]) {
    const f = fakeDb({ ...base.event, status });
    await assert.rejects(
      awardFirstStoreChallengeForCanonicalStore(f.db, { userId: uid, canonicalStoreId: storeId }),
      /FIRST_STORE_EVENT_UNVERIFIED/,
    );
    assert.equal(f.counts().writes, 0);
  }
});

test('first-store service refuses event not matching store activation', async () => {
  const f = fakeDb({ ...base.event, createdAt: '2026-11-12T12:02:00.000Z' });
  await assert.rejects(
    awardFirstStoreChallengeForCanonicalStore(f.db, { userId: uid, canonicalStoreId: storeId }),
    /FIRST_STORE_EVENT_UNVERIFIED/,
  );
  assert.equal(f.counts().writes, 0);
});
