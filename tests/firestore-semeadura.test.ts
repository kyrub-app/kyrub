import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { initializeTestEnvironment, assertFails, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, deleteDoc } from 'firebase/firestore';
import {
  readPersonalSemeaduraJourney,
  readVerifiedPostSemeadura, seedVerifiedPost,
} from '../server/gamification/semeaduraService';

const projectId = 'kyrub-security-test';
let app: App;
let db: Firestore;
let environment: RulesTestEnvironment;
before(async () => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST, 'An emulator is mandatory for this suite');
  app = initializeApp({ projectId }, 'semeadura-security-test');
  db = getFirestore(app);
  environment = await initializeTestEnvironment({
    projectId,
    firestore: {
      rules: readFileSync('.firebase/firestore.combined.rules', 'utf8'),
      host: '127.0.0.1', port: 8088,
    },
  });
});
beforeEach(async () => environment.clearFirestore());
after(async () => {
  await environment.cleanup();
  await deleteApp(app);
});

const personal = async (postId: string) =>
  db.doc('social_posts/' + postId).set({
    postId, authorId: 'author', visibility: 'public', publicationType: 'feed',
  });
const community = async (postId: string) => {
  await Promise.all([
    db.doc('community_posts/' + postId).set({ postId, authorId: 'member-author', communityId: 'rock' }),
    db.doc('communities/rock').set({ communityId: 'rock', ownerId: 'community-owner', visibility: 'public' }),
    db.doc('community_members/rock__voter').set({
      communityId: 'rock', userId: 'voter', status: 'active',
    }),
  ]);
};
const semear = (kind: 'personal'|'community', postId: string, actor: string) =>
  seedVerifiedPost(db, { kind, postId, authenticatedUserId: actor });

test('Firestore rules forbid clients to read or forge authoritative seed counters or receipts', async () => {
  const client = environment.authenticatedContext('attacker').firestore();
  await assertFails(setDoc(doc(client, 'semeadura_post_stats/forged'), { acceptedSeeds: 100_000 }));
  await assertFails(getDoc(doc(client, 'semeadura_post_stats/forged')));
  await assertFails(setDoc(doc(client, 'users/author/semeaduraProgress/summary'), { acceptedSeeds: 100_000 }));
  await assertFails(getDoc(doc(client, 'users/author/semeaduraProgress/summary')));
});

test('real Firestore transactions record one seed per actor, count only author progress, and never pay', async () => {
  await personal('a-post');
  assert.equal((await semear('personal','a-post','voter')).count,1);
  assert.equal((await semear('personal','a-post','voter')).status,'already_seeded');
  assert.equal((await semear('personal','a-post','other')).count,2);
  assert.equal((await readPersonalSemeaduraJourney(db,'author')).totalSeeds,2);
  assert.equal((await readPersonalSemeaduraJourney(db,'voter')).totalSeeds,0);
  assert.equal((await readVerifiedPostSemeadura(db,{ kind:'personal',postId:'a-post',authenticatedUserId:'voter' })).seeded,true);
  assert.equal((await db.collection('users/author/rewardLedger').get()).size,0);
  assert.equal((await db.collection('users/author/xpLedger').get()).size,0);
  await assert.rejects(semear('personal','a-post','author'),/SEMEADURA_SELF_RECOGNITION_DENIED/);
});

test('one author can accumulate concurrent seeds from personal and community posts without duplicate credit', async () => {
  await Promise.all([personal('personal-cumulative'), community('community-cumulative')]);
  await db.doc('community_posts/community-cumulative').update({ authorId: 'author' });
  const results = await Promise.all([
    semear('personal', 'personal-cumulative', 'voter'),
    semear('community', 'community-cumulative', 'voter'),
  ]);
  assert.deepEqual(results.map(result => result.status), ['accepted', 'accepted']);
  assert.equal((await readPersonalSemeaduraJourney(db, 'author')).totalSeeds, 2);
  assert.equal((await db.doc('communities/rock/semeaduraProgress/summary').get()).exists,false);
  assert.equal((await db.collection('users/author/rewardLedger').get()).size, 0);
  assert.equal((await db.collection('users/author/xpLedger').get()).size, 0);
});

test('the two concurrent final seeds yield exactly ONE winner, then close the post forever', async () => {
  await personal('cap-post');
  const key = createHash('sha256').update('personal\0cap-post').digest('hex');
  const now = new Date().toISOString();
  await Promise.all([
    db.doc('semeadura_post_stats/'+key).set({
      postId:'cap-post',kind:'personal',communityId:'',authorId:'author',
      acceptedSeeds:99_999,closed:false,createdAt:now,updatedAt:now,
    }),
    db.doc('users/author/semeaduraProgress/summary').set({
      authorId:'author',acceptedSeeds:99_999,pitangueiras:99,
      createdAt:now,updatedAt:now,
    }),
  ]);
  const results = await Promise.all([
    semear('personal','cap-post','penultimate'),
    semear('personal','cap-post','final'),
  ]);
  assert.deepEqual(results.map(x=>x.status).sort(), ['accepted','closed']);
  assert.deepEqual(results.map(x=>x.count).sort(), [100_000,100_000]);
  const closed = await db.doc('semeadura_post_stats/'+key).get();
  assert.equal(closed.get('acceptedSeeds'),100_000);
  assert.equal(closed.get('closed'),true);
  assert.equal((await readPersonalSemeaduraJourney(db,'author')).pitangueiras,100);
  assert.equal((await semear('personal','cap-post','much-later')).status,'closed');
  assert.equal((await db.collection('semeadura_post_stats/'+key+'/receipts').get()).size,1);
});

test('community seeds count toward the AUTHOR only, not owner or community', async () => {
  await community('rock-post');
  assert.equal((await semear('community','rock-post','voter')).status,'accepted');
  assert.equal((await readPersonalSemeaduraJourney(db,'member-author')).totalSeeds,1);
  assert.equal((await readPersonalSemeaduraJourney(db,'community-owner')).totalSeeds,0);
  assert.equal((await db.doc('communities/rock/semeaduraProgress/summary').get()).exists,false);
  await assert.rejects(semear('community','rock-post','outsider'), /SEMEADURA_COMMUNITY_ACCESS_DENIED/);
});

test('seed receipts are irrevocable even by their actor; old community progress stays untouched',async()=>{
 await community('permanent-post');
 const old=db.doc('communities/rock/semeaduraProgress/summary');
 const historical={communityId:'rock',acceptedSeeds:77,bosques:0};
 await old.set(historical);
 const key=createHash('sha256').update('community\0permanent-post').digest('hex');
 const receiptPath='semeadura_post_stats/'+key+'/receipts/voter';
 await semear('community','permanent-post','voter');
 const actor=environment.authenticatedContext('voter').firestore();
 await assertFails(deleteDoc(doc(actor,receiptPath)));
 await assertFails(setDoc(doc(actor,receiptPath),{actorId:'voter'}));
 await assertFails(setDoc(doc(actor,'communities/rock/semeaduraProgress/summary'),{acceptedSeeds:100000}));
 assert.equal((await semear('community','permanent-post','voter')).status,'already_seeded');
 assert.equal((await db.doc(receiptPath).get()).exists,true);
 assert.equal((await readPersonalSemeaduraJourney(db,'member-author')).totalSeeds,1);
 assert.deepEqual((await old.get()).data(),historical);
});

test('economic review controls cannot be created, inspected, cleared or removed by clients',async()=>{
 const path='systemControl/semeaduraEconomicReview/holds/author_author';
 const hold={schemaVersion:1,scope:'author',target:'author',status:'held',caseId:'test-case',reviewedBy:'fixture',updatedAt:new Date().toISOString()};
 await db.doc(path).set(hold);
 for(const uid of ['author','voter','attacker']){
  const client=environment.authenticatedContext(uid).firestore();
  await assertFails(getDoc(doc(client,path)));
  await assertFails(setDoc(doc(client,path),{status:'cleared'},{merge:true}));
  await assertFails(deleteDoc(doc(client,path)));
  await assertFails(setDoc(doc(client,'systemControl/semeaduraEconomicReview/holds/actor_'+uid),{status:'held'}));
 }
 assert.deepEqual((await db.doc(path).get()).data(),hold);
});
