import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { Firestore } from 'firebase-admin/firestore';
import { readPersonalSemeaduraJourney, readVerifiedPostSemeadura, seedVerifiedPost } from '../server/gamification/semeaduraService';
import { handleSemeadura } from '../server/gamification/semeaduraHandler';

type RecordValue = Record<string, unknown>;
class FakeDoc {
  constructor(readonly path: string, private readonly records: Map<string, RecordValue>) {}
  collection(name: string) { return new FakeCollection(this.path + '/' + name, this.records); }
  async get() { return { exists: this.records.has(this.path), data: () => this.records.get(this.path) }; }
}
class FakeCollection {
  constructor(readonly path: string, private readonly records: Map<string, RecordValue>) {}
  doc(id: string) { return new FakeDoc(this.path + '/' + id, this.records); }
}
class FakeDb {
  readonly records = new Map<string, RecordValue>();
  doc(path: string) { return new FakeDoc(path, this.records); }
  collection(path: string) { return new FakeCollection(path, this.records); }
  async runTransaction<T>(run: (tx: {
    get: (ref: FakeDoc) => Promise<{ exists: boolean; data: () => RecordValue | undefined }>;
    create: (ref: FakeDoc, data: RecordValue) => void;
    update: (ref: FakeDoc, data: RecordValue) => void;
  }) => Promise<T>): Promise<T> {
    const writes: Array<{ action: 'create' | 'update'; path: string; data: RecordValue }> = [];
    const result = await run({
      get: async ref => ({
        exists: this.records.has(ref.path),
        data: () => this.records.get(ref.path),
      }),
      create: (ref, data) => writes.push({ action: 'create', path: ref.path, data }),
      update: (ref, data) => writes.push({ action: 'update', path: ref.path, data }),
    });
    for (const write of writes) {
      if (write.action === 'create' && this.records.has(write.path)) throw Error('ALREADY_EXISTS');
      if (write.action === 'update' && !this.records.has(write.path)) throw Error('NOT_FOUND');
      this.records.set(write.path, { ...this.records.get(write.path), ...write.data });
    }
    return result;
  }
  asFirestore(): Firestore { return this as unknown as Firestore; }
}
const personal = (db: FakeDb, id: string, author = 'author-a') => {
  db.records.set('social_posts/' + id, {
    postId: id, authorId: author, visibility: 'public', publicationType: 'feed',
  });
};
const community = (db: FakeDb, id: string, group = 'community-a', author = 'author-a') => {
  db.records.set('community_posts/' + id, { postId: id, authorId: author, communityId: group });
  db.records.set('communities/' + group, { ownerId: 'owner-a', visibility: 'public' });
};
const join = (db: FakeDb, uid: string, group = 'community-a', status = 'active') => {
  db.records.set('community_members/' + group + '__' + uid,
    { userId: uid, communityId: group, status });
};
const statsPath = (db: FakeDb) => [...db.records.keys()].find(path =>
  /^semeadura_post_stats\/[a-f0-9]{64}$/.test(path),
) || '';

test('Semear writes one immutable receipt per user/post, and awards nothing directly', async () => {
  const db = new FakeDb(); personal(db, 'post-a');
  const call = (user: string) => seedVerifiedPost(db.asFirestore(),
    { kind: 'personal', postId: 'post-a', authenticatedUserId: user });
  assert.deepEqual(await call('user-1'),
    { status: 'accepted', count: 1, closed: false, authorId: 'author-a' });
  assert.deepEqual(await call('user-1'),
    { status: 'already_seeded', count: 1, closed: false, authorId: 'author-a' });
  assert.deepEqual(await call('user-2'),
    { status: 'accepted', count: 2, closed: false, authorId: 'author-a' });
  assert.equal(db.records.get(statsPath(db))?.acceptedSeeds, 2);
  assert.equal([...db.records.keys()].filter(key => key.includes('/receipts/')).length, 2);
  assert.equal([...db.records.keys()].filter(key => /rewardLedger|xpLedger|pitangaBalance/.test(key)).length, 0);
});

test('authenticated status reads canonical receipts and increments the personal display journey', async () => {
  const db = new FakeDb(); personal(db, 'post-read');
  const target = { kind: 'personal' as const, postId: 'post-read', authenticatedUserId: 'actor-1' };
  const initial = await readVerifiedPostSemeadura(db.asFirestore(), target);
  assert.equal(initial.count, 0);
  assert.equal(initial.canSemear, true);
  assert.equal(initial.seeded, false);
  await seedVerifiedPost(db.asFirestore(), target);
  const result = await readVerifiedPostSemeadura(db.asFirestore(), target);
  assert.equal(result.count, 1);
  assert.equal(result.seeded, true);
  assert.equal(result.canSemear, false);
  assert.equal((await readPersonalSemeaduraJourney(db.asFirestore(), 'author-a')).totalSeeds, 1);
  assert.deepEqual((await readPersonalSemeaduraJourney(db.asFirestore(), 'actor-1')).totalSeeds, 0);
  assert.equal(db.records.get('users/author-a/semeaduraProgress/summary')?.acceptedSeeds, 1);
  assert.equal([...db.records.keys()].filter(k => /rewardLedger|xpLedger|pitangaBalance/.test(k)).length, 0);
});

test('community posts accrue exclusively to authors; legacy community aggregate is untouched', async () => {
  const db = new FakeDb(); community(db, 'post-collective'); join(db, 'active-voter');
  const legacyPath='communities/community-a/semeaduraProgress/summary';
  const historical={communityId:'community-a',acceptedSeeds:42,bosques:0};
  db.records.set(legacyPath,historical);
  const target={kind:'community' as const,postId:'post-collective',authenticatedUserId:'active-voter'};
  assert.equal((await seedVerifiedPost(db.asFirestore(),target)).status,'accepted');
  assert.equal((await seedVerifiedPost(db.asFirestore(),target)).status,'already_seeded');
  assert.equal((await readPersonalSemeaduraJourney(db.asFirestore(),'author-a')).totalSeeds,1);
  assert.equal((await readPersonalSemeaduraJourney(db.asFirestore(),'owner-a')).totalSeeds,0);
  assert.deepEqual(db.records.get(legacyPath),historical);
  assert.equal((await readVerifiedPostSemeadura(db.asFirestore(),target)).canSemear,false);
});

test('server rejects edited personal progress instead of minting another tree', async () => {
  const db = new FakeDb(); community(db, 'post-corrupt'); join(db, 'member');
  await seedVerifiedPost(db.asFirestore(), { kind: 'community', postId: 'post-corrupt', authenticatedUserId: 'member' });
  db.records.set('users/author-a/semeaduraProgress/summary', {
    authorId: 'author-a', acceptedSeeds: 1001, pitangueiras: 0,
  });
  join(db, 'new-member');
  await assert.rejects(seedVerifiedPost(db.asFirestore(),
    { kind: 'community', postId: 'post-corrupt', authenticatedUserId: 'new-member' }),
  /SEMEADURA_PROJECTION_INVALID/);
});

test('one bosque closes each canonical post forever, even with new users', async () => {
  const db = new FakeDb(); personal(db, 'post-b');
  await seedVerifiedPost(db.asFirestore(), { kind: 'personal', postId: 'post-b', authenticatedUserId: 'first' });
  const path = statsPath(db);
  db.records.set(path, { ...db.records.get(path), acceptedSeeds: 99_999, closed: false });
  const last = await seedVerifiedPost(db.asFirestore(), { kind: 'personal', postId: 'post-b', authenticatedUserId: 'last' });
  assert.deepEqual(last, { status: 'accepted', count: 100_000, closed: true, authorId: 'author-a' });
  const closed = await seedVerifiedPost(db.asFirestore(), { kind: 'personal', postId: 'post-b', authenticatedUserId: 'late' });
  assert.deepEqual(closed, { status: 'closed', count: 100_000, closed: true, authorId: 'author-a' });
  assert.equal([...db.records.keys()].filter(p => p.includes('/receipts/')).length, 2);
  assert.equal(db.records.get(path)?.acceptedSeeds, 100_000);
});

test('refuses self Semear and inaccessible personal content', async () => {
  const db = new FakeDb(); personal(db, 'post-c');
  await assert.rejects(seedVerifiedPost(db.asFirestore(),
    { kind: 'personal', postId: 'post-c', authenticatedUserId: 'author-a' }),
  /SEMEADURA_SELF_RECOGNITION_DENIED/);
  db.records.set('social_posts/post-c', { ...db.records.get('social_posts/post-c'), visibility: 'friends' });
  await assert.rejects(seedVerifiedPost(db.asFirestore(),
    { kind: 'personal', postId: 'post-c', authenticatedUserId: 'user-1' }),
  /SEMEADURA_POST_NOT_ELIGIBLE/);
  assert.equal(statsPath(db), '');
});

test('communities require active membership or ownership and reward the POST author', async () => {
  const db = new FakeDb(); community(db, 'comm-post'); join(db, 'pending', 'community-a', 'pending');
  await assert.rejects(seedVerifiedPost(db.asFirestore(),
    { kind: 'community', postId: 'comm-post', authenticatedUserId: 'pending' }),
  /SEMEADURA_COMMUNITY_ACCESS_DENIED/);
  await assert.rejects(seedVerifiedPost(db.asFirestore(),
    { kind: 'community', postId: 'comm-post', authenticatedUserId: 'outsider' }),
  /SEMEADURA_COMMUNITY_ACCESS_DENIED/);
  join(db, 'member-1');
  const result = await seedVerifiedPost(db.asFirestore(),
    { kind: 'community', postId: 'comm-post', authenticatedUserId: 'member-1' });
  assert.equal(result.authorId, 'author-a');
  assert.equal(result.count, 1);
  assert.equal(db.records.get(statsPath(db))?.authorId, 'author-a');
});

test('fails closed on malformed stats and forged receipt before any writes', async () => {
  const db = new FakeDb(); personal(db, 'post-d');
  await seedVerifiedPost(db.asFirestore(),
    { kind: 'personal', postId: 'post-d', authenticatedUserId: 'user-1' });
  const path = statsPath(db);
  db.records.set(path, { ...db.records.get(path), acceptedSeeds: 100_001 });
  await assert.rejects(seedVerifiedPost(db.asFirestore(),
    { kind: 'personal', postId: 'post-d', authenticatedUserId: 'user-2' }),
  /SEMEADURA_POST_COUNT_EXCEEDS_CAP/);
  assert.equal([...db.records.keys()].filter(p => p.includes('/receipts/')).length, 1);
});

test('invalid early closure and orphan receipt are never accepted as successful seeds', async () => {
  const db = new FakeDb(); personal(db, 'post-e');
  await seedVerifiedPost(db.asFirestore(),
    { kind: 'personal', postId: 'post-e', authenticatedUserId: 'one' });
  const path = statsPath(db);
  db.records.set(path, { ...db.records.get(path), acceptedSeeds: 50, closed: true });
  await assert.rejects(seedVerifiedPost(db.asFirestore(),
    { kind: 'personal', postId: 'post-e', authenticatedUserId: 'two' }),
  /SEMEADURA_STATS_INVALID/);
  db.records.delete(path);
  await assert.rejects(seedVerifiedPost(db.asFirestore(),
    { kind: 'personal', postId: 'post-e', authenticatedUserId: 'one' }),
  /SEMEADURA_ORPHAN_RECEIPT/);
});

test('transport is explicitly OFF by default, does not create a serverless function', async () => {
  const previous = process.env.KYRUB_SEMEADURA_SERVER_ENABLED;
  delete process.env.KYRUB_SEMEADURA_SERVER_ENABLED;
  const result: { status?: number; body?: unknown } = {};
  try {
    await handleSemeadura({
      method: 'POST', headers: {}, body: { kind: 'personal', action: 'semear', postId: 'post-a' },
    }, {
      status(status) { result.status = status; return this; },
      json(body) { result.body = body; },
    });
    assert.equal(result.status, 503);
    assert.deepEqual(result.body, { error: 'SEMEADURA_NOT_ENABLED' });
  } finally {
    if (previous === undefined) delete process.env.KYRUB_SEMEADURA_SERVER_ENABLED;
    else process.env.KYRUB_SEMEADURA_SERVER_ENABLED = previous;
  }
  const router = readFileSync('api/action-execute.ts', 'utf8');
  assert.match(router, /transport === 'semeadura'/);
  assert.match(router, /import\('\.\.\/server\/gamification\/semeaduraHandler\.js'\)/);
  const service = readFileSync('server/gamification/semeaduraService.ts', 'utf8');
  assert.doesNotMatch(service, /applyPitangaEarnInTransaction|applyVerifiedPitangaXpConversionInTransaction|xpLedger/);
});
