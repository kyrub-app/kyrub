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


test('isolated global supervision reconciles canonical accounts and suppresses incomplete totals',async()=>{
 const {readIsolatedGamificationGlobalSupervision}=await import('../server/gamification/semeaduraAdminSupervision.js');
 const admin=await googleSignIn('global-supervision-admin');
 const person=await googleSignIn('global-supervision-person');
 await Promise.all([waitForAward(admin.localId),waitForAward(person.localId)]);
 const profile=db.doc('kyrub_admin/control_plane/admins/'+admin.localId);
 const reviewer=db.doc('systemControl/semeaduraEconomicReview/reviewers/'+admin.localId);
 const prior=process.env.KYRUB_SEMEADURA_ECONOMIC_PILOT;
 const read=()=>readIsolatedGamificationGlobalSupervision(db,auth,'Bearer '+admin.idToken);
 const projections=[admin.localId,person.localId].map(id=>db.doc('users/'+id+'/semeaduraProgress/summary'));
 const synthetic=Array.from({length:99},(_,i)=>db.doc('users/global-synthetic-'+i+'/semeaduraProgress/summary'));
 const orphan=db.doc('users/global-orphan/rewardLedger/entry');
 const extraLedger=Array.from({length:499},(_,i)=>ledger(person.localId).doc('global-synthetic-'+i));
 try{
  delete process.env.KYRUB_SEMEADURA_ECONOMIC_PILOT;
  await assert.rejects(read(),/GAMIFICATION_SUPERVISION_DISABLED/);
  process.env.KYRUB_SEMEADURA_ECONOMIC_PILOT='true';
  await assert.rejects(read(),/GAMIFICATION_SUPERVISION_FORBIDDEN/);
  await profile.set({uid:admin.localId,role:'super_admin',status:'active'});
  await reviewer.set({schemaVersion:1,reviewerId:admin.localId,active:true,fixtureOnly:true});
  // Controlled projection fixtures: not actual seeds, never credited.
  await Promise.all(projections.map((ref,i)=>ref.set({authorId:[admin.localId,person.localId][i],acceptedSeeds:999,pitangueiras:0})));
  const clean=await read();
  assert.equal(clean.economyCoverage,'complete');
  assert.deepEqual(clean.economy,{credits:200,debits:0,balance:200,accounts:2});
  assert.deepEqual(clean.journey,{seeds:1998,pitangueiras:0,bosques:0,authors:2});
  assert.equal(clean.externalWritersVerified,false);
  assert.equal(clean.journeyReceiptReconciled,false);
  assert.deepEqual(clean.findings,[]);
  await balance(person.localId).update({availableKCoins:101});
  const mismatch=await read();
  assert.equal(mismatch.economy,null);
  assert.ok(mismatch.findings.includes('GLOBAL_CANONICAL_ECONOMY_INVALID'));
  assert.deepEqual(mismatch.journey,clean.journey);
  await balance(person.localId).update({availableKCoins:100});
  await orphan.set({id:'entry',userId:'global-orphan',economy:'k_coin'});
  assert.equal((await read()).economy,null);
  await orphan.delete();
  const ledgerBatch=db.batch();
  extraLedger.forEach(ref=>ledgerBatch.set(ref,{synthetic:true}));
  await ledgerBatch.commit();
  const incompleteEconomy=await read();
  assert.equal(incompleteEconomy.economyCoverage,'partial');
  assert.equal(incompleteEconomy.observedLedgerEntries,501);
  assert.equal(incompleteEconomy.economy,null);
  assert.deepEqual(incompleteEconomy.journey,clean.journey);
  const removeExtra=db.batch();
  extraLedger.forEach(ref=>removeExtra.delete(ref));
  await removeExtra.commit();
  const batch=db.batch();
  synthetic.forEach((ref,i)=>batch.set(ref,{authorId:'global-synthetic-'+i,acceptedSeeds:0,pitangueiras:0}));
  await batch.commit();
  const partial=await read();
  assert.equal(partial.journeyCoverage,'partial');
  assert.equal(partial.observedAuthorProjections,101);
  assert.equal(partial.journey,null);
  assert.deepEqual(partial.economy,clean.economy);
  await profile.update({status:'suspended'});
  await assert.rejects(read(),/GAMIFICATION_SUPERVISION_FORBIDDEN/);
 }finally{
  const cleanup=db.batch();
  [...projections,...synthetic,orphan].forEach(ref=>cleanup.delete(ref));
  await cleanup.commit();
  const cleanupLedger=db.batch();
  extraLedger.forEach(ref=>cleanupLedger.delete(ref));
  await cleanupLedger.commit();
  if(prior===undefined)delete process.env.KYRUB_SEMEADURA_ECONOMIC_PILOT;else process.env.KYRUB_SEMEADURA_ECONOMIC_PILOT=prior;
 }
});

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
  // Real Auth onCreate now records non-Google provenance in this pilot.
  // Replay that exact event rather than manufacturing a competing event ID.
  const registration=db.doc(`users/${user.uid}/authEvents/semeadura_non_google_registration_v1`);
  const deadline=Date.now()+60000;
  while(!(await registration.get()).exists&&Date.now()<deadline)await delay(100);
  const evidence=(await registration.get()).data();
  assert.equal(evidence?.source,'trusted_auth_on_create_non_google');
  assert.deepEqual(await handleWelcomeAuthCreated(db,auth,{...user,metadata:{creationTime:evidence!.createdAt}},{
   eventId:evidence!.sourceEventId,projectId,
  }),{skipped:true});
  await assert.rejects(handleWelcomeAuthCreated(db,auth,{...user,metadata:{creationTime:evidence!.createdAt}},{
   eventId:'conflicting-non-google-event',projectId,
  }),/SEMEADURA_NO_WELCOME_REGISTRATION_CONFLICT/);
  assert.deepEqual((await registration.get()).data(),evidence);
  assert.equal((await db.doc(`users/${user.uid}/authEvents/first_login_v1`).get()).exists,false);
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
  const {recordIsolatedSemeaduraReview}=await import('../server/gamification/semeaduraEconomicReview.js');
  const reviewer='fixture-reviewer';
  await db.doc('systemControl/semeaduraEconomicReview/reviewers/'+reviewer).set({schemaVersion:1,reviewerId:reviewer,active:true,fixtureOnly:true});
  for(const [scope,target] of [['author',uid],['actor','threshold-voter'],['post',key]] as const){
   const hold=db.doc('systemControl/semeaduraEconomicReview/holds/'+scope+'_'+target);
   const command={scope,target,caseId:'isolated-review',eventId:'threshold-held-'+scope,status:'held' as const,expectedRevision:0};
   await recordIsolatedSemeaduraReview(db,reviewer,command);
   await assert.rejects(seed('threshold-voter'),/SEMEADURA_ECONOMIC_REVIEW_HELD/);
   assert.equal((await stats.get()).get('acceptedSeeds'),999);
   assert.equal((await pilot.get()).get('acceptedSeeds'),999);
   assert.equal((await stats.collection('receipts').doc('threshold-voter').get()).exists,false);
   assert.deepEqual(await readPitangaAccount(db,uid),before);
   await hold.update({status:'unknown'});
   await assert.rejects(seed('threshold-voter'),/SEMEADURA_ECONOMIC_REVIEW_INVALID/);
   await hold.update({status:'held'});
   await recordIsolatedSemeaduraReview(db,reviewer,{...command,eventId:'threshold-clear-'+scope,status:'cleared',expectedRevision:1});
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
  const postReview={scope:'post' as const,target:key,caseId:'later-review',eventId:'later-hold',status:'held' as const,expectedRevision:2};
  await recordIsolatedSemeaduraReview(db,reviewer,postReview);
  assert.equal((await seed('threshold-voter')).status,'already_seeded');
  await assert.rejects(seed('new-held-voter'),/SEMEADURA_ECONOMIC_REVIEW_HELD/);
  assert.deepEqual(await readPitangaAccount(db,uid),after);
  assert.equal((await stats.get()).get('acceptedSeeds'),1001);
  await recordIsolatedSemeaduraReview(db,reviewer,{...postReview,eventId:'later-clear',status:'cleared',expectedRevision:3});
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


test('isolated technical evidence reports integrity only without writing holds or balances',async()=>{
 const {inspectIsolatedSemeaduraEvidence}=await import('../server/gamification/semeaduraReviewEvidence.js');
 const {seedVerifiedPost}=await import('../server/gamification/semeaduraService.js');
 const {createHash}=await import('node:crypto');
 const signed=await googleSignIn('evidence-author');
 const author=signed.localId;
 await waitForAward(author);
 const root='systemControl/semeaduraEconomicReview';
 const reviewer='evidence-fixture-reviewer';
 const postId='evidence-post';
 const target={kind:'personal' as const,postId};
 const key=createHash('sha256').update('personal\0'+postId).digest('hex');
 const stats=db.doc('semeadura_post_stats/'+key);
 const receipts=stats.collection('receipts');
 const prior=process.env.KYRUB_SEMEADURA_ECONOMIC_PILOT;
 const inspect=()=>inspectIsolatedSemeaduraEvidence(db,reviewer,target);
 try{
  delete process.env.KYRUB_SEMEADURA_ECONOMIC_PILOT;
  await assert.rejects(inspect(),/SEMEADURA_REVIEW_PILOT_DISABLED/);
  process.env.KYRUB_SEMEADURA_ECONOMIC_PILOT='true';
  await assert.rejects(inspect(),/SEMEADURA_REVIEW_NOT_AUTHORIZED/);
  await db.doc(root+'/reviewers/'+reviewer).set({schemaVersion:1,reviewerId:reviewer,active:true,fixtureOnly:true});
  await db.doc('social_posts/'+postId).set({postId,authorId:author,visibility:'public',publicationType:'feed'});
  for(let i=0;i<3;i++)await seedVerifiedPost(db,{...target,authenticatedUserId:'evidence-voter-'+i});
  const good=await inspect();
  assert.equal(good.coverage,'complete');
  assert.equal(good.observedReceipts,3);
  assert.equal(good.projectedSeeds,3);
  assert.deepEqual(good.findings,[]);
  assert.equal(good.requiresTechnicalReview,false);
  await receipts.doc('evidence-voter-0').update({quotaDay:'2000-01-01'});
  await receipts.doc('evidence-voter-1').update({actorId:author});
  await stats.update({acceptedSeeds:5});
  const bad=await inspect();
  assert.deepEqual(bad.findings,['COUNTER_RECEIPT_MISMATCH','INVALID_RECEIPT','SELF_SEED_RECEIPT']);
  assert.equal(bad.invalidReceipts,2);
  assert.equal(bad.selfReceipts,1);
  assert.equal(bad.requiresTechnicalReview,true);
  assert.equal(JSON.stringify(bad).includes('evidence-voter-'),false);
  // Legacy receipts without quotaDay are not automatically misconduct.
  const original=(await receipts.doc('evidence-voter-2').get()).data()!;
  const {quotaDay:unused,...legacy}=original;
  await receipts.doc('evidence-voter-2').set(legacy);
  assert.equal((await inspect()).legacyWithoutQuotaDay,1);
  await stats.update({acceptedSeeds:1});
  assert.ok((await inspect()).findings.includes('COUNTER_BELOW_OBSERVED'));
  // Explicit synthetic data to exercise bounded sampling, never rewarded.
  const batch=db.batch();
  for(let i=0;i<498;i++){
   const actorId='sample-'+String(i).padStart(4,'0');
   batch.set(receipts.doc(actorId),{...legacy,actorId});
  }
  await batch.commit();
  await stats.update({acceptedSeeds:800});
  const partial=await inspect();
  assert.equal(partial.coverage,'partial');
  assert.equal(partial.observedReceipts,501);
  assert.equal(partial.findings.includes('COUNTER_RECEIPT_MISMATCH'),false);
  await stats.delete();
  assert.ok((await inspect()).findings.includes('ORPHAN_RECEIPTS'));
  assert.equal((await db.doc(root+'/holds/author_'+author).get()).exists,false);
  assert.equal((await db.doc(root+'/holds/post_'+key).get()).exists,false);
  assert.equal((await balance(author).get()).get('availableKCoins'),100);
  assert.equal((await ledger(author).get()).size,1);
 }finally{
  if(prior===undefined)delete process.env.KYRUB_SEMEADURA_ECONOMIC_PILOT;else process.env.KYRUB_SEMEADURA_ECONOMIC_PILOT=prior;
 }
});


test('isolated admin supervision authenticates real emulator identity and reconciles bounded account data',async()=>{
 const {readIsolatedGamificationAccountSupervision}=await import('../server/gamification/semeaduraAdminSupervision.js');
 const {seedVerifiedPost}=await import('../server/gamification/semeaduraService.js');
 const admin=await googleSignIn('supervision-admin');
 const person=await googleSignIn('supervision-account');
 const actor=await googleSignIn('supervision-voter');
 await Promise.all([waitForAward(admin.localId),waitForAward(person.localId),waitForAward(actor.localId)]);
 const profile=db.doc('kyrub_admin/control_plane/admins/'+admin.localId);
 const reviewer=db.doc('systemControl/semeaduraEconomicReview/reviewers/'+admin.localId);
 const prior=process.env.KYRUB_SEMEADURA_ECONOMIC_PILOT;
 const authorization='Bearer '+admin.idToken;
 const read=()=>readIsolatedGamificationAccountSupervision(db,auth,authorization,person.localId);
 try{
  delete process.env.KYRUB_SEMEADURA_ECONOMIC_PILOT;
  await assert.rejects(read(),/GAMIFICATION_SUPERVISION_DISABLED/);
  process.env.KYRUB_SEMEADURA_ECONOMIC_PILOT='true';
  await assert.rejects(readIsolatedGamificationAccountSupervision(db,auth,'Bearer invalid',person.localId),/GAMIFICATION_SUPERVISION_AUTH_REQUIRED/);
  await assert.rejects(read(),/GAMIFICATION_SUPERVISION_FORBIDDEN/);
  await profile.set({uid:admin.localId,role:'super_admin',status:'active'});
  await assert.rejects(read(),/GAMIFICATION_SUPERVISION_FORBIDDEN/);
  await reviewer.set({schemaVersion:1,reviewerId:admin.localId,active:true,fixtureOnly:true});
  await assert.rejects(readIsolatedGamificationAccountSupervision(db,auth,'Bearer '+person.idToken,admin.localId),/GAMIFICATION_SUPERVISION_FORBIDDEN/);
  const postId='supervision-account-post';
  await db.doc('social_posts/'+postId).set({postId,authorId:person.localId,visibility:'public',publicationType:'feed'});
  await seedVerifiedPost(db,{kind:'personal',postId,authenticatedUserId:actor.localId});
  const result=await read();
  assert.equal(result.scope,'single-account');
  assert.equal(result.ledgerCoverage,'complete');
  assert.deepEqual(result.economy,{credits:100,debits:0,balance:100});
  assert.deepEqual(result.journey,{seeds:1,pitangueiras:0,bosques:0});
  assert.deepEqual(result.findings,[]);
  assert.equal(JSON.stringify(result).includes(person.localId),false);
  await balance(person.localId).update({availableKCoins:999});
  const bad=await read();
  assert.equal(bad.economy,null);
  assert.ok(bad.findings.includes('PITANGA_LEDGER_OR_BALANCE_INVALID'));
  assert.equal((await balance(person.localId).get()).get('availableKCoins'),999);
  await balance(person.localId).update({availableKCoins:100});
  const batch=db.batch();
  // Synthetic malformed records exercise the read ceiling without issuing any currency.
  for(let i=0;i<200;i++)batch.set(ledger(person.localId).doc('sample-'+i),{synthetic:true});
  await batch.commit();
  const partial=await read();
  assert.equal(partial.ledgerCoverage,'partial');
  assert.equal(partial.observedEntries,201);
  assert.equal(partial.economy,null);
  await profile.update({status:'suspended'});
  await assert.rejects(read(),/GAMIFICATION_SUPERVISION_FORBIDDEN/);
  await profile.update({status:'active'});
  await auth.updateUser(admin.localId,{disabled:true});
  await assert.rejects(read(),/GAMIFICATION_SUPERVISION_AUTH_REQUIRED/);
 }finally{
  if(prior===undefined)delete process.env.KYRUB_SEMEADURA_ECONOMIC_PILOT;else process.env.KYRUB_SEMEADURA_ECONOMIC_PILOT=prior;
 }
});


test('isolated incremental snapshot replaces contributions without duplicate totals or stale invalid balances',async()=>{
 const {refreshIsolatedGamificationIncrementalAccount,readIsolatedGamificationIncrementalSnapshot}=await import('../server/gamification/semeaduraAdminSupervision.js');
 const admin=await googleSignIn('incremental-supervision-admin');
 const a=await googleSignIn('incremental-supervision-a');
 const b=await googleSignIn('incremental-supervision-b');
 await Promise.all([waitForAward(admin.localId),waitForAward(a.localId),waitForAward(b.localId)]);
 const profile=db.doc('kyrub_admin/control_plane/admins/'+admin.localId);
 const reviewer=db.doc('systemControl/semeaduraEconomicReview/reviewers/'+admin.localId);
 const projection=db.doc('users/'+a.localId+'/semeaduraProgress/summary');
 const prior=process.env.KYRUB_SEMEADURA_ECONOMIC_PILOT;
 const bearer='Bearer '+admin.idToken;
 const refresh=(id:string)=>refreshIsolatedGamificationIncrementalAccount(db,auth,bearer,id);
 const read=()=>readIsolatedGamificationIncrementalSnapshot(db,auth,bearer);
 const cache=db.doc('systemControl/gamificationIncrementalPilot');
 try{
  delete process.env.KYRUB_SEMEADURA_ECONOMIC_PILOT;
  await assert.rejects(refresh(a.localId),/GAMIFICATION_SUPERVISION_DISABLED/);
  process.env.KYRUB_SEMEADURA_ECONOMIC_PILOT='true';
  await assert.rejects(refresh(a.localId),/GAMIFICATION_SUPERVISION_FORBIDDEN/);
  await profile.set({uid:admin.localId,role:'super_admin',status:'active'});
  await reviewer.set({schemaVersion:1,reviewerId:admin.localId,active:true,fixtureOnly:true});
  assert.equal((await read()).refreshedAccounts,0);
  await assert.rejects(refresh('incremental-missing-account'),/INCREMENTAL_ACCOUNT_UNAVAILABLE/);
  assert.equal((await read()).refreshedAccounts,0);
  await projection.set({authorId:a.localId,acceptedSeeds:999,pitangueiras:0});
  await Promise.all([refresh(a.localId),refresh(a.localId),refresh(b.localId)]);
  const initial=await read();
  assert.equal(initial.refreshedAccounts,2);
  assert.equal(initial.economyKnown,2);
  assert.deepEqual(initial.reconciledEconomySubtotal,{credits:200,debits:0,balance:200});
  assert.deepEqual(initial.authorProjectionSubtotal,{seeds:999,pitangueiras:0,bosques:0});
  assert.equal(initial.globalCoverageVerified,false);
  assert.equal(initial.automaticRefresh,false);
  assert.equal(initial.mayBeStale,true);
  await projection.update({acceptedSeeds:1000,pitangueiras:1});
  assert.deepEqual((await read()).authorProjectionSubtotal,initial.authorProjectionSubtotal);
  await refresh(a.localId);
  assert.deepEqual((await read()).authorProjectionSubtotal,{seeds:1000,pitangueiras:1,bosques:0});
  await balance(a.localId).update({availableKCoins:101});
  await refresh(a.localId);
  const invalid=await read();
  assert.equal(invalid.refreshedAccounts,2);
  assert.equal(invalid.economyKnown,1);
  assert.deepEqual(invalid.reconciledEconomySubtotal,{credits:100,debits:0,balance:100});
  assert.equal((await balance(a.localId).get()).get('availableKCoins'),101);
  await balance(a.localId).update({availableKCoins:100});
  await refresh(a.localId);
  assert.deepEqual((await read()).reconciledEconomySubtotal,initial.reconciledEconomySubtotal);
  await profile.update({status:'suspended'});
  await assert.rejects(read(),/GAMIFICATION_SUPERVISION_FORBIDDEN/);
  await assert.rejects(refresh(b.localId),/GAMIFICATION_SUPERVISION_FORBIDDEN/);
 }finally{
  await balance(a.localId).update({availableKCoins:100});
  await Promise.all([projection.delete(),cache.collection('accounts').doc(a.localId).delete(),cache.collection('accounts').doc(b.localId).delete(),cache.delete()]);
  if(prior===undefined)delete process.env.KYRUB_SEMEADURA_ECONOMIC_PILOT;else process.env.KYRUB_SEMEADURA_ECONOMIC_PILOT=prior;
 }
});


test('accepted seeds enqueue isolated refresh atomically; repeated drains do not duplicate totals',async()=>{
 const {drainIsolatedGamificationDirtyAccounts,readIsolatedGamificationIncrementalSnapshot,runIsolatedGamificationQueueCycle}=await import('../server/gamification/semeaduraAdminSupervision.js');
 const {seedVerifiedPost}=await import('../server/gamification/semeaduraService.js');
 const admin=await googleSignIn('dirty-queue-admin');
 const author=await googleSignIn('dirty-queue-author');
 const second=await googleSignIn('dirty-queue-second');
 await Promise.all([waitForAward(admin.localId),waitForAward(author.localId),waitForAward(second.localId)]);
 const profile=db.doc('kyrub_admin/control_plane/admins/'+admin.localId);
 const reviewer=db.doc('systemControl/semeaduraEconomicReview/reviewers/'+admin.localId);
 const cache=db.doc('systemControl/gamificationIncrementalPilot');
 const pending=(id:string)=>cache.collection('pending').doc(id);
 const prior=process.env.KYRUB_SEMEADURA_ECONOMIC_PILOT;
 const queuePrior=process.env.KYRUB_GAMIFICATION_INCREMENTAL_QUEUE;
 const bearer='Bearer '+admin.idToken;
 const drain=(limit=10)=>drainIsolatedGamificationDirtyAccounts(db,auth,bearer,limit);
 const read=()=>readIsolatedGamificationIncrementalSnapshot(db,auth,bearer);
 const postId='dirty-queue-post';
 const post2='dirty-queue-second-post';
 const seed=(actor:string,id=postId)=>seedVerifiedPost(db,{kind:'personal',postId:id,authenticatedUserId:actor});
 try{
  process.env.KYRUB_SEMEADURA_ECONOMIC_PILOT='true';
  delete process.env.KYRUB_GAMIFICATION_INCREMENTAL_QUEUE;
  await profile.set({uid:admin.localId,role:'super_admin',status:'active'});
  await reviewer.set({schemaVersion:1,reviewerId:admin.localId,active:true,fixtureOnly:true});
  await assert.rejects(drain(),/INCREMENTAL_QUEUE_DISABLED/);
  await db.doc('social_posts/'+postId).set({postId,authorId:author.localId,visibility:'public',publicationType:'feed'});
  await db.doc('social_posts/'+post2).set({postId:post2,authorId:second.localId,visibility:'public',publicationType:'feed'});
  await seed('queue-disabled-voter');
  assert.equal((await pending(author.localId).get()).exists,false);
  process.env.KYRUB_GAMIFICATION_INCREMENTAL_QUEUE='true';
  await assert.rejects(seed(author.localId),/SEMEADURA_SELF_RECOGNITION_DENIED/);
  assert.equal((await pending(author.localId).get()).exists,false);
  await Promise.all([seed('queue-voter-1'),seed('queue-voter-1'),seed('queue-voter-2')]);
  await seed('queue-second-voter',post2);
  assert.equal((await cache.collection('pending').get()).size,2);
  assert.equal((await read()).refreshedAccounts,0);
  await assert.rejects(drain(21),/INCREMENTAL_QUEUE_LIMIT_INVALID/);
  const cycle=(maxBatches:number)=>runIsolatedGamificationQueueCycle(db,auth,bearer,{batchSize:1,maxBatches});
  await assert.rejects(cycle(6),/INCREMENTAL_QUEUE_CYCLE_LIMIT_INVALID/);
  const batch=await cycle(1);
  assert.equal(batch.processed,1);assert.equal(batch.moreObserved,true);
  assert.equal(batch.stopReason,'batch-budget-reached');
  assert.equal((await cache.collection('pending').get()).size,1);
  const rest=await cycle(3);
  assert.equal(rest.processed,1);assert.equal(rest.batches,1);
  assert.equal(rest.stopReason,'no-more-in-last-snapshot');
  assert.equal(rest.schedulerInstalled,false);
  const snapshot=await read();
  assert.equal(snapshot.refreshedAccounts,2);
  assert.deepEqual(snapshot.reconciledEconomySubtotal,{credits:200,debits:0,balance:200});
  assert.deepEqual(snapshot.authorProjectionSubtotal,{seeds:4,pitangueiras:0,bosques:0});
  assert.equal((await drain()).refreshed,0);
  await seed('queue-voter-1');
  assert.equal((await pending(author.localId).get()).exists,false);
  await seed('queue-new-voter');
  await Promise.all([drain(),seed('queue-racing-voter')]);
  await drain();
  assert.equal((await pending(author.localId).get()).exists,false);
  assert.equal((await read()).authorProjectionSubtotal?.seeds,6);
  assert.equal((await read()).reconciledEconomySubtotal?.balance,200);
  // Synthetic boundary fixture, as in the economic-pilot tests.
  // No historical reward is invented. Only the next accepted seed pays.
  const progress=db.doc('users/'+author.localId+'/semeaduraProgress/summary');
  const enrollment=db.doc('users/'+author.localId+'/semeaduraEconomicPilot/activation');
  await progress.update({acceptedSeeds:999,pitangueiras:0});
  await enrollment.set({schemaVersion:1,authorId:author.localId,epoch,acceptedSeeds:999,creditedPitangas:0});
  await Promise.all([seed('queue-threshold-voter'),seed('queue-threshold-voter')]);
  await drain();
  const milestone=await read();
  assert.deepEqual(milestone.reconciledEconomySubtotal,{credits:201,debits:0,balance:201});
  assert.deepEqual(milestone.authorProjectionSubtotal,{seeds:1001,pitangueiras:1,bosques:0});
  assert.equal((await balance(author.localId).get()).get('availableKCoins'),101);
  assert.equal((await drain()).refreshed,0);
  await profile.update({status:'suspended'});
  await assert.rejects(drain(),/GAMIFICATION_SUPERVISION_FORBIDDEN/);
 }finally{
  await Promise.all([pending(author.localId).delete(),pending(second.localId).delete(),
    cache.collection('accounts').doc(author.localId).delete(),cache.collection('accounts').doc(second.localId).delete(),cache.delete()]);
  if(prior===undefined)delete process.env.KYRUB_SEMEADURA_ECONOMIC_PILOT;else process.env.KYRUB_SEMEADURA_ECONOMIC_PILOT=prior;
  if(queuePrior===undefined)delete process.env.KYRUB_GAMIFICATION_INCREMENTAL_QUEUE;else process.env.KYRUB_GAMIFICATION_INCREMENTAL_QUEUE=queuePrior;
 }
});


test('authenticated suspicion inspection requires active admin and reports evidence without sanctions',async()=>{
 const {readIsolatedGamificationSuspicionEvidence,openIsolatedGamificationSuspicionCase,closeIsolatedGamificationSuspicionCase,listIsolatedGamificationSuspicionCases,readIsolatedGamificationSuspicionCase,acceptIsolatedGamificationEconomicReferral,decideIsolatedGamificationEconomicReferral,readIsolatedGamificationEconomicReferral}=await import('../server/gamification/semeaduraAdminSupervision.js');
 const {seedVerifiedPost}=await import('../server/gamification/semeaduraService.js');
 const {createHash}=await import('node:crypto');
 const admin=await googleSignIn('suspicion-inspector-admin');
 const author=await googleSignIn('suspicion-inspector-author');
 await Promise.all([waitForAward(admin.localId),waitForAward(author.localId)]);
 const profile=db.doc('kyrub_admin/control_plane/admins/'+admin.localId);
 const reviewer=db.doc('systemControl/semeaduraEconomicReview/reviewers/'+admin.localId);
 const postId='authenticated-suspicion-post';
 const input={kind:'personal' as const,postId};
 const key=createHash('sha256').update('personal\0'+postId).digest('hex');
 const stats=db.doc('semeadura_post_stats/'+key);
 const hold=db.doc('systemControl/semeaduraEconomicReview/holds/post_'+key);
 const prior=process.env.KYRUB_SEMEADURA_ECONOMIC_PILOT;
 const read=()=>readIsolatedGamificationSuspicionEvidence(db,auth,'Bearer '+admin.idToken,input);
 try{
  delete process.env.KYRUB_SEMEADURA_ECONOMIC_PILOT;
  await assert.rejects(read(),/GAMIFICATION_SUPERVISION_DISABLED/);
  process.env.KYRUB_SEMEADURA_ECONOMIC_PILOT='true';
  await assert.rejects(read(),/GAMIFICATION_SUPERVISION_FORBIDDEN/);
  await reviewer.set({schemaVersion:1,reviewerId:admin.localId,active:true,fixtureOnly:true});
  await assert.rejects(read(),/GAMIFICATION_SUPERVISION_FORBIDDEN/);
  await profile.set({uid:admin.localId,role:'super_admin',status:'active'});
  await assert.rejects(readIsolatedGamificationSuspicionEvidence(db,auth,'Bearer '+author.idToken,input),/GAMIFICATION_SUPERVISION_FORBIDDEN/);
  await db.doc('social_posts/'+postId).set({postId,authorId:author.localId,visibility:'public',publicationType:'feed'});
  await seedVerifiedPost(db,{...input,authenticatedUserId:'suspicion-voter'});
  const good=await read();
  assert.deepEqual(good.findings,[]);
  assert.equal(good.classification,'technical-indicator-not-fraud-verdict');
  const bearer='Bearer '+admin.idToken;
  const open=(caseId:string)=>openIsolatedGamificationSuspicionCase(db,auth,bearer,{...input,caseId});
  const close=(caseId:string,outcome:'resolved'|'inconclusive'|'referred_for_review')=>closeIsolatedGamificationSuspicionCase(db,auth,bearer,{caseId,outcome});
  const root=db.doc('systemControl/semeaduraSuspicionPilot');
  await assert.rejects(open('no-evidence-case'),/SUSPICION_CASE_NO_INDICATORS/);
  await stats.update({acceptedSeeds:2});
  const bad=await read();
  assert.deepEqual(bad.findings,['COUNTER_RECEIPT_MISMATCH']);
  assert.equal(bad.automaticSanction,false);
  assert.equal(bad.caseCreated,false);
  assert.equal((await hold.get()).exists,false);
  assert.equal((await balance(author.localId).get()).get('availableKCoins'),100);
  assert.equal((await stats.get()).get('acceptedSeeds'),2);
  const concurrent=await Promise.allSettled([open('suspicion-case-a'),open('suspicion-case-b')]);
  assert.equal(concurrent.filter(r=>r.status==='fulfilled').length,1);
  const cases=await root.collection('cases').get();
  assert.equal(cases.size,1);
  const caseId=cases.docs[0].id;
  assert.equal((await open(caseId)).replayed,true);
  assert.equal((await root.collection('active').get()).size,1);
  const list=(status:'all'|'open'|'closed',limit=20,afterCaseId?:string)=>listIsolatedGamificationSuspicionCases(db,auth,bearer,{status,limit,afterCaseId});
  const detail=(id:string)=>readIsolatedGamificationSuspicionCase(db,auth,bearer,id);
  await assert.rejects(list('all',21),/SUSPICION_CASE_LIST_INPUT_INVALID/);
  await assert.rejects(listIsolatedGamificationSuspicionCases(db,auth,'Bearer '+author.idToken,{status:'all',limit:1}),/GAMIFICATION_SUPERVISION_FORBIDDEN/);
  assert.deepEqual((await list('open')).cases.map(row=>row.caseId),[caseId]);
  assert.equal((await list('closed')).cases.length,0);
  const opened=await detail(caseId);
  assert.equal(opened.status,'open');
  assert.equal(opened.closing,null);
  assert.deepEqual(opened.openingEvidence.findings,['COUNTER_RECEIPT_MISMATCH']);
  await assert.rejects(detail('missing-case'),/SUSPICION_CASE_UNAVAILABLE/);
  assert.deepEqual(cases.docs[0].get('openingEvidence').findings,['COUNTER_RECEIPT_MISMATCH']);
  await assert.rejects(close(caseId,'resolved'),/SUSPICION_CASE_NOT_RESOLVED/);
  await stats.update({acceptedSeeds:1});
  assert.deepEqual(await close(caseId,'resolved'),{caseId,status:'closed',replayed:false});
  assert.equal((await close(caseId,'resolved')).replayed,true);
  await assert.rejects(close(caseId,'inconclusive'),/SUSPICION_CASE_CLOSE_CONFLICT/);
  assert.equal((await open(caseId)).status,'closed');
  assert.equal((await root.collection('active').get()).size,0);
  await stats.update({acceptedSeeds:2});
  const newId='suspicion-case-new';
  assert.equal((await open(newId)).status,'open');
  await close(newId,'referred_for_review');
  const reviewRoot=db.doc('systemControl/semeaduraEconomicReview');
  const referral=reviewRoot.collection('referrals').doc(newId);
  const decisionRef=reviewRoot.collection('referralDecisions').doc(newId);
  const accept=(id:string)=>acceptIsolatedGamificationEconomicReferral(db,auth,bearer,id);
  const readReview=()=>readIsolatedGamificationEconomicReferral(db,auth,bearer,newId);
  const command={caseId:newId,decision:'requires_separate_corrective_review' as const,reason:'Divergência técnica exige avaliação independente.'};
  const decide=()=>decideIsolatedGamificationEconomicReferral(db,auth,bearer,command);
  // Closing with a referral classification is not an automatic intake.
  assert.equal((await referral.get()).exists,false);
  await assert.rejects(accept(caseId),/ECONOMIC_REFERRAL_SOURCE_INVALID/);
  await assert.rejects(accept('missing-case'),/ECONOMIC_REFERRAL_SOURCE_UNAVAILABLE/);
  await assert.rejects(acceptIsolatedGamificationEconomicReferral(db,auth,'Bearer '+author.idToken,newId),/GAMIFICATION_SUPERVISION_FORBIDDEN/);
  const intake=await Promise.all([accept(newId),accept(newId)]);
  assert.equal(intake.filter(r=>!r.replayed).length,1);
  assert.equal((await readReview()).status,'pending');
  assert.equal((await readReview()).decision,null);
  await assert.rejects(decideIsolatedGamificationEconomicReferral(db,auth,bearer,{...command,reason:'curto'}),/ECONOMIC_REFERRAL_INPUT_INVALID/);
  const decisions=await Promise.all([decide(),decide()]);
  assert.equal(decisions.filter(r=>!r.replayed).length,1);
  const review=await readReview();
  assert.equal(review.status,'decided');
  assert.equal(review.decision?.outcome,command.decision);
  assert.equal(review.decision?.reason,command.reason);
  assert.equal(review.economicMutationApplied,false);
  assert.equal(review.fraudVerdict,false);
  assert.deepEqual(review.openingEvidence.findings,['COUNTER_RECEIPT_MISMATCH']);
  assert.deepEqual(review.closingEvidence.findings,['COUNTER_RECEIPT_MISMATCH']);
  await assert.rejects(decideIsolatedGamificationEconomicReferral(db,auth,bearer,{...command,decision:'no_action'}),/ECONOMIC_REFERRAL_DECISION_CONFLICT/);
  assert.equal((await accept(newId)).status,'decided');
  await decisionRef.update({decision:'no_action'});
  await assert.rejects(readReview(),/ECONOMIC_REFERRAL_STATE_INVALID/);
  await decisionRef.update({decision:command.decision});
  assert.equal((await hold.get()).exists,false);
  assert.equal((await balance(author.localId).get()).get('availableKCoins'),100);
  assert.equal((await detail(newId)).outcome,'referred_for_review');

  assert.equal((await root.collection('closures').get()).size,2);
  assert.equal((await list('open')).cases.length,0);
  const first=await list('closed',1);
  assert.equal(first.cases.length,1);
  assert.ok(first.nextAfterCaseId);
  const secondPage=await list('closed',1,first.nextAfterCaseId!);
  assert.equal(secondPage.cases.length,1);
  assert.notEqual(first.cases[0].caseId,secondPage.cases[0].caseId);
  assert.equal(secondPage.nextAfterCaseId,null);
  assert.equal(first.consistentAcrossPages,false);
  // Exercise the actual HTTP adapter on a disposable loopback port.
  const {createIsolatedGamificationAdminRouter}=await import('../server/gamification/semeaduraAdminPilotRouter.js');
  const express=(await import('express')).default;
  const local=express();
  local.use('/api/admin/gamification-pilot',createIsolatedGamificationAdminRouter(db,auth));
  const server=local.listen(0,'127.0.0.1');
  const previousHttp=process.env.KYRUB_GAMIFICATION_ADMIN_HTTP_PILOT;
  try{
   if(!server.listening)await new Promise<void>((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
   const address=server.address();
   assert.ok(address&&typeof address!=='string');
   const url='http://127.0.0.1:'+address.port+'/api/admin/gamification-pilot';
   const headers={authorization:'Bearer '+admin.idToken};
   delete process.env.KYRUB_GAMIFICATION_ADMIN_HTTP_PILOT;
   assert.equal((await fetch(url+'?operation=snapshot',{headers})).status,404);
   process.env.KYRUB_GAMIFICATION_ADMIN_HTTP_PILOT='true';
   assert.equal((await fetch(url+'?operation=snapshot')).status,401);
   assert.equal((await fetch(url+'?operation=snapshot',{headers:{authorization:'Bearer '+author.idToken}})).status,403);
   assert.equal((await fetch(url+'?operation=snapshot',{method:'POST',headers})).status,405);
   assert.equal((await fetch(url+'?operation=snapshot&uid=spoof',{headers})).status,400);
   assert.equal((await fetch(url+'?operation=snapshot',{headers:{...headers,origin:'https://external.invalid'}})).status,403);
   assert.equal((await fetch(url+'?operation=cases&status=all&limit=21',{headers})).status,400);
   const response=await fetch(url+'?operation=cases&status=closed&limit=1',{headers});
   assert.equal(response.status,200);
   assert.equal(response.headers.get('cache-control'),'no-store');
   const page=await response.json() as {cases:{caseId:string}[];nextAfterCaseId:string};
   assert.equal(page.cases.length,1);
   assert.ok(page.nextAfterCaseId);
   const caseResponse=await fetch(url+'?operation=case&caseId='+caseId,{headers});
   assert.equal(caseResponse.status,200);
   const record=await caseResponse.json() as {status:string;automaticSanction:boolean};
   assert.equal(record.status,'closed');
   assert.equal(record.automaticSanction,false);
   assert.equal((await fetch(url+'?operation=snapshot',{headers})).status,200);
   assert.equal((await fetch(url+'?operation=case&caseId=missing',{headers})).status,404);
  }finally{
   server.closeAllConnections();
   await new Promise<void>(resolve=>server.close(()=>resolve()));
   if(previousHttp===undefined)delete process.env.KYRUB_GAMIFICATION_ADMIN_HTTP_PILOT;else process.env.KYRUB_GAMIFICATION_ADMIN_HTTP_PILOT=previousHttp;
  }
  const history=await detail(caseId);
  assert.equal(history.outcome,'resolved');
  assert.deepEqual(history.openingEvidence.findings,['COUNTER_RECEIPT_MISMATCH']);
  assert.deepEqual(history.closing?.evidence.findings,[]);
  assert.equal(history.automaticSanction,false);
  const closureRef=root.collection('closures').doc(caseId);
  await closureRef.update({outcome:'inconclusive'});
  await assert.rejects(detail(caseId),/SUSPICION_CASE_STATE_INVALID/);
  await closureRef.update({outcome:'resolved'});
  assert.equal((await hold.get()).exists,false);
  assert.equal((await balance(author.localId).get()).get('availableKCoins'),100);
  await profile.update({status:'suspended'});
  await assert.rejects(open('suspended-case'),/GAMIFICATION_SUPERVISION_FORBIDDEN/);
  await assert.rejects(list('all'),/GAMIFICATION_SUPERVISION_FORBIDDEN/);
  await assert.rejects(detail(caseId),/GAMIFICATION_SUPERVISION_FORBIDDEN/);
  await assert.rejects(readReview(),/GAMIFICATION_SUPERVISION_FORBIDDEN/);
  await assert.rejects(decide(),/GAMIFICATION_SUPERVISION_FORBIDDEN/);
  await assert.rejects(read(),/GAMIFICATION_SUPERVISION_FORBIDDEN/);
 }finally{
  await stats.set({kind:'personal',postId,authorId:author.localId,communityId:'',acceptedSeeds:1,closed:false});
  if(prior===undefined)delete process.env.KYRUB_SEMEADURA_ECONOMIC_PILOT;else process.env.KYRUB_SEMEADURA_ECONOMIC_PILOT=prior;
 }
});


test('isolated release control denies new writes by default, pauses atomically and preserves accepted receipts',async()=>{
 const {seedReleaseControlledPost}=await import('../server/gamification/semeaduraService.js');
 const {SEMEADURA_RELEASE_CONTROL_PATH}=await import('../server/gamification/semeaduraReleaseControl.js');
 const {createHash}=await import('node:crypto');
 const {semeaduraDay}=await import('../shared/semeaduraDailyLimit.js');
 const author='release-control-author';
 const postId='release-control-post';
 const key=createHash('sha256').update('personal\0'+postId).digest('hex');
 const post=db.doc('social_posts/'+postId);
 const stats=db.doc('semeadura_post_stats/'+key);
 const control=db.doc(SEMEADURA_RELEASE_CONTROL_PATH);
 const progress=db.doc('users/'+author+'/semeaduraProgress/summary');
 const first='release-control-first',second='release-control-second';
 const quota=(uid:string)=>db.doc('users/'+uid+'/semeaduraDailyUsage/'+semeaduraDay(new Date()));
 const receipt=(uid:string)=>stats.collection('receipts').doc(uid);
 const seed=(uid:string)=>seedReleaseControlledPost(db,{authenticatedUserId:uid,kind:'personal',postId});
 const oldPilot=process.env.KYRUB_SEMEADURA_ECONOMIC_PILOT;
 const oldGate=process.env.KYRUB_SEMEADURA_RELEASE_CONTROL_PILOT;
 const denied=async(uid:string)=>{
  await assert.rejects(seed(uid),/SEMEADURA_RELEASE_UNAVAILABLE/);
  assert.equal((await receipt(uid).get()).exists,false);
  assert.equal((await quota(uid).get()).exists,false);
 };
 const record={schemaVersion:1,projectId,epoch,mode:'isolated-pilot',status:'open',revision:1,opensAt:new Date(Date.now()-60000).toISOString()};
 try{
  await post.set({postId,authorId:author,visibility:'public',publicationType:'feed'});
  process.env.KYRUB_SEMEADURA_ECONOMIC_PILOT='true';
  delete process.env.KYRUB_SEMEADURA_RELEASE_CONTROL_PILOT;
  await control.set(record);
  await denied(first);
  process.env.KYRUB_SEMEADURA_RELEASE_CONTROL_PILOT='true';
  await control.delete();
  await denied(first);
  await control.set({...record,projectId:'wrong-project'});
  await denied(first);
  await control.set({...record,opensAt:new Date(Date.now()+60000).toISOString()});
  await denied(first);
  assert.equal((await stats.get()).exists,false);
  assert.equal((await progress.get()).exists,false);
  await control.set(record);
  assert.equal((await seed(first)).status,'accepted');
  const original=(await receipt(first).get()).data();
  await control.update({status:'paused',revision:2});
  await denied(second);
  assert.equal((await seed(first)).status,'already_seeded');
  assert.deepEqual((await receipt(first).get()).data(),original);
  assert.equal((await quota(first).get()).get('count'),1);
  assert.equal((await stats.get()).get('acceptedSeeds'),1);
  assert.equal((await progress.get()).get('acceptedSeeds'),1);
  await control.update({status:'open',revision:3});
  assert.equal((await seed(second)).status,'accepted');
  assert.equal((await stats.get()).get('acceptedSeeds'),2);
  assert.equal((await ledger(author).get()).size,0);
 }finally{
  await Promise.all([control.delete(),post.delete(),stats.delete(),progress.delete(),receipt(first).delete(),receipt(second).delete(),quota(first).delete(),quota(second).delete()]);
  if(oldPilot===undefined)delete process.env.KYRUB_SEMEADURA_ECONOMIC_PILOT;else process.env.KYRUB_SEMEADURA_ECONOMIC_PILOT=oldPilot;
  if(oldGate===undefined)delete process.env.KYRUB_SEMEADURA_RELEASE_CONTROL_PILOT;else process.env.KYRUB_SEMEADURA_RELEASE_CONTROL_PILOT=oldGate;
 }
});


test('release pause at the economic milestone preserves the entire transaction and resumes exactly once',async()=>{
 const {seedReleaseControlledPost}=await import('../server/gamification/semeaduraService.js');
 const {SEMEADURA_RELEASE_CONTROL_PATH}=await import('../server/gamification/semeaduraReleaseControl.js');
 const {readPitangaAccount}=await import('../server/gamification/pitangaAccountService.js');
 const {createHash}=await import('node:crypto');
 const {semeaduraDay}=await import('../shared/semeaduraDailyLimit.js');
 const signed=await googleSignIn('release-milestone-author');
 const uid=signed.localId;
 await waitForAward(uid);
 const postId='release-milestone-post', actor='release-milestone-voter';
 const key=createHash('sha256').update('personal\0'+postId).digest('hex');
 const root=db.collection('users').doc(uid);
 const control=db.doc(SEMEADURA_RELEASE_CONTROL_PATH);
 const post=db.doc('social_posts/'+postId);
 const stats=db.doc('semeadura_post_stats/'+key);
 const receipt=stats.collection('receipts').doc(actor);
 const progress=root.collection('semeaduraProgress').doc('summary');
 const enrollment=root.collection('semeaduraEconomicPilot').doc('activation');
 const credit=root.collection('rewardLedger').doc('earn_semeadura_1');
 const quota=db.doc('users/'+actor+'/semeaduraDailyUsage/'+semeaduraDay(new Date()));
 const oldPilot=process.env.KYRUB_SEMEADURA_ECONOMIC_PILOT;
 const oldGate=process.env.KYRUB_SEMEADURA_RELEASE_CONTROL_PILOT;
 const seed=()=>seedReleaseControlledPost(db,{authenticatedUserId:actor,kind:'personal',postId});
 const before=await readPitangaAccount(db,uid);
 const now=new Date().toISOString();
 try{
  process.env.KYRUB_SEMEADURA_ECONOMIC_PILOT='true';
  process.env.KYRUB_SEMEADURA_RELEASE_CONTROL_PILOT='true';
  // Synthetic boundary only; no historical migration and no 999 real receipts.
  await Promise.all([
   post.set({postId,authorId:uid,visibility:'public',publicationType:'feed'}),
   stats.set({kind:'personal',postId,authorId:uid,communityId:'',acceptedSeeds:999,closed:false,createdAt:now,updatedAt:now}),
   progress.set({authorId:uid,acceptedSeeds:999,pitangueiras:0,createdAt:now,updatedAt:now}),
   enrollment.set({schemaVersion:1,authorId:uid,epoch,acceptedSeeds:999,creditedPitangas:0}),
   control.set({schemaVersion:1,projectId,epoch,mode:'isolated-pilot',status:'paused',revision:1,opensAt:now}),
  ]);
  const unchanged=async()=>{
   assert.equal((await stats.get()).get('acceptedSeeds'),999);
   assert.equal((await progress.get()).get('acceptedSeeds'),999);
   assert.equal((await enrollment.get()).get('acceptedSeeds'),999);
   assert.equal((await enrollment.get()).get('creditedPitangas'),0);
   assert.equal((await receipt.get()).exists,false);
   assert.equal((await credit.get()).exists,false);
   assert.equal((await quota.get()).exists,false);
   assert.deepEqual(await readPitangaAccount(db,uid),before);
  };
  await assert.rejects(seed(),/SEMEADURA_RELEASE_UNAVAILABLE/);
  await unchanged();
  await control.update({status:'open',revision:2});
  delete process.env.KYRUB_SEMEADURA_ECONOMIC_PILOT;
  await assert.rejects(seed(),/SEMEADURA_RELEASE_UNAVAILABLE/);
  await unchanged();
  process.env.KYRUB_SEMEADURA_ECONOMIC_PILOT='true';
  const results=await Promise.all([seed(),seed()]);
  assert.equal(results.filter(r=>r.status==='accepted').length,1);
  assert.equal(results.filter(r=>r.status==='already_seeded').length,1);
  assert.equal((await stats.get()).get('acceptedSeeds'),1000);
  assert.equal((await progress.get()).get('acceptedSeeds'),1000);
  assert.equal((await enrollment.get()).get('creditedPitangas'),1);
  assert.equal((await credit.get()).get('deltaKCoins'),1);
  assert.equal((await quota.get()).get('count'),1);
  const after=await readPitangaAccount(db,uid);
  assert.equal(after.pitangas,100+1);
  assert.equal(after.xp,0);
  await control.update({status:'paused',revision:3});
  assert.equal((await seed()).status,'already_seeded');
  assert.deepEqual(await readPitangaAccount(db,uid),after);
  assert.equal((await quota.get()).get('count'),1);
 }finally{
  await Promise.all([control.delete(),post.delete(),stats.delete(),progress.delete(),enrollment.delete(),receipt.delete(),quota.delete(),credit.delete(),balance(uid).update({availableKCoins:100,updatedAt:now})]);
  if(oldPilot===undefined)delete process.env.KYRUB_SEMEADURA_ECONOMIC_PILOT;else process.env.KYRUB_SEMEADURA_ECONOMIC_PILOT=oldPilot;
  if(oldGate===undefined)delete process.env.KYRUB_SEMEADURA_RELEASE_CONTROL_PILOT;else process.env.KYRUB_SEMEADURA_RELEASE_CONTROL_PILOT=oldGate;
 }
});


test('isolated zero-start path enrolls verified author once and never silently accepts a visual-only seed',async()=>{
 const {seedEconomicallyAdmittedPost}=await import('../server/gamification/semeaduraService.js');
 const {SEMEADURA_RELEASE_CONTROL_PATH}=await import('../server/gamification/semeaduraReleaseControl.js');
 const {readPitangaAccount}=await import('../server/gamification/pitangaAccountService.js');
 const {createHash}=await import('node:crypto');
 const {semeaduraDay}=await import('../shared/semeaduraDailyLimit.js');
 const signed=await googleSignIn('zero-start-author');
 const uid=signed.localId;
 await waitForAward(uid);
 const root=db.collection('users').doc(uid);
 const control=db.doc(SEMEADURA_RELEASE_CONTROL_PATH);
 const cursor=root.collection('semeaduraEconomicPilot').doc('activation');
 const progress=root.collection('semeaduraProgress').doc('summary');
 const postId='zero-start-post', actor='zero-start-voter';
 const key=createHash('sha256').update('personal\0'+postId).digest('hex');
 const post=db.doc('social_posts/'+postId);
 const stats=db.doc('semeadura_post_stats/'+key);
 const receipt=stats.collection('receipts').doc(actor);
 const quota=db.doc('users/'+actor+'/semeaduraDailyUsage/'+semeaduraDay(new Date()));
 const prior=Object.fromEntries(['KYRUB_SEMEADURA_ECONOMIC_PILOT','KYRUB_SEMEADURA_RELEASE_CONTROL_PILOT','KYRUB_SEMEADURA_ZERO_START_PILOT','KYRUB_SEMEADURA_NO_WELCOME_PILOT'].map(k=>[k,process.env[k]]));
 const seed=()=>seedEconomicallyAdmittedPost(db,{authenticatedUserId:actor,kind:'personal',postId},auth);
 const before=await readPitangaAccount(db,uid);
 try{
  for(const k of Object.keys(prior))process.env[k]='true';
  await control.set({schemaVersion:1,projectId,epoch,mode:'isolated-pilot',status:'open',revision:1,opensAt:new Date(Date.now()-60000).toISOString()});
  await post.set({postId,authorId:uid,visibility:'public',publicationType:'feed'});
  // The HTTP mutation adapter cannot accept a visual-only seed, even with
  // the release document open and a valid author balance.
  for(const flag of ['KYRUB_SEMEADURA_ZERO_START_PILOT','KYRUB_SEMEADURA_NO_WELCOME_PILOT']){
   delete process.env[flag];
   await assert.rejects(seed(),/SEMEADURA_RELEASE_UNAVAILABLE/);
   for(const ref of [receipt,stats,cursor,progress,quota])assert.equal((await ref.get()).exists,false);
   assert.deepEqual(await readPitangaAccount(db,uid),before);
   process.env[flag]='true';
  }
  // Preview age enforcement must deny both an ineligible actor and an
  // ineligible beneficiary before any quota, receipt or balance mutation.
  const actorAge=db.doc('age_eligibility_private/'+actor);
  const authorAge=db.doc('age_eligibility_private/'+uid);
  const oldAgeFlag=process.env.KYRUB_SEMEADURA_AGE_PREVIEW_ENABLED;
  process.env.KYRUB_SEMEADURA_AGE_PREVIEW_ENABLED='true';
  try{
   await assert.rejects(seed(),/SEMEADURA_AGE_REQUIRED/);
   await actorAge.set({uid:actor,status:'verified_adult'});
   await authorAge.set({uid,status:'inconclusive'});
   await assert.rejects(seed(),/SEMEADURA_AGE_REQUIRED/);
   await authorAge.set({uid,status:'verified_adult'});
   for(const status of ['declared_adult','declared_underage','verified_underage','inconclusive','suspended']){
    await actorAge.set({uid:actor,status});
    await assert.rejects(seed(),/SEMEADURA_AGE_REQUIRED/);
   }
   for(const ref of [receipt,stats,cursor,progress,quota])assert.equal((await ref.get()).exists,false);
   assert.deepEqual(await readPitangaAccount(db,uid),before);
  }finally{
   if(oldAgeFlag===undefined)delete process.env.KYRUB_SEMEADURA_AGE_PREVIEW_ENABLED;
   else process.env.KYRUB_SEMEADURA_AGE_PREVIEW_ENABLED=oldAgeFlag;
   await Promise.all([actorAge.delete(),authorAge.delete()]);
  }
  // Unexpected existing progress is a blocker, not an instruction to migrate.
  await progress.set({authorId:uid,acceptedSeeds:1,pitangueiras:0});
  await assert.rejects(seed(),/SEMEADURA_ECONOMIC_ZERO_START_REQUIRED/);
  assert.equal((await cursor.get()).exists,false);
  assert.equal((await quota.get()).exists,false);
  await progress.delete();
  await balance(uid).update({availableKCoins:101});
  await assert.rejects(seed(),/SEMEADURA_ECONOMIC_BALANCE_CONFLICT/);
  assert.equal((await receipt.get()).exists,false);
  assert.equal((await stats.get()).exists,false);
  assert.equal((await cursor.get()).exists,false);
  await balance(uid).update({availableKCoins:100});
  // A verified actor and verified beneficiary can complete the unchanged
  // economic transaction, including concurrent replay, with the gate active.
  await Promise.all([actorAge.set({uid:actor,status:'verified_adult'}),authorAge.set({uid,status:'verified_adult'})]);
  process.env.KYRUB_SEMEADURA_AGE_PREVIEW_ENABLED='true';
  let results:Awaited<ReturnType<typeof seed>>[];
  try{results=await Promise.all([seed(),seed()]);}
  finally{
   if(oldAgeFlag===undefined)delete process.env.KYRUB_SEMEADURA_AGE_PREVIEW_ENABLED;
   else process.env.KYRUB_SEMEADURA_AGE_PREVIEW_ENABLED=oldAgeFlag;
   await Promise.all([actorAge.delete(),authorAge.delete()]);
  }
  assert.equal(results.filter(r=>r.status==='accepted').length,1);
  assert.equal(results.filter(r=>r.status==='already_seeded').length,1);
  assert.equal((await cursor.get()).get('acceptedSeeds'),1);
  assert.equal((await cursor.get()).get('creditedPitangas'),0);
  assert.equal((await progress.get()).get('acceptedSeeds'),1);
  assert.equal((await quota.get()).get('count'),1);
  assert.deepEqual(await readPitangaAccount(db,uid),before);
 }finally{
  await Promise.all([control.delete(),cursor.delete(),progress.delete(),post.delete(),stats.delete(),receipt.delete(),quota.delete(),balance(uid).update({availableKCoins:100})]);
  for(const [k,v] of Object.entries(prior)){if(v===undefined)delete process.env[k];else process.env[k]=v;}
 }
});


test('non-Google author starts at zero without welcome bonus and earns a single milestone Pitanga',async()=>{
 const {seedEconomicallyAdmittedPost}=await import('../server/gamification/semeaduraService.js');
 const {SEMEADURA_RELEASE_CONTROL_PATH}=await import('../server/gamification/semeaduraReleaseControl.js');
 const {readPitangaAccount,convertPitangaAccount}=await import('../server/gamification/pitangaAccountService.js');
 const {createHash}=await import('node:crypto');
 const {semeaduraDay}=await import('../shared/semeaduraDailyLimit.js');
 const user=await auth.createUser({email:'no-welcome-author@example.invalid',password:'fixture-only-password'});
 const uid=user.uid,root=db.collection('users').doc(uid);
 const registration=root.collection('authEvents').doc('semeadura_non_google_registration_v1');
 const deadline=Date.now()+60000;
 while(!(await registration.get()).exists&&Date.now()<deadline)await delay(100);
 const evidence=(await registration.get()).data();
 assert.equal(evidence?.source,'trusted_auth_on_create_non_google');
 assert.equal((await balance(uid).get()).exists,false);
 assert.equal((await ledger(uid).get()).size,0);
 const postId='no-welcome-milestone-post',actor='no-welcome-voter';
 const key=createHash('sha256').update('personal\0'+postId).digest('hex');
 const post=db.doc('social_posts/'+postId),stats=db.doc('semeadura_post_stats/'+key);
 const control=db.doc(SEMEADURA_RELEASE_CONTROL_PATH);
 const cursor=root.collection('semeaduraEconomicPilot').doc('activation');
 const progress=root.collection('semeaduraProgress').doc('summary');
 const bootstrap=root.collection('pitangaMigration').doc('receipt');
 const credit=root.collection('rewardLedger').doc('earn_semeadura_1');
 const receipt=(v:string)=>stats.collection('receipts').doc(v);
 const quota=(v:string)=>db.doc('users/'+v+'/semeaduraDailyUsage/'+semeaduraDay(new Date()));
 const conversionFlag=process.env.KYRUB_PITANGA_XP_CONVERSION_ENABLED;
 const fixtureCredit=root.collection('rewardLedger').doc('fixture_conversion_boundary');
 const conversionId='no-welcome-conversion';
 const conversionReceipt=root.collection('pitangaXpConversions').doc(conversionId);
 const conversionDebit=root.collection('rewardLedger').doc('conversion_'+conversionId);
 const conversionXp=root.collection('xpLedger').doc('conversion_'+conversionId);
 const prior=Object.fromEntries(['KYRUB_SEMEADURA_ECONOMIC_PILOT','KYRUB_SEMEADURA_RELEASE_CONTROL_PILOT','KYRUB_SEMEADURA_ZERO_START_PILOT','KYRUB_SEMEADURA_NO_WELCOME_PILOT'].map(k=>[k,process.env[k]]));
 const seed=(v:string)=>seedEconomicallyAdmittedPost(db,{authenticatedUserId:v,kind:'personal',postId},auth);
 try{
  for(const k of Object.keys(prior))process.env[k]='true';
  await control.set({schemaVersion:1,projectId,epoch,mode:'isolated-pilot',status:'open',revision:1,opensAt:new Date(Date.now()-60000).toISOString()});
  await post.set({postId,authorId:uid,visibility:'public',publicationType:'feed'});
  await registration.delete();
  await assert.rejects(seed(actor),/SEMEADURA_NO_WELCOME_UNVERIFIED/);
  assert.equal((await balance(uid).get()).exists,false);
  assert.equal((await receipt(actor).get()).exists,false);
  assert.equal((await quota(actor).get()).exists,false);
  await registration.set(evidence!);
  const outcomes=await Promise.all([seed(actor),seed(actor)]);
  assert.equal(outcomes.filter(r=>r.status==='accepted').length,1);
  assert.equal((await balance(uid).get()).get('availableKCoins'),0);
  assert.equal((await bootstrap.get()).get('entryCount'),0);
  assert.equal((await cursor.get()).get('currencyAuthority'),'zero-history');
  assert.equal((await cursor.get()).get('acceptedSeeds'),1);
  assert.equal((await ledger(uid).get()).size,0);
  // Synthetic boundary fixture, not historical migration.
  await Promise.all([cursor.update({acceptedSeeds:999}),progress.update({acceptedSeeds:999}),stats.update({acceptedSeeds:999})]);
  const final=await Promise.all([seed('no-welcome-final'),seed('no-welcome-final')]);
  assert.equal(final.filter(r=>r.status==='accepted').length,1);
  const account=await readPitangaAccount(db,uid);
  assert.equal(account.pitangas,1);
  assert.equal(account.xp,0);
  assert.equal((await credit.get()).get('deltaKCoins'),1);
  assert.equal((await root.collection('rewardLedger').doc('earn_first_login_welcome_v1').get()).exists,false);
  assert.equal((await cursor.get()).get('creditedPitangas'),1);
  process.env.KYRUB_PITANGA_XP_CONVERSION_ENABLED='true';
  await assert.rejects(convertPitangaAccount(db,uid,{requestId:conversionId,requestedXp:1}));
  assert.deepEqual(await readPitangaAccount(db,uid),account);
  assert.equal((await conversionReceipt.get()).exists,false);
  assert.equal((await conversionDebit.get()).exists,false);
  assert.equal((await conversionXp.get()).exists,false);
  // Disposable synthetic balance boundary only, not a product reward.
  // Reuse the canonical conversion, never introduce a second debit writer.
  const occurredAt=new Date(Date.now()-60000).toISOString();
  await db.runTransaction(async tx=>{
   tx.create(fixtureCredit,{id:fixtureCredit.id,userId:uid,economy:'k_coin',type:'earn',
    deltaKCoins:999,sourceType:'admin_adjustment',sourceId:'fixture_conversion_boundary',
    correlationId:'fixture_conversion_boundary',idempotencyKey:'fixture_conversion_boundary',occurredAt});
   tx.update(balance(uid),{availableKCoins:1000});
  });
  const conversions=await Promise.all([convertPitangaAccount(db,uid,{requestId:conversionId,requestedXp:1}),
   convertPitangaAccount(db,uid,{requestId:conversionId,requestedXp:1})]);
  assert.equal(conversions.filter(r=>!r.replay).length,1);
  assert.equal(conversions.filter(r=>r.replay).length,1);
  const converted=await readPitangaAccount(db,uid);
  assert.equal(converted.pitangas,0);assert.equal(converted.xp,1);
  assert.equal((await conversionDebit.get()).get('deltaKCoins'),-1000);
  assert.equal((await conversionXp.get()).get('deltaXp'),1);
  assert.equal((await cursor.get()).get('acceptedSeeds'),1000);
  assert.equal((await cursor.get()).get('creditedPitangas'),1);
 }finally{
  if(conversionFlag===undefined)delete process.env.KYRUB_PITANGA_XP_CONVERSION_ENABLED;
  else process.env.KYRUB_PITANGA_XP_CONVERSION_ENABLED=conversionFlag;
  await Promise.all([fixtureCredit.delete(),conversionReceipt.delete(),conversionDebit.delete(),conversionXp.delete()]);
  await Promise.all([control.delete(),post.delete(),stats.delete(),cursor.delete(),progress.delete(),bootstrap.delete(),credit.delete(),balance(uid).delete(),receipt(actor).delete(),receipt('no-welcome-final').delete(),quota(actor).delete(),quota('no-welcome-final').delete()]);
  for(const [k,v] of Object.entries(prior)){if(v===undefined)delete process.env[k];else process.env[k]=v;}
 }
});


test('administrative pause and resume require authorized reviewer, immutable audit and current revision',async()=>{
 const {readIsolatedGamificationRelease,changeIsolatedGamificationRelease}=await import('../server/gamification/semeaduraAdminSupervision.js');
 const {seedEconomicallyAdmittedPost}=await import('../server/gamification/semeaduraService.js');
 const admin=await googleSignIn('release-admin-authority'),ordinary=await googleSignIn('release-admin-ordinary');
 await Promise.all([waitForAward(admin.localId),waitForAward(ordinary.localId)]);
 const profile=db.doc('kyrub_admin/control_plane/admins/'+admin.localId);
 const reviewer=db.doc('systemControl/semeaduraEconomicReview/reviewers/'+admin.localId);
 const control=db.doc('systemControl/semeaduraReleasePilot');
 const keys=['KYRUB_SEMEADURA_ECONOMIC_PILOT','KYRUB_SEMEADURA_RELEASE_CONTROL_PILOT','KYRUB_SEMEADURA_ZERO_START_PILOT','KYRUB_SEMEADURA_NO_WELCOME_PILOT','KYRUB_GAMIFICATION_ADMIN_RELEASE_WRITE_PILOT'];
 const prior=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 const authz='Bearer '+admin.idToken;
 const pause={eventId:'admin-pause',expectedRevision:1,status:'paused' as const,reason:'Interrupção operacional de homologação'};
 const resume={eventId:'admin-resume',expectedRevision:2,status:'open' as const,reason:'Retomada operacional de homologação'};
 const refs=[pause.eventId,resume.eventId,'admin-competing-pause'].map(id=>control.collection('events').doc(id));
 const opensAt=new Date(Date.now()-60000).toISOString();
 const postId='admin-controlled-release-post';
 const post=db.doc('social_posts/'+postId);
 const {createHash}=await import('node:crypto');
 const key=createHash('sha256').update('personal\0'+postId).digest('hex');
 const stats=db.doc('semeadura_post_stats/'+key);
 const actor=admin.localId,author=ordinary.localId;
 const progress=db.doc('users/'+author+'/semeaduraProgress/summary');
 const cursor=db.doc('users/'+author+'/semeaduraEconomicPilot/activation');
 const {semeaduraDay}=await import('../shared/semeaduraDailyLimit.js');
 const quota=db.doc('users/'+actor+'/semeaduraDailyUsage/'+semeaduraDay(new Date()));
 const seed=()=>seedEconomicallyAdmittedPost(db,{authenticatedUserId:actor,kind:'personal',postId},auth);
 const change=(cmd:typeof pause|typeof resume)=>changeIsolatedGamificationRelease(db,auth,authz,cmd);
 try{
  for(const k of keys)process.env[k]='true';
  await profile.set({uid:admin.localId,role:'super_admin',status:'active'});
  await reviewer.set({schemaVersion:1,reviewerId:admin.localId,active:true,fixtureOnly:true});
  await control.set({schemaVersion:1,projectId,epoch,mode:'isolated-pilot',status:'open',revision:1,opensAt});
  await post.set({postId,authorId:author,visibility:'public',publicationType:'feed'});
  await assert.rejects(changeIsolatedGamificationRelease(db,auth,'Bearer '+ordinary.idToken,pause),/GAMIFICATION_SUPERVISION_FORBIDDEN/);
  delete process.env.KYRUB_GAMIFICATION_ADMIN_RELEASE_WRITE_PILOT;
  await assert.rejects(change(pause),/GAMIFICATION_SUPERVISION_DISABLED/);
  process.env.KYRUB_GAMIFICATION_ADMIN_RELEASE_WRITE_PILOT='true';
  const results=await Promise.allSettled([change(pause),change({...pause,eventId:'admin-competing-pause'})]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results.filter(r=>r.status==='rejected').length,1);
  const winner=(await control.get()).get('lastEventId');
  const original=winner===pause.eventId?pause:{...pause,eventId:winner};
  assert.equal((await change(original)).replayed,true);
  await assert.rejects(change({...original,reason:'Motivo divergente não autorizado'}),/RELEASE_CONTROL_EVENT_CONFLICT/);
  await assert.rejects(seed(),/SEMEADURA_RELEASE_UNAVAILABLE/);
  for(const ref of [stats,progress,cursor,quota])assert.equal((await ref.get()).exists,false);
  delete process.env.KYRUB_SEMEADURA_ZERO_START_PILOT;
  await assert.rejects(change(resume),/RELEASE_CONTROL_RESUME_BLOCKED/);
  process.env.KYRUB_SEMEADURA_ZERO_START_PILOT='true';
  assert.equal((await change(resume)).revision,3);
  assert.equal((await change(original)).status,'open','Replay reports current state, not old pause');
  assert.equal((await seed()).status,'accepted');
  const view=await readIsolatedGamificationRelease(db,auth,authz);
  assert.deepEqual(view,{environment:'isolated-emulator',configured:true,status:'open',revision:3,opensAt});
  await reviewer.update({active:false});
  await assert.rejects(change(original),/GAMIFICATION_SUPERVISION_FORBIDDEN/);
  assert.equal((await balance(author).get()).get('availableKCoins'),100);
 }finally{
  await Promise.all([profile.delete(),reviewer.delete(),control.delete(),...refs.map(ref=>ref.delete()),post.delete(),stats.collection('receipts').doc(actor).delete(),stats.delete(),progress.delete(),cursor.delete(),quota.delete()]);
  for(const [k,v] of Object.entries(prior)){if(v===undefined)delete process.env[k];else process.env[k]=v;}
 }
});

test('isolated saved profile award authenticates actor, credits once under concurrency and projects completion in existing catalog',async()=>{
 const {reconcileIsolatedProfileCompletionAfterSave}=await import('../server/gamification/profileCompletionAwardPilot.js');
 const {readUserPlatformChallengeCatalog}=await import('../server/gamification/userPlatformChallengeCatalogService.js');
 const {readPitangaAccount}=await import('../server/gamification/pitangaAccountService.js');
 const {reserveSocialAddressInDatabase,getOwnedSocialAddressInDatabase,resolveSocialAddressInDatabase}=await import('../server/identity/publicSocialAddressService.js');
 const {PROFILE_COMPLETION_CHALLENGE}=await import('../shared/profileCompletionChallenge.js');
 const person=await googleSignIn('profile-completion-journey');
 const uid=person.localId,challenge=PROFILE_COMPLETION_CHALLENGE.id;
 await waitForAward(uid);
 const account=db.doc('users/'+uid),profile=account.collection('public_profile').doc('main');
 const age=db.doc('age_eligibility_private/'+uid),definition=db.doc('global_challenges/'+challenge);
 const identifier='profile-completion-journey';
 const forward=db.doc('public_social_addresses/profile:'+identifier),reverse=db.doc('public_social_address_targets/profile:'+uid);
 const receipt=account.collection('challengeRewards').doc(challenge),award=ledger(uid).doc('earn_'+challenge);
 const savedDefinition=await definition.get(),prior=process.env.KYRUB_PROFILE_COMPLETION_PILOT;
 const run=()=>reconcileIsolatedProfileCompletionAfterSave(db,auth,person.idToken);
 const express=(await import('express')).default;
 const {createProfileCompletionEmulatorRouter}=await import('../server/gamification/profileCompletionEmulatorRouter.js');
 const http=express();
 http.use(express.json());
 http.use('/api',createProfileCompletionEmulatorRouter(db,auth));
 const listener=http.listen(0,'127.0.0.1');
 await new Promise<void>((resolve,reject)=>{listener.once('listening',resolve);listener.once('error',reject);});
 const address=listener.address();
 assert.ok(address&&typeof address!=='string');
 const url='http://127.0.0.1:'+address.port+'/api/profile-completion-pilot';
 const request=(body:unknown={},token=person.idToken)=>fetch(url,{method:'POST',
  headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body)});
 try{
  delete process.env.KYRUB_PROFILE_COMPLETION_PILOT;
  await assert.rejects(run(),/RELEASE_UNAVAILABLE/);
  assert.equal((await request()).status,404);
  process.env.KYRUB_PROFILE_COMPLETION_PILOT='true';
  await assert.rejects(reconcileIsolatedProfileCompletionAfterSave(db,auth,'invalid'),/AUTH_INVALID/);
  assert.equal((await request({},'invalid')).status,401);
  assert.equal((await request({uid:'other',amount:1000})).status,400);
  assert.equal((await fetch(url)).status,405);
  await definition.set({...PROFILE_COMPLETION_CHALLENGE,status:'active'});
  await age.set({uid,status:'verified_adult'});
  await account.set({name:'Perfil de teste',isProfileVisible:false},{merge:true});
  await profile.set({userId:uid,name:'Perfil de teste',bio:'Apresentação fictícia'});
  const before=await readUserPlatformChallengeCatalog(db,uid);
  assert.equal(before.challenges.find(c=>c.id===challenge)?.status,'available');
  assert.equal((await balance(uid).get()).get('availableKCoins'),100);
  await assert.rejects(run(),/NOT_ELIGIBLE/);
  assert.deepEqual(await (await request()).json(),{status:'pending'});
  const reservation={kind:'profile',identifier,targetId:uid};
  // Deliberately corrupt indices to prove rejection, then remove them and reserve via the canonical transaction.
  await reverse.set(reservation);
  await assert.rejects(run(),/NOT_ELIGIBLE/);
  await forward.set({...reservation,targetId:'other'});
  await assert.rejects(run(),/NOT_ELIGIBLE/);
  await forward.delete();
  await reverse.delete();
  assert.deepEqual(await reserveSocialAddressInDatabase(db,uid,'profile',identifier),{kind:'profile',identifier});
  assert.deepEqual(await reserveSocialAddressInDatabase(db,uid,'profile',identifier),{kind:'profile',identifier});
  await assert.rejects(reserveSocialAddressInDatabase(db,uid,'profile','another-identifier'),/PUBLIC_ADDRESS_CONFLICT/);
  assert.deepEqual(await getOwnedSocialAddressInDatabase(db,uid,'profile'),{identifier,eligible:true,publiclyVisible:false});
  assert.equal(await resolveSocialAddressInDatabase(db,'profile',identifier),null);
  const responses=await Promise.all([request(),request()]);
  assert.ok(responses.every(r=>r.ok));
  const results=await Promise.all(responses.map(r=>r.json()));
  assert.deepEqual(results.map(r=>r.status).sort(),['already_completed','completed']);
  assert.equal((await balance(uid).get()).get('availableKCoins'),200);
  assert.equal((await award.get()).get('deltaKCoins'),100);
  assert.equal((await receipt.get()).get('xp'),0);
  const statement=await readPitangaAccount(db,uid);
  assert.equal(statement.pitangas,200);assert.equal(statement.xp,0);
  const after=await readUserPlatformChallengeCatalog(db,uid);
  const completed=after.challenges.find(c=>c.id===challenge);
  assert.equal(completed?.status,'completed');assert.equal(completed?.completionsConfirmed,1);
  assert.equal((await account.get()).get('isProfileVisible'),false);
  await profile.update({bio:'Apresentação editada'});
  assert.equal((await run()).replay,true);
  assert.equal((await balance(uid).get()).get('availableKCoins'),200);
  await auth.updateUser(uid,{disabled:true});
  await assert.rejects(run(),/AUTH_INVALID/);
 }finally{
  await new Promise<void>((resolve,reject)=>listener.close(error=>error?reject(error):resolve()));
  await Promise.all([profile.delete(),age.delete(),forward.delete(),reverse.delete(),receipt.delete(),award.delete(),
   balance(uid).update({availableKCoins:100}),auth.updateUser(uid,{disabled:false})]);
  if(savedDefinition.exists)await definition.set(savedDefinition.data()!);else await definition.delete();
  if(prior===undefined)delete process.env.KYRUB_PROFILE_COMPLETION_PILOT;else process.env.KYRUB_PROFILE_COMPLETION_PILOT=prior;
 }
});

test('canonical private identifier reservation has exactly one owner under competing transactions',async()=>{
 const {reserveSocialAddressInDatabase,getOwnedSocialAddressInDatabase,resolveSocialAddressInDatabase}=await import('../server/identity/publicSocialAddressService.js');
 const first='profile-reserve-actor-one',second='profile-reserve-actor-two',identifier='profile-reserve-race';
 const accounts=[first,second].map(uid=>db.doc('users/'+uid));
 const mappings=[db.doc('public_social_addresses/profile:'+identifier),...([first,second].map(uid=>db.doc('public_social_address_targets/profile:'+uid)))];
 try{
  await Promise.all(accounts.map((r,i)=>r.set({name:'Pessoa '+i,isProfileVisible:false})));
  const results=await Promise.allSettled([first,second].map(uid=>reserveSocialAddressInDatabase(db,uid,'profile',identifier)));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  const loser=results.find(r=>r.status==='rejected');
  assert.ok(loser&&loser.status==='rejected'&&/PUBLIC_ADDRESS_CONFLICT/.test(String(loser.reason)));
  const winner=(await mappings[0].get()).get('targetId');
  assert.ok(winner===first||winner===second);
  const other=winner===first?second:first;
  assert.deepEqual(await getOwnedSocialAddressInDatabase(db,winner,'profile'),{identifier,eligible:true,publiclyVisible:false});
  assert.deepEqual(await getOwnedSocialAddressInDatabase(db,other,'profile'),{identifier:null,eligible:true,publiclyVisible:false});
  assert.equal(await resolveSocialAddressInDatabase(db,'profile',identifier),null);
 }finally{await Promise.all([...accounts,...mappings].map(r=>r.delete()));}
});

test('staff directory HTTP pilot authenticates actor, protects reserved target and limits enumeration',async()=>{
 const {createStaffDirectoryEmulatorRouter}=await import('../server/identity/storeStaffDirectoryEmulatorRouter.js');
 const express=(await import('express')).default;
 const owner=await googleSignIn('staff-http-owner'),target=await googleSignIn('staff-http-target');
 const outsider=await googleSignIn('staff-http-outsider'),spoof=await googleSignIn('staff-http-spoof');
 await Promise.all([owner,target,outsider,spoof].map(person=>waitForAward(person.localId)));
 const storeId='staff-http-isolated-store',store=db.doc('stores/'+storeId);
 const targetRef=db.doc('users/'+target.localId),member=store.collection('members').doc(target.localId);
 const spoofRef=db.doc('users/'+spoof.localId),spoofMember=store.collection('members').doc(spoof.localId);
 const prior=process.env.KYRUB_STAFF_DIRECTORY_PILOT;
 const http=express();http.use(express.json({limit:'8kb'}));http.use('/api',createStaffDirectoryEmulatorRouter(db,auth));
 const listener=http.listen(0,'127.0.0.1');
 await new Promise<void>((resolve,reject)=>{listener.once('listening',resolve);listener.once('error',reject);});
 const address=listener.address();assert.ok(address&&typeof address!=='string');
 const baseUrl='http://127.0.0.1:'+address.port+'/api/staff-directory-pilot/';
 const body={storeId,term:'staff-http-target@example.invalid',role:'seller'};
 const post=(operation:string,input:unknown=body,token=owner.idToken)=>fetch(baseUrl+operation,{method:'POST',
  headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(input)});
 try{
  await store.set({id:storeId,ownerId:owner.localId,name:'Loja isolada'});
  await targetRef.set({uid:target.localId,email:'outdated-staff@example.invalid',name:'Nome reservado',isProfileVisible:false},{merge:true});
  await spoofRef.set({uid:spoof.localId,email:body.term,name:'Conta imitadora',isProfileVisible:true},{merge:true});
  delete process.env.KYRUB_STAFF_DIRECTORY_PILOT;
  assert.equal((await post('search')).status,404);
  process.env.KYRUB_STAFF_DIRECTORY_PILOT='true';
  assert.equal((await fetch(baseUrl+'search')).status,405);
  assert.equal((await post('search',body,'invalid')).status,401);
  assert.equal((await post('search',{...body,actorUid:owner.localId})).status,400);
  assert.equal((await post('search',body,outsider.idToken)).status,403);
  const search=await post('search');assert.equal(search.status,200);
  assert.equal(search.headers.get('cache-control'),'private, no-store');
  assert.deepEqual(await search.json(),{entries:[{uid:target.localId,name:'Conta Kyrub',photoUrl:''}]});
  assert.equal((await post('invite',{...body,targetUid:spoof.localId})).status,403);
  assert.equal((await spoofMember.get()).exists,false);
  await auth.updateUser(target.localId,{emailVerified:false});
  assert.deepEqual(await (await post('search')).json(),{entries:[]});
  assert.equal((await post('invite',{...body,targetUid:target.localId})).status,403);
  await auth.updateUser(target.localId,{emailVerified:true});
  const inviteBody={...body,targetUid:target.localId};
  const invited=await post('invite',inviteBody);assert.equal(invited.status,201);
  assert.deepEqual(await invited.json(),{status:'invited',userId:target.localId});
  assert.equal((await post('invite',inviteBody)).status,409);
  const record=(await member.get()).data()!;
  assert.equal(record.status,'invited');assert.equal(record.email,'');assert.equal(record.invitedBy,owner.localId);
  for(let i=0;i<5;i++)assert.equal((await post('search')).status,200);
  const limited=await post('search');assert.equal(limited.status,429);assert.ok(limited.headers.get('retry-after'));
  await auth.updateUser(outsider.localId,{disabled:true});
  assert.equal((await post('search',body,outsider.idToken)).status,401);
 }finally{
  await new Promise<void>((resolve,reject)=>listener.close(error=>error?reject(error):resolve()));
  await Promise.all([member.delete(),spoofMember.delete(),store.delete(),auth.updateUser(outsider.localId,{disabled:false}),auth.updateUser(target.localId,{emailVerified:true}),targetRef.update({email:body.term}),spoofRef.update({email:'staff-http-spoof@example.invalid',isProfileVisible:false})]);
  if(prior===undefined)delete process.env.KYRUB_STAFF_DIRECTORY_PILOT;else process.env.KYRUB_STAFF_DIRECTORY_PILOT=prior;
 }
});

test('social directory HTTP pilot authenticates, paginates and hydrates only explicitly visible identities',async()=>{
 const {createSocialDirectoryEmulatorRouter}=await import('../server/identity/socialDirectoryEmulatorRouter.js');
 const express=(await import('express')).default;
 const actor=await googleSignIn('social-directory-http-actor');
 await waitForAward(actor.localId);
 const visible='social-http-visible-fixture',hidden='social-http-hidden-fixture';
 const prior=process.env.KYRUB_SOCIAL_DIRECTORY_PILOT,priorNodeEnv=process.env.NODE_ENV;
 const visibleRef=db.doc('users/'+visible),hiddenRef=db.doc('users/'+hidden);
 const http=express();http.use(express.json({limit:'8kb'}));http.use('/api',createSocialDirectoryEmulatorRouter(db,auth));
 const listener=http.listen(0,'127.0.0.1');
 await new Promise<void>((resolve,reject)=>{listener.once('listening',resolve);listener.once('error',reject);});
 const address=listener.address();assert.ok(address&&typeof address!=='string');
 const url='http://127.0.0.1:'+address.port+'/api/social-directory-pilot/';
 const post=(op:string,body:unknown={},token=actor.idToken)=>fetch(url+op,{method:'POST',
 headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body)});
 try{
  await visibleRef.set({uid:visible,name:'Nome público',photoUrl:'https://example.invalid/photo',isProfileVisible:true,email:'private@example.invalid',cpf:'fixture'});
  await hiddenRef.set({uid:hidden,name:'Nome reservado',photoUrl:'https://example.invalid/hidden',isProfileVisible:false,email:'hidden@example.invalid'});
  process.env.NODE_ENV='test';
  delete process.env.KYRUB_SOCIAL_DIRECTORY_PILOT;
  assert.equal((await post('page')).status,404);
  process.env.KYRUB_SOCIAL_DIRECTORY_PILOT='true';
  assert.equal((await post('page',{},'invalid')).status,401);
  assert.equal((await post('page',{actorUid:visible})).status,400);
  const page=await post('page',{after:'social-http-hidden-fixture'});assert.equal(page.status,200);
  assert.equal(page.headers.get('cache-control'),'private, no-store');
  const results=await page.json();
  assert.ok(results.entries.some((entry:any)=>entry.id===visible));
  assert.ok(results.entries.every((entry:any)=>Object.keys(entry).sort().join(',')==='id,isProfileVisible,name,photoUrl'));
  const authors=await post('authors',{authorIds:[visible,hidden,visible]});
  assert.equal(authors.status,200);
  assert.deepEqual(await authors.json(),{entries:[{id:visible,name:'Nome público',avatar:'https://example.invalid/photo'}]});
  assert.equal((await post('authors',{authorIds:Array(41).fill(visible)})).status,400);
  await visibleRef.update({isProfileVisible:false});
  assert.deepEqual(await (await post('authors',{authorIds:[visible,hidden]})).json(),{entries:[]});
  for(let i=0;i<7;i++)assert.equal((await post('authors',{authorIds:[]})).status,200);
  assert.equal((await post('page')).status,429);
  await auth.updateUser(actor.localId,{disabled:true});
  assert.equal((await post('page')).status,401);
 }finally{
  await new Promise<void>((resolve,reject)=>listener.close(error=>error?reject(error):resolve()));
  await Promise.all([visibleRef.delete(),hiddenRef.delete(),auth.updateUser(actor.localId,{disabled:false})]);
  if(prior===undefined)delete process.env.KYRUB_SOCIAL_DIRECTORY_PILOT;else process.env.KYRUB_SOCIAL_DIRECTORY_PILOT=prior;
  if(priorNodeEnv===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=priorNodeEnv;
 }
});

test('note collaborator lookup trusts verified Auth identity and refuses reserved or spoofed accounts',async()=>{
 const {searchVisibleNoteCollaborators}=await import('../server/identity/socialDiscoveryDirectoryService.js');
 const actor=await googleSignIn('note-search-actor'),target=await googleSignIn('note-search-target'),spoof=await googleSignIn('note-search-spoof');
 await Promise.all([actor,target,spoof].map(person=>waitForAward(person.localId)));
 const targetRef=db.doc('users/'+target.localId),spoofRef=db.doc('users/'+spoof.localId);
 const term='note-search-target@example.invalid';
 const read=(value:string)=>searchVisibleNoteCollaborators(db,auth,actor.localId,value);
 try{
  await targetRef.set({uid:target.localId,name:'Colaborador homologado',email:'outdated@example.invalid',isProfileVisible:true,photoUrl:'',cpf:'fixture'},{merge:true});
  await spoofRef.set({uid:spoof.localId,name:'Conta imitadora',email:term,isProfileVisible:true,photoUrl:''},{merge:true});
  const expected=[{id:target.localId,name:'Colaborador homologado',photoUrl:'',isProfileVisible:true}];
  assert.deepEqual(await read(term),expected);
  assert.deepEqual(await read('Colaborador homologado'),expected);
  assert.deepEqual(await read('outdated@example.invalid'),[]);
  await targetRef.update({isProfileVisible:false});
  assert.deepEqual(await read(term),[]);
  assert.deepEqual(await read('Colaborador homologado'),[]);
  await targetRef.update({isProfileVisible:true});
  await auth.updateUser(target.localId,{disabled:true});
  assert.deepEqual(await read(term),[]);
  assert.deepEqual(await read('Colaborador homologado'),[]);
  await auth.updateUser(target.localId,{disabled:false,emailVerified:false});
  assert.deepEqual(await read(term),[]);
  assert.deepEqual(await read('Colaborador homologado'),[]);
  await assert.rejects(read('a@b'),/DIRECTORY_INPUT_INVALID/);
 }finally{
  await auth.updateUser(target.localId,{disabled:false,emailVerified:true});
  await Promise.all([targetRef.update({isProfileVisible:false,email:term}),spoofRef.update({isProfileVisible:false,email:'note-search-spoof@example.invalid'})]);
 }
});
