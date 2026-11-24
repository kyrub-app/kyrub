import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { handleWelcomeAuthCreated } from '../server/gamification/welcomeAuthCreatedHandler.js';

// Fail before initializing any SDK unless all backends are explicitly isolated.
const projectId = 'demo-kyrub-welcome';
assert.equal(process.env.GCLOUD_PROJECT, projectId);
assert.equal(process.env.GOOGLE_CLOUD_PROJECT, projectId);
assert.equal(process.env.KYRUB_PITANGA_WELCOME_PROJECT_ID, projectId);
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:9099');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8088');
assert.notEqual(process.env.NODE_ENV, 'production');
const app = initializeApp({ projectId }, 'welcome-auth-e2e');
const auth = getAuth(app);
const db = getFirestore(app);
const epoch = 'welcome-emulator-only';
const base = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';
const ledger = (uid: string) => db.collection(`users/${uid}/rewardLedger`);
const balance = (uid: string) => db.doc(`users/${uid}/pitangaBalance/balance`);

async function googleSignIn(subject: string) {
  // Auth Emulator supports unsigned federated credentials; never send these to Google.
  const claims = { sub: subject, email: `${subject}@example.invalid`, email_verified: true, name: 'Fictitious user' };
  const credential = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.`;
  const response = await fetch(`${base}/accounts:signInWithIdp?key=fake-emulator-key`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ requestUri: 'http://localhost', postBody: new URLSearchParams({ id_token: credential, providerId: 'google.com' }).toString(), returnSecureToken: true }),
  });
  assert.equal(response.status, 200, 'emulated Google sign-in must succeed');
  const result = await response.json() as { localId: string; idToken: string; isNewUser: boolean };
  assert.equal((await auth.verifyIdToken(result.idToken)).uid, result.localId);
  return result;
}

async function waitForAward(uid: string) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if ((await balance(uid).get()).exists) return;
    await delay(100);
  }
  assert.fail('registered Auth trigger did not grant welcome credit within 60 seconds');
}

before(async () => {
  await db.doc('systemControl/pitangaLegacyWriterFence').set({ status: 'fenced', writersVerified: true, epoch });
});
after(async () => { await deleteApp(app); });

test('real Auth creation event automatically grants 100; later login keeps one award', async () => {
  const first = await googleSignIn('welcome-real-creation');
  assert.equal(first.isNewUser, true);
  await waitForAward(first.localId);
  assert.equal((await balance(first.localId).get()).get('availableKCoins'), 100);
  const again = await googleSignIn('welcome-real-creation');
  assert.equal(again.localId, first.localId);
  assert.notEqual(again.isNewUser, true);
  assert.equal((await balance(first.localId).get()).get('availableKCoins'), 100);
  assert.equal((await ledger(first.localId).get()).size, 1);
  assert.equal((await db.doc(`users/${first.localId}/authEvents/first_login_v1`).get()).get('issuer'), 'trusted_auth_server');
});

test('concurrent redelivery of the same trusted event creates exactly one credit', async () => {
  const signed = await googleSignIn('welcome-concurrent');
  await waitForAward(signed.localId);
  const receipt = await db.doc(`users/${signed.localId}/authEvents/first_login_v1`).get();
  const current = await auth.getUser(signed.localId);
  const user = { ...current, metadata: { creationTime: receipt.get('firebaseCreatedAt') } };
  await balance(user.uid).delete();
  await ledger(user.uid).doc('earn_first_login_welcome_v1').delete();
  const results = await Promise.all(Array.from({ length: 8 }, () => handleWelcomeAuthCreated(db, auth, user, {
    eventId: receipt.get('sourceEventId'), projectId,
  })));
  assert.equal(results.filter(result => 'replay' in result && !result.replay).length, 1);
  assert.equal(results.filter(result => 'replay' in result && result.replay).length, 7);
  assert.equal((await balance(user.uid).get()).get('availableKCoins'), 100);
  assert.equal((await ledger(user.uid).get()).size, 1);
});

test('old registration is ineligible and writes no receipt or credit', async () => {
  const uid = 'old-registration';
  const user = { uid, disabled: false, providerData: [{ providerId: 'google.com' }], metadata: { creationTime: '2000-01-01T00:00:00.000Z' } };
  assert.deepEqual(await handleWelcomeAuthCreated(db, auth, user as never, { eventId: 'old-auth-event-123', projectId }), { skipped: true });
  assert.equal((await balance(uid).get()).exists, false);
  assert.equal((await db.doc(`users/${uid}/authEvents/first_login_v1`).get()).exists, false);
  const imported = await auth.importUsers([{
    uid, email: 'old-existing-google@example.invalid',
    metadata: { creationTime: 'Sat, 01 Jan 2000 00:00:00 GMT' },
    providerData: [{ providerId: 'google.com', uid: 'old-existing-google', email: 'old-existing-google@example.invalid' }],
  }]);
  assert.equal(imported.successCount, 1);
  const signed = await googleSignIn('old-existing-google');
  assert.equal(signed.localId, uid);
  assert.notEqual(signed.isNewUser, true);
  assert.equal((await balance(uid).get()).exists, false);
  assert.equal((await ledger(uid).get()).size, 0);
});

test('existing balance is preserved on trusted event retry', async () => {
  const signed = await googleSignIn('welcome-existing-balance');
  await waitForAward(signed.localId);
  const receiptRef = db.doc(`users/${signed.localId}/authEvents/first_login_v1`);
  const receipt = await receiptRef.get();
  // Isolated fixture represents pre-existing economy state before a delivery.
  await ledger(signed.localId).doc('earn_first_login_welcome_v1').delete();
  await balance(signed.localId).set({ userId: signed.localId, availableKCoins: 730 });
  const current = await auth.getUser(signed.localId);
  const user = { ...current, metadata: { creationTime: receipt.get('firebaseCreatedAt') } };
  assert.deepEqual(await handleWelcomeAuthCreated(db, auth, user, {
    eventId: receipt.get('sourceEventId'), projectId,
  }), { skipped: true });
  assert.equal((await balance(signed.localId).get()).get('availableKCoins'), 730);
  assert.equal((await ledger(signed.localId).get()).size, 0);
});

test('failed authentication and non-Google creation never grant credit', async () => {
  const failed = await fetch(`${base}/accounts:signInWithPassword?key=fake-emulator-key`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'missing@example.invalid', password: 'wrong-password', returnSecureToken: true }),
  });
  assert.equal(failed.status, 400);
  const user = await auth.createUser({ uid: 'password-only', email: 'password-only@example.invalid', password: 'fake-password-1234' });
  assert.deepEqual(await handleWelcomeAuthCreated(db, auth, user, { eventId: 'non-google-auth-event', projectId }), { skipped: true });
  assert.equal((await balance(user.uid).get()).exists, false);
  assert.equal((await ledger(user.uid).get()).size, 0);
});

test('wrong project and absent verified fence fail closed without credit', async () => {
  const signed = await googleSignIn('welcome-fence-failure');
  await waitForAward(signed.localId);
  const current = await auth.getUser(signed.localId);
  const receipt = await db.doc(`users/${current.uid}/authEvents/first_login_v1`).get();
  const user = { ...current, metadata: { creationTime: receipt.get('firebaseCreatedAt') } };
  const eventId = receipt.get('sourceEventId');
  await assert.rejects(handleWelcomeAuthCreated(db, auth, user, { eventId, projectId: 'other-project' }), /PROJECT_MISMATCH/);
  await db.doc('systemControl/pitangaLegacyWriterFence').set({ status: 'fenced', writersVerified: false, epoch });
  try {
    await assert.rejects(handleWelcomeAuthCreated(db, auth, user, { eventId, projectId }), /WELCOME_LEGACY_WRITERS_NOT_VERIFIED/);
  } finally {
    await db.doc('systemControl/pitangaLegacyWriterFence').set({ status: 'fenced', writersVerified: true, epoch });
  }
  assert.equal((await balance(user.uid).get()).get('availableKCoins'), 100);
  assert.equal((await ledger(user.uid).get()).size, 1);
});

test('one Auth-created member: welcome and verified first publication remain separate; insufficient conversion never mutates either economy', async () => {
  assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST,'127.0.0.1:9099');
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8088');
  assert.equal(projectId,'demo-kyrub-welcome');
  const { readPitangaAccount, convertPitangaAccount } = await import('../server/gamification/pitangaAccountService.js');
  const { publishFirstStoreAndAwardXp, hideVerifiedFirstStorePublication } = await import('../server/gamification/firstStorePublicationAuthority.js');
  const { readUserPlatformChallengeCatalog } = await import('../server/gamification/userPlatformChallengeCatalogService.js');
  const signed = await googleSignIn('welcome-publication-integrated');
  assert.equal(signed.isNewUser,true);
  const uid=signed.localId;
  await waitForAward(uid);
  const first=await readPitangaAccount(db,uid);
  assert.equal(first.pitangas,100);
  assert.equal(first.xp,0);
  assert.equal(first.entries.length,1);
  const storeId='fixture-integrated-first-store';
  const store=db.doc(`stores/${storeId}`);
  const event=db.doc(`users/${uid}/verifiedStoreEvents/first_store_published`);
  const listing=db.doc(`marketplace_listings/s_${uid.length}_${uid}`);
  const challenge=db.doc('global_challenges/first_store_published');
  const grant=()=>publishFirstStoreAndAwardXp(db,{authenticatedUserId:uid,canonicalStoreId:storeId});
  // Fixture represents a provisioned, unpublished store; actual production
  // authority performs the publication, evidence and reward transaction.
  await challenge.set({id:'first_store_published',title:'Primeira publicação',description:'Fixture',status:'published',validationMode:'deterministic',sponsorType:'kyrub',rewardKCoins:0,rewardXp:2,maxCompletionsPerUser:1});
  await store.set({id:storeId,ownerId:uid,publicationStatus:'paused',firstStoreCreationVerified:true,plan:'free'});
  await db.doc(`users/${uid}/stores/${uid}`).set({id:uid,ownerId:uid,name:'Loja fictícia',slug:'loja-integrada',plan:'free'});
  assert.deepEqual(await readPitangaAccount(db,uid),first);
  assert.equal((await event.get()).exists,false);
  assert.equal((await listing.get()).exists,false);
  const initialCatalog=await readUserPlatformChallengeCatalog(db,uid);
  assert.equal(initialCatalog.challenges.find(c=>c.id==='first_store_published')?.status,'available');
  const awards=await Promise.all(Array.from({length:4},grant));
  assert.equal(awards.filter(r=>!r.replay).length,1);
  assert.equal(awards.filter(r=>r.replay).length,3);
  const afterPublication=await readPitangaAccount(db,uid);
  assert.equal(afterPublication.pitangas,100);
  assert.equal(afterPublication.xp,2);
  assert.equal(afterPublication.entries.length,2);
  assert.equal((await db.collection(`users/${uid}/challengeRewards`).get()).size,1);
  const firstAt=(await store.get()).get('firstPublishedAt');
  assert.equal((await event.get()).get('publishedAt'),firstAt);
  assert.equal((await listing.get()).get('publicationStatus'),'published');
  assert.equal((await listing.get()).get('publishedAt').toDate().toISOString(),firstAt);
  const completedCatalog=await readUserPlatformChallengeCatalog(db,uid);
  assert.equal(completedCatalog.challenges.find(c=>c.id==='first_store_published')?.status,'completed');
  await hideVerifiedFirstStorePublication(db,{authenticatedUserId:uid,canonicalStoreId:storeId});
  assert.equal((await listing.get()).get('publicationStatus'),'paused');
  assert.deepEqual(await grant(),{replay:true,pitangas:0,xp:2});
  assert.equal((await store.get()).get('firstPublishedAt'),firstAt);
  assert.deepEqual(await readPitangaAccount(db,uid),afterPublication);
  const previousFlag=process.env.KYRUB_PITANGA_XP_CONVERSION_ENABLED;
  try {
    process.env.KYRUB_PITANGA_XP_CONVERSION_ENABLED='true';
    await assert.rejects(convertPitangaAccount(db,uid,{requestId:'integrated-insufficient',requestedXp:1}),/PITANGA_BALANCE_INSUFFICIENT/);
    assert.equal((await db.collection(`users/${uid}/pitangaXpConversions`).get()).size,0);
    assert.deepEqual(await readPitangaAccount(db,uid),afterPublication);
    await db.doc('systemControl/pitangaLegacyWriterFence').set({status:'fenced',writersVerified:false,epoch});
    await assert.rejects(convertPitangaAccount(db,uid,{requestId:'integrated-unverified-fence',requestedXp:1}),/PITANGA_CONVERSION_WRITERS_UNVERIFIED/);
    assert.deepEqual(await readPitangaAccount(db,uid),afterPublication);
  } finally {
    if(previousFlag===undefined)delete process.env.KYRUB_PITANGA_XP_CONVERSION_ENABLED;
    else process.env.KYRUB_PITANGA_XP_CONVERSION_ENABLED=previousFlag;
    await db.doc('systemControl/pitangaLegacyWriterFence').set({status:'fenced',writersVerified:true,epoch});
  }
  const again=await googleSignIn('welcome-publication-integrated');
  assert.equal(again.localId,uid);
  // Auth Emulator may omit isNewUser for an existing federated account.
  assert.notEqual(again.isNewUser,true);
  assert.deepEqual(await readPitangaAccount(db,uid),afterPublication);
});


test('isolated semeadura economic pilot credits only the author at a unique milestone',async()=>{
 const {createHash}=await import('node:crypto');
 const {seedVerifiedPost}=await import('../server/gamification/semeaduraService.js');
 const {readPitangaAccount}=await import('../server/gamification/pitangaAccountService.js');
 const {semeaduraEconomicPilotEnabled}=await import('../server/gamification/semeaduraEconomicPilot.js');
 const signed=await googleSignIn('semeadura-economic-author');
 const uid=signed.localId;
 await waitForAward(uid);
 const root=db.collection('users').doc(uid);
 const postId='isolated-economic-milestone';
 const key=createHash('sha256').update('personal\0'+postId).digest('hex');
 const now=new Date().toISOString();
 await db.doc('social_posts/'+postId).set({postId,authorId:uid,visibility:'public',publicationType:'feed'});
 const pilot=root.collection('semeaduraEconomicPilot').doc('activation');
 const progress=root.collection('semeaduraProgress').doc('summary');
 const stats=db.doc('semeadura_post_stats/'+key);
 const before=await readPitangaAccount(db,uid);
 assert.equal(before.pitangas,100);assert.equal(before.xp,0);
 const prior=process.env.KYRUB_SEMEADURA_ECONOMIC_PILOT;
 const seed=(actor:string)=>seedVerifiedPost(db,{authenticatedUserId:actor,kind:'personal',postId});
 try{
  process.env.KYRUB_SEMEADURA_ECONOMIC_PILOT='true';
  assert.equal(semeaduraEconomicPilotEnabled(db),true);
  assert.equal(semeaduraEconomicPilotEnabled(db,{...process.env,VERCEL:'1'}),false);
  assert.equal(semeaduraEconomicPilotEnabled(db,{...process.env,FIRESTORE_EMULATOR_HOST:'firestore.googleapis.com:443'}),false);
  await pilot.set({schemaVersion:1,authorId:uid,epoch,acceptedSeeds:0,creditedPitangas:0});
  await seed('first-voter');
  assert.equal((await pilot.get()).get('acceptedSeeds'),1);
  assert.deepEqual(await readPitangaAccount(db,uid),before);
  // Controlled boundary fixture: 998 prior eligible seeds, not real user
  // activity. No fabricated currency credit, no production account.
  await Promise.all([
   pilot.update({acceptedSeeds:999}),
   progress.update({acceptedSeeds:999,pitangueiras:0}),
   stats.update({acceptedSeeds:999,updatedAt:now})
  ]);
  await db.doc('systemControl/pitangaLegacyWriterFence').update({writersVerified:false});
  await assert.rejects(seed('blocked-voter'),/SEMEADURA_ECONOMIC_WRITERS_UNVERIFIED/);
  assert.equal((await stats.get()).get('acceptedSeeds'),999);
  assert.deepEqual(await readPitangaAccount(db,uid),before);
  await db.doc('systemControl/pitangaLegacyWriterFence').update({writersVerified:true});
  // A server-side review must stop settlement before the accepted-seed
  // transaction writes any receipt, projection, cursor or balance.
  // These are explicit emulator fixtures, not real moderation decisions.
  for(const [scope,target] of [['author',uid],['actor','threshold-voter'],['post',key]]){
   const hold=db.doc('systemControl/semeaduraEconomicReview/holds/'+scope+'_'+target);
   const evidence={schemaVersion:1,scope,target,caseId:'isolated-review',reviewedBy:'fixture-reviewer',updatedAt:now};
   await hold.set({...evidence,status:'held'});
   await assert.rejects(seed('threshold-voter'),/SEMEADURA_ECONOMIC_REVIEW_HELD/);
   assert.equal((await stats.get()).get('acceptedSeeds'),999);
   assert.equal((await pilot.get()).get('acceptedSeeds'),999);
   assert.equal((await stats.collection('receipts').doc('threshold-voter').get()).exists,false);
   assert.deepEqual(await readPitangaAccount(db,uid),before);
   await hold.update({status:'unknown'});
   await assert.rejects(seed('threshold-voter'),/SEMEADURA_ECONOMIC_REVIEW_INVALID/);
   await hold.set({...evidence,status:'cleared'});
  }
  const outcomes=await Promise.all([seed('threshold-voter'),seed('threshold-voter'),seed('next-voter')]);
  assert.equal(outcomes.filter(r=>r.status==='accepted').length,2);
  assert.equal(outcomes.filter(r=>r.status==='already_seeded').length,1);
  const after=await readPitangaAccount(db,uid);
  assert.equal(after.pitangas,101);assert.equal(after.xp,0);
  assert.equal((await pilot.get()).get('creditedPitangas'),1);
  assert.equal((await pilot.get()).get('acceptedSeeds'),1001);
  assert.equal((await root.collection('rewardLedger').doc('earn_semeadura_1').get()).get('sourceType'),'semeadura');
  assert.equal((await readPitangaAccount(db,'threshold-voter')).pitangas,0);
  await assert.rejects(seed(uid),/SEMEADURA_SELF_RECOGNITION_DENIED/);
  assert.deepEqual(await readPitangaAccount(db,uid),after);
  // Placing a hold after settlement must not erase existing receipts or
  // alter the historical credit. Replay remains read-only/idempotent.
  const postHold=db.doc('systemControl/semeaduraEconomicReview/holds/post_'+key);
  await postHold.update({status:'held'});
  assert.equal((await seed('threshold-voter')).status,'already_seeded');
  await assert.rejects(seed('new-held-voter'),/SEMEADURA_ECONOMIC_REVIEW_HELD/);
  assert.deepEqual(await readPitangaAccount(db,uid),after);
  assert.equal((await stats.get()).get('acceptedSeeds'),1001);
  await postHold.update({status:'cleared'});
  delete process.env.KYRUB_SEMEADURA_ECONOMIC_PILOT;
  await seed('visual-only-voter');
  assert.deepEqual(await readPitangaAccount(db,uid),after);
  process.env.KYRUB_SEMEADURA_ECONOMIC_PILOT='true';
  await assert.rejects(seed('after-disabled-gap'),/SEMEADURA_ECONOMIC_CURSOR_CONFLICT/);
  assert.deepEqual(await readPitangaAccount(db,uid),after);
 }finally{
  if(prior===undefined)delete process.env.KYRUB_SEMEADURA_ECONOMIC_PILOT;else process.env.KYRUB_SEMEADURA_ECONOMIC_PILOT=prior;
  await db.doc('systemControl/pitangaLegacyWriterFence').update({writersVerified:true});
 }
});


test('isolated economic review is authorized, audited, revisioned and replay safe',async()=>{
 const {recordIsolatedSemeaduraReview}=await import('../server/gamification/semeaduraEconomicReview.js');
 const {seedVerifiedPost}=await import('../server/gamification/semeaduraService.js');
 const {createHash}=await import('node:crypto');
 const signed=await googleSignIn('audited-review-author');
 const author=signed.localId;
 await waitForAward(author);
 const root='systemControl/semeaduraEconomicReview';
 const reviewer='audited-fixture-reviewer';
 const reviewerRef=db.doc(root+'/reviewers/'+reviewer);
 const hold=db.doc(root+'/holds/author_'+author);
 const postId='audited-review-post';
 const postKey=createHash('sha256').update('personal\0'+postId).digest('hex');
 const seed=()=>seedVerifiedPost(db,{authenticatedUserId:'audited-voter',kind:'personal',postId});
 const cmd={scope:'author' as const,target:author,caseId:'case-audit-1',eventId:'audit-hold-1',status:'held' as const,expectedRevision:0};
 const prior=process.env.KYRUB_SEMEADURA_ECONOMIC_PILOT;
 try{
  delete process.env.KYRUB_SEMEADURA_ECONOMIC_PILOT;
  await assert.rejects(recordIsolatedSemeaduraReview(db,reviewer,cmd),/SEMEADURA_REVIEW_PILOT_DISABLED/);
  process.env.KYRUB_SEMEADURA_ECONOMIC_PILOT='true';
  await assert.rejects(recordIsolatedSemeaduraReview(db,reviewer,cmd),/SEMEADURA_REVIEW_NOT_AUTHORIZED/);
  await reviewerRef.set({schemaVersion:1,reviewerId:reviewer,active:true,fixtureOnly:true});
  await db.doc('social_posts/'+postId).set({postId,authorId:author,visibility:'public',publicationType:'feed'});
  await db.doc('users/'+author+'/semeaduraEconomicPilot/activation').set({schemaVersion:1,authorId:author,epoch,acceptedSeeds:0,creditedPitangas:0});
  await assert.rejects(recordIsolatedSemeaduraReview(db,reviewer,{...cmd,status:'cleared'}),/SEMEADURA_REVIEW_TRANSITION_INVALID/);
  const competing=await Promise.allSettled([
   recordIsolatedSemeaduraReview(db,reviewer,cmd),
   recordIsolatedSemeaduraReview(db,reviewer,{...cmd,eventId:'audit-competitor'})
  ]);
  assert.equal(competing.filter(v=>v.status==='fulfilled').length,1);
  assert.equal(competing.filter(v=>v.status==='rejected').length,1);
  const active=(await hold.get()).data()!;
  const actual={...cmd,eventId:active.eventId};
  assert.deepEqual(await recordIsolatedSemeaduraReview(db,reviewer,actual),{revision:1,replayed:true});
  await assert.rejects(recordIsolatedSemeaduraReview(db,reviewer,{...actual,caseId:'other-case'}),/SEMEADURA_REVIEW_EVENT_CONFLICT/);
  await assert.rejects(seed(),/SEMEADURA_ECONOMIC_REVIEW_HELD/);
  assert.equal((await db.doc('semeadura_post_stats/'+postKey+'/receipts/audited-voter').get()).exists,false);
  assert.equal((await balance(author).get()).get('availableKCoins'),100);
  const release={...cmd,eventId:'audit-clear-1',status:'cleared' as const,expectedRevision:1};
  await assert.rejects(recordIsolatedSemeaduraReview(db,reviewer,{...release,caseId:'other-case'}),/SEMEADURA_REVIEW_TRANSITION_INVALID/);
  assert.deepEqual(await recordIsolatedSemeaduraReview(db,reviewer,release),{revision:2,replayed:false});
  assert.equal((await hold.get()).get('status'),'cleared');
  assert.equal((await db.doc(root+'/events/'+active.eventId).get()).get('status'),'held');
  assert.equal((await db.doc(root+'/events/audit-clear-1').get()).get('revision'),2);
  assert.deepEqual(await recordIsolatedSemeaduraReview(db,reviewer,actual),{revision:1,replayed:true});
  assert.equal((await hold.get()).get('revision'),2);
  await hold.update({caseId:'tampered-case'});
  await assert.rejects(seed(),/SEMEADURA_ECONOMIC_REVIEW_INVALID/);
  assert.equal((await db.doc('semeadura_post_stats/'+postKey+'/receipts/audited-voter').get()).exists,false);
  await hold.update({caseId:cmd.caseId});
  assert.equal((await seed()).status,'accepted');
  assert.equal((await balance(author).get()).get('availableKCoins'),100);
  await reviewerRef.update({active:false});
  await assert.rejects(recordIsolatedSemeaduraReview(db,reviewer,actual),/SEMEADURA_REVIEW_NOT_AUTHORIZED/);
 }finally{
  if(prior===undefined)delete process.env.KYRUB_SEMEADURA_ECONOMIC_PILOT;else process.env.KYRUB_SEMEADURA_ECONOMIC_PILOT=prior;
 }
});
