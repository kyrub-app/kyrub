import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, deleteDoc } from 'firebase/firestore';
import {
  readPersonalSemeaduraJourney,
  readVerifiedPostSemeadura, readVerifiedPostSemeaduraBatch, seedVerifiedPost,
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

test('100th daily seed is atomic across personal and community posts; replay and next day do not reset receipts',async()=>{
 const {semeaduraDay}=await import('../shared/semeaduraDailyLimit.js');
 const day=semeaduraDay(new Date());
 const quota=db.doc('users/voter/semeaduraDailyUsage/'+day);
 await Promise.all([personal('quota-personal'),community('quota-community'),personal('quota-extra')]);
 // Boundary fixture only: previous 99 accepted sends in this test day.
 await quota.set({schemaVersion:1,actorId:'voter',day,count:99});
 const settled=await Promise.allSettled([semear('personal','quota-personal','voter'),semear('community','quota-community','voter')]);
 assert.equal(settled.filter(r=>r.status==='fulfilled').length,1);
 const rejected=settled.find(r=>r.status==='rejected');
 assert.match(String(rejected?.reason),/SEMEADURA_DAILY_LIMIT_REACHED/);
 assert.equal((await quota.get()).get('count'),100);
 const winner=settled[0].status==='fulfilled'?{kind:'personal' as const,postId:'quota-personal'}:{kind:'community' as const,postId:'quota-community'};
 assert.equal((await semear(winner.kind,winner.postId,'voter')).status,'already_seeded');
 const unavailable=await readVerifiedPostSemeadura(db,{kind:'personal',postId:'quota-extra',authenticatedUserId:'voter'});
 assert.equal(unavailable.canSemear,false);assert.equal(unavailable.dailyRemaining,0);assert.equal(unavailable.count,0);
 await assert.rejects(semear('personal','quota-extra','voter'),/SEMEADURA_DAILY_LIMIT_REACHED/);
 assert.equal((await quota.get()).get('count'),100);
 assert.equal((await semear('personal','quota-extra','another-voter')).status,'accepted');
 const total=(await readPersonalSemeaduraJourney(db,'author')).totalSeeds+(await readPersonalSemeaduraJourney(db,'member-author')).totalSeeds;
 assert.equal(total,2);
 const client=environment.authenticatedContext('voter').firestore();
 await assertFails(getDoc(doc(client,quota.path)));
 await assertFails(setDoc(doc(client,quota.path),{count:1},{merge:true}));
 await assertFails(deleteDoc(doc(client,quota.path)));
 // An unrelated previous-day document does not consume today's allowance.
 const yesterday=semeaduraDay(new Date(Date.now()-86400000));
 await db.doc('users/fresh-voter/semeaduraDailyUsage/'+yesterday).set({schemaVersion:1,actorId:'fresh-voter',day:yesterday,count:100});
 assert.equal((await semear('personal','quota-extra','fresh-voter')).status,'accepted');
 assert.equal((await db.doc('users/fresh-voter/semeaduraDailyUsage/'+day).get()).get('count'),1);
 assert.equal((await semear('personal','quota-extra','fresh-voter')).status,'already_seeded');
});


test('cutover preserves a pre-quota legacy receipt and community history without retroactive rewards',async()=>{
 const {semeaduraDay}=await import('../shared/semeaduraDailyLimit.js');
 const postId='legacy-cutover-post';
 await community(postId);
 await db.doc('community_members/rock__second-voter').set({communityId:'rock',userId:'second-voter',status:'active'});
 const key=createHash('sha256').update('community\0'+postId).digest('hex');
 const stats=db.doc('semeadura_post_stats/'+key);
 const receipt=stats.collection('receipts').doc('voter');
 const author=db.doc('users/member-author/semeaduraProgress/summary');
 const collective=db.doc('communities/rock/semeaduraProgress/summary');
 const oldTime=new Date(Date.now()-172800000).toISOString();
 const oldReceipt={kind:'community',postId,communityId:'rock',authorId:'member-author',actorId:'voter',occurredAt:oldTime};
 const oldCollective={communityId:'rock',acceptedSeeds:1,pitangueiras:0,bosques:0,createdAt:oldTime,updatedAt:oldTime};
 await Promise.all([
  stats.set({kind:'community',postId,communityId:'rock',authorId:'member-author',acceptedSeeds:1,closed:false,createdAt:oldTime,updatedAt:oldTime}),
  receipt.set(oldReceipt),
  author.set({authorId:'member-author',acceptedSeeds:1,pitangueiras:0,createdAt:oldTime,updatedAt:oldTime}),
  collective.set(oldCollective),
 ]);
 const day=semeaduraDay(new Date());
 const legacyQuota=db.doc('users/voter/semeaduraDailyUsage/'+day);
 assert.equal((await readVerifiedPostSemeadura(db,{kind:'community',postId,authenticatedUserId:'voter'})).seeded,true);
 assert.equal((await semear('community',postId,'voter')).status,'already_seeded');
 assert.equal((await legacyQuota.get()).exists,false);
 assert.deepEqual((await receipt.get()).data(),oldReceipt);
 assert.equal((await semear('community',postId,'second-voter')).count,2);
 assert.equal((await author.get()).get('acceptedSeeds'),2);
 assert.deepEqual((await collective.get()).data(),oldCollective);
 assert.equal((await stats.collection('receipts').doc('second-voter').get()).get('quotaDay'),day);
 assert.equal((await db.doc('users/second-voter/semeaduraDailyUsage/'+day).get()).get('count'),1);
 assert.equal((await db.collection('users/member-author/rewardLedger').get()).size,0);
 assert.equal((await db.collection('users/member-author/xpLedger').get()).size,0);
 assert.equal((await db.doc('users/member-author/pitangaBalance/balance').get()).exists,false);
});


test('instrumented emulator status batches preserve results and reduce document get calls',async()=>{
 // Delegate every read to the real Admin SDK and disposable Firestore emulator.
 // Expose no writer or transaction in the counting adapter: these paths are read-only.
 // Counts are logical SDK get calls, not a Cloud Billing measurement.
 const reads:string[]=[];
 const ref=(path:string):unknown=>({
  get:async()=>{reads.push(path);return db.doc(path).get();},
  collection:(name:string)=>({doc:(id:string)=>ref(path+'/'+name+'/'+id)}),
 });
 const countingDb={doc:ref,collection:(path:string)=>({doc:(id:string)=>ref(path+'/'+id)})} as unknown as Firestore;
 const actor='voter';
 const compare=async(targets:Array<{kind:'personal'|'community';postId:string}>,singleCount:number,batchCount:number)=>{
  reads.length=0;
  const individual=await Promise.all(targets.map(target=>readVerifiedPostSemeadura(countingDb,{...target,authenticatedUserId:actor})));
  assert.equal(reads.length,singleCount);
  reads.length=0;
  const batch=await readVerifiedPostSemeaduraBatch(countingDb,actor,targets);
  assert.deepEqual(batch.results.map(row=>row.status),individual);
  assert.equal(reads.length,batchCount);
  assert.equal(new Set(reads).size,batchCount);
  assert.equal(reads.filter(path=>path.startsWith('users/'+actor+'/semeaduraDailyUsage/')).length,1);
  console.info('[semeadura-read-budget]',targets[0].kind,singleCount,'->',batchCount);
  return batch;
 };
 const personals=Array.from({length:10},(_,i)=>({kind:'personal' as const,postId:'budget-personal-'+i}));
 const same=Array.from({length:10},(_,i)=>({kind:'community' as const,postId:'budget-same-'+i}));
 const distinct=Array.from({length:10},(_,i)=>({kind:'community' as const,postId:'budget-distinct-'+i}));
 await Promise.all(personals.map(t=>personal(t.postId)));
 await community(same[0].postId);
 await Promise.all(same.slice(1).map(t=>db.doc('community_posts/'+t.postId).set({postId:t.postId,authorId:'member-author',communityId:'rock'})));
 await Promise.all(distinct.map(async(t,i)=>{
  const group='budget-group-'+i;
  await Promise.all([
   db.doc('community_posts/'+t.postId).set({postId:t.postId,authorId:'member-author',communityId:group}),
   db.doc('communities/'+group).set({communityId:group,ownerId:'community-owner',visibility:'public'}),
   db.doc('community_members/'+group+'__'+actor).set({communityId:group,userId:actor,status:'active'}),
  ]);
 }));
 await semear('personal',personals[0].postId,actor);
 await semear('community',same[0].postId,actor);
 const before=await readPersonalSemeaduraJourney(db,'member-author');
 const personalResult=await compare(personals,40,31);
 assert.equal(personalResult.results[0].status?.seeded,true);
 assert.equal(personalResult.results[1].status?.dailyRemaining,98);
 const sameResult=await compare(same,60,33);
 assert.equal(sameResult.results[0].status?.seeded,true);
 await compare(distinct,60,51);
 await db.doc('communities/rock').update({visibility:'private'});
 const forbidden=await readVerifiedPostSemeaduraBatch(countingDb,'outsider',[same[0],personals[1]]);
 assert.equal(forbidden.results[0].status,null);
 assert.equal(forbidden.results[1].status?.canSemear,true);
 await db.doc('community_members/rock__voter').update({status:'inactive'});
 const revoked=await readVerifiedPostSemeaduraBatch(countingDb,actor,same);
 assert.ok(revoked.results.every(row=>row.status===null));
 assert.deepEqual(await readPersonalSemeaduraJourney(db,'member-author'),before);
 assert.equal((await db.collection('users/member-author/rewardLedger').get()).size,0);
 assert.equal((await db.collection('users/author/rewardLedger').get()).size,0);
});

test('personal identifier indices and profile challenge rewards reject direct client mutation',async()=>{
 const uid='profile-owner',challenge='profile_identity_completed',identifier='perfil-reservado';
 const forward='public_social_addresses/profile:'+identifier,reverse='public_social_address_targets/profile:'+uid;
 const receipt='users/'+uid+'/challengeRewards/'+challenge,award='users/'+uid+'/rewardLedger/earn_'+challenge;
 const record={kind:'profile',identifier,targetId:uid};
 await Promise.all([db.doc(forward).set(record),db.doc(reverse).set(record)]);
 for(const actor of [uid,'outsider']){
  const client=environment.authenticatedContext(actor).firestore();
  for(const path of [forward,reverse]){
   await assertFails(getDoc(doc(client,path)));
   await assertFails(setDoc(doc(client,path),{...record,targetId:actor}));
   await assertFails(deleteDoc(doc(client,path)));
  }
  await assertFails(setDoc(doc(client,receipt),{userId:uid,challengeId:challenge,pitangas:100,xp:0}));
  await assertFails(setDoc(doc(client,award),{userId:uid,deltaKCoins:100}));
  await assertFails(setDoc(doc(client,'users/'+uid+'/pitangaBalance/balance'),{userId:uid,availableKCoins:100}));
 }
 assert.deepEqual((await db.doc(forward).get()).data(),record);
 assert.deepEqual((await db.doc(reverse).get()).data(),record);
 assert.equal((await db.doc(receipt).get()).exists,false);
 assert.equal((await db.doc(award).get()).exists,false);
});

test('reserved personal presentation is private to owner; public discovery requires explicit visibility',async()=>{
 const owner='profile-privacy-owner',path='users/'+owner+'/public_profile/main';
 await db.doc('users/'+owner).set({uid:owner,name:'Perfil reservado',isProfileVisible:false});
 await db.doc(path).set({userId:owner,name:'Perfil reservado',bio:'Apresentação privada',photoUrl:''});
 const own=environment.authenticatedContext(owner).firestore();
 const other=environment.authenticatedContext('profile-privacy-other').firestore();
 const guest=environment.unauthenticatedContext().firestore();
 await assertSucceeds(getDoc(doc(own,path)));
 await assertFails(getDoc(doc(other,path)));
 await assertFails(getDoc(doc(guest,path)));
 await db.doc('users/'+owner).update({isProfileVisible:true});
 await assertSucceeds(getDoc(doc(other,path)));
 await assertFails(getDoc(doc(guest,path)));
 await db.doc('users/'+owner).update({isProfileVisible:false});
 await assertFails(getDoc(doc(other,path)));
 await assertSucceeds(getDoc(doc(own,path)));
 await db.doc('users/'+owner).set({uid:owner,name:'Perfil sem preferência'});
 await assertFails(getDoc(doc(other,path)));
 await assertSucceeds(getDoc(doc(own,path)));
 await db.doc('users/'+owner).delete();
 await assertFails(getDoc(doc(other,path)));
});
