import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { Firestore } from 'firebase-admin/firestore';
import { readPersonalSemeaduraJourney, readVerifiedPostSemeadura, readVerifiedPostSemeaduraBatch, seedVerifiedPost } from '../server/gamification/semeaduraService';
import { handleSemeadura } from '../server/gamification/semeaduraHandler';

type RecordValue = Record<string, unknown>;
class FakeDoc {
  constructor(readonly path: string, private readonly records: Map<string, RecordValue>, private readonly reads?:string[]) {}
  collection(name: string) { return new FakeCollection(this.path + '/' + name, this.records,this.reads); }
  async get() { this.reads?.push(this.path); return { exists: this.records.has(this.path), data: () => this.records.get(this.path) }; }
}
class FakeCollection {
  constructor(readonly path: string, private readonly records: Map<string, RecordValue>,private readonly reads?:string[]) {}
  doc(id: string) { return new FakeDoc(this.path + '/' + id, this.records,this.reads); }
}
class FakeDb {
  readonly records = new Map<string, RecordValue>();
  readonly reads:string[]=[];
  doc(path: string) { return new FakeDoc(path, this.records,this.reads); }
  collection(path: string) { return new FakeCollection(path, this.records,this.reads); }
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


test('strict request parsing rejects coerced read actions, unseed, actor injection and malformed targets',async()=>{
 const {parseSemeaduraRequest}=await import('../server/gamification/semeaduraRequestAuthority.js');
 const target={kind:'community',postId:'post-a'};
 assert.deepEqual(parseSemeaduraRequest({action:'status',...target}),{action:'status',...target});
 assert.deepEqual(parseSemeaduraRequest({action:'semear',...target}),{action:'semear',...target});
 assert.deepEqual(parseSemeaduraRequest({action:'journey'}),{action:'journey'});
 for(const value of [
  {action:['status'],...target},{action:['semear'],...target},{action:'dessemear',...target},
  {action:'toggle',...target},{action:'community-journey',communityId:'abc'},
  {action:'semear',...target,authenticatedUserId:'other'},
  {action:'status',kind:'community',postId:'../private'},
  {action:'semear',kind:'community',postId:['post-a']},
  {action:'semear',kind:'community'},null,[],{action:'journey',userId:'other'},
 ])assert.equal(parseSemeaduraRequest(value),null);
});

test('mutation authentication rejects revoked, expired, disabled and mismatched accounts',async()=>{
 const {authorizeSemeaduraMutation}=await import('../server/gamification/semeaduraRequestAuthority.js');
 const now=Date.parse('2026-11-24T20:00:00Z'),project='demo-test',uid='actor';
 const token=(extra:Record<string,unknown>={})=>'header.'+Buffer.from(JSON.stringify({sub:uid,aud:project,exp:now/1000+600,auth_time:now/1000-60,...extra})).toString('base64url')+'.signature';
 let verified=0,lookups=0;
 const deps={verify:async()=>{verified++;return {uid}},getUser:async()=>{lookups++;return {uid,disabled:false,tokensValidAfterTime:new Date(now-120000).toISOString()}},actualProject:()=>project,expectedProject:project,now:()=>now};
 assert.equal(await authorizeSemeaduraMutation(token(),deps),uid);
 assert.equal(verified,1);assert.equal(lookups,1);
 for(const extra of [{exp:now/1000},{sub:'other'},{aud:'other'},{auth_time:'bad'},{auth_time:now/1000+301}]){
  await assert.rejects(authorizeSemeaduraMutation(token(extra),deps),/SEMEADURA_AUTH_INVALID/);
 }
 assert.equal(lookups,1,'invalid signed claims never query user records');
 for(const account of [{uid,disabled:true},{uid:'other',disabled:false},{uid,disabled:false,tokensValidAfterTime:new Date(now-1000).toISOString()},{uid,disabled:false,tokensValidAfterTime:'invalid'}]){
  await assert.rejects(authorizeSemeaduraMutation(token(),{...deps,getUser:async()=>account}),/SEMEADURA_AUTH_INVALID/);
 }
 await assert.rejects(authorizeSemeaduraMutation(token(),{...deps,actualProject:()=> 'other'}),/SEMEADURA_AUTH_PROJECT_MISMATCH/);
 await assert.rejects(authorizeSemeaduraMutation(token(),{...deps,verify:async()=>{throw Error('invalid signature')}}),/invalid signature/);
 await assert.rejects(authorizeSemeaduraMutation(token(),{...deps,getUser:async()=>{throw Error('identity backend unavailable')}}),/identity backend unavailable/);
});

test('daily limit uses civil Brasília day and strictly validates server counters',async()=>{
 const {semeaduraDay,readSemeaduraDailyCount,SEMEADURA_DAILY_LIMIT}=await import('../shared/semeaduraDailyLimit.js');
 assert.equal(SEMEADURA_DAILY_LIMIT,100);
 assert.equal(semeaduraDay(new Date('2026-11-25T02:59:59.999Z')),'2026-11-24');
 assert.equal(semeaduraDay(new Date('2026-11-25T03:00:00.000Z')),'2026-11-25');
 assert.equal(readSemeaduraDailyCount(undefined,'voter','2026-11-25'),0);
 const counter={schemaVersion:1,actorId:'voter',day:'2026-11-25',count:100};
 assert.equal(readSemeaduraDailyCount(counter,'voter','2026-11-25'),100);
 for(const bad of [{count:101},{count:-1},{count:'1'},{count:0},{day:'2026-11-24'},{actorId:'other'},{schemaVersion:2}])assert.throws(()=>readSemeaduraDailyCount({...counter,...bad},'voter','2026-11-25'),/SEMEADURA_DAILY_COUNTER_INVALID/);
});

test('stale daily allowance responses cannot reopen exhausted cards or roll back server day',async()=>{
 const {mergeSemeaduraDailyAllowance}=await import('../shared/semeaduraDailyLimit.js');
 const day='2026-11-24',tomorrow='2026-11-25';
 const available={dailyDay:day,dailyRemaining:1};
 const exhausted={dailyDay:day,dailyRemaining:0};
 assert.deepEqual(mergeSemeaduraDailyAllowance(null,available),available);
 assert.deepEqual(mergeSemeaduraDailyAllowance(available,exhausted),exhausted);
 assert.deepEqual(mergeSemeaduraDailyAllowance(exhausted,available),exhausted);
 const renewed={dailyDay:tomorrow,dailyRemaining:100};
 assert.deepEqual(mergeSemeaduraDailyAllowance(exhausted,renewed),renewed);
 assert.deepEqual(mergeSemeaduraDailyAllowance(renewed,exhausted),renewed);
 assert.deepEqual(mergeSemeaduraDailyAllowance(renewed,{dailyDay:tomorrow,dailyRemaining:99}),{dailyDay:tomorrow,dailyRemaining:99});
});


test('bounded batch shares quota and community reads and returns no private metadata',async()=>{
 const db=new FakeDb();
 const targets=Array.from({length:10},(_,i)=>({kind:'community' as const,postId:'batch-'+i}));
 for(const target of targets)community(db,target.postId);
 join(db,'batch-viewer');
 const actor='batch-viewer';
 const before=JSON.stringify([...db.records]);
 const singles=await Promise.all(targets.map(t=>readVerifiedPostSemeadura(db.asFirestore(),{...t,authenticatedUserId:actor})));
 assert.equal(db.reads.length,60);
 db.reads.length=0;
 const batch=await readVerifiedPostSemeaduraBatch(db.asFirestore(),actor,targets);
 assert.deepEqual(batch.results.map(r=>r.status),singles);
 assert.equal(db.reads.length,33);
 assert.equal(JSON.stringify([...db.records]),before);
 db.records.set('communities/community-a',{ownerId:'owner-a',visibility:'private'});
 const blocked=await readVerifiedPostSemeaduraBatch(db.asFirestore(),'stranger',targets);
 assert.deepEqual(blocked.results,targets.map(t=>({...t,status:null})));
 await assert.rejects(readVerifiedPostSemeaduraBatch(db.asFirestore(),actor,[]),/SEMEADURA_INVALID_INPUT/);
 await assert.rejects(readVerifiedPostSemeaduraBatch(db.asFirestore(),actor,[targets[0],targets[0]]),/SEMEADURA_INVALID_INPUT/);
 await assert.rejects(readVerifiedPostSemeaduraBatch(db.asFirestore(),actor,[...targets,{kind:'personal',postId:'extra'}]),/SEMEADURA_INVALID_INPUT/);
});

test('status batch parser rejects injected identity, duplicate targets and oversized batches',async()=>{
 const {parseSemeaduraRequest}=await import('../server/gamification/semeaduraRequestAuthority.js');
 const target={kind:'personal',postId:'batch-a'};
 assert.deepEqual(parseSemeaduraRequest({action:'status_batch',targets:[target]}),{action:'status_batch',targets:[target]});
 for(const invalid of [
  {action:'status_batch',targets:[target],uid:'other'},
  {action:'status_batch',targets:[{...target,uid:'other'}]},
  {action:'status_batch',targets:[target,target]},
  {action:'status_batch',targets:[]},
  {action:'status_batch',targets:Array.from({length:11},(_,i)=>({...target,postId:'p'+i}))},
 ])assert.equal(parseSemeaduraRequest(invalid),null);
});
