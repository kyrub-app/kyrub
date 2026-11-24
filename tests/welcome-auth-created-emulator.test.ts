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
  const { verifyFirstStorePublicationForReward } = await import('../server/gamification/firstStorePublishedVerificationService.js');
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
  const publishedAt=new Date().toISOString();
  const grant=()=>verifyFirstStorePublicationForReward(db,{userId:uid,canonicalStoreId:storeId});
  // Explicit emulator-only fixtures: provisioning is not a publication.
  await challenge.set({id:'first_store_published',title:'Primeira publicação',description:'Fixture',status:'published',validationMode:'deterministic',sponsorType:'kyrub',rewardKCoins:0,rewardXp:2,maxCompletionsPerUser:1});
  await store.set({id:storeId,ownerId:uid,publicationStatus:'draft'});
  await assert.rejects(grant(),/FIRST_STORE_PUBLICATION_UNVERIFIED/);
  assert.deepEqual(await readPitangaAccount(db,uid),first);
  // Seed the trusted publication evidence only in the emulator. This tests
  // the reward verifier, not the ERP publication transition itself.
  const batch=db.batch();
  batch.update(store,{publicationStatus:'published',firstPublishedAt:publishedAt});
  batch.set(event,{id:'first_store_published',challengeId:'first_store_published',userId:uid,storeId,status:'pending',isFirstPublication:true,publishedAt});
  batch.set(listing,{listingType:'store',storeId:uid,ownerId:uid,publicationStatus:'published'});
  await batch.commit();
  const awards=await Promise.all(Array.from({length:4},grant));
  assert.equal(awards.filter(r=>!r.replay).length,1);
  assert.equal(awards.filter(r=>r.replay).length,3);
  const afterPublication=await readPitangaAccount(db,uid);
  assert.equal(afterPublication.pitangas,100);
  assert.equal(afterPublication.xp,2);
  assert.equal(afterPublication.entries.length,2);
  assert.equal((await db.collection(`users/${uid}/challengeRewards`).get()).size,1);
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
  assert.equal(again.isNewUser,false);
  assert.deepEqual(await readPitangaAccount(db,uid),afterPublication);
});
