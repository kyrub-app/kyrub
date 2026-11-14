import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { after, test } from 'node:test';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { initializeApp, getApps } from 'firebase-admin/app';

const expectedProject = 'kyrub-security-test';
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:9099');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8088');
assert.equal(process.env.FIREBASE_PROJECT_ID, expectedProject);
assert.equal(process.env.GCLOUD_PROJECT, expectedProject);
assert.equal(process.env.GOOGLE_CLOUD_PROJECT, expectedProject);
assert.equal(process.env.KYRUB_FIRST_STORE_PUBLICATION_E2E_LOCAL, 'true');
assert.equal(process.env.NODE_ENV === 'production', false);

const app = getApps()[0] ?? initializeApp({ projectId: expectedProject });
const auth = getAuth(app);
const uid = 'publication_browser_e2e_fictional';
const user = await auth.createUser({ uid, email: 'publication-browser-e2e@example.invalid' }).catch(async (error: unknown) => {
  if ((error as { code?: string }).code === 'auth/uid-already-exists') return auth.getUser(uid);
  throw error;
});
assert.equal(user.uid, uid);

// Firebase Auth Emulator accepts its own unsigned ID tokens. Exchange a custom
// token through the emulator endpoint; never contact identitytoolkit.googleapis.com.
const customToken = await auth.createCustomToken(uid);
const signIn = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-emulator-key', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ token: customToken, returnSecureToken: true }),
});
const signInBody = await signIn.text();
assert.equal(signIn.status, 200, signInBody);
const token = (JSON.parse(signInBody) as { idToken?: string }).idToken;
assert.ok(token);
assert.equal((await auth.verifyIdToken(token)).uid, uid);

const { handleFirstStorePublication } = await import('../server/gamification/firstStorePublicationHandler.js');
const server = createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString('utf8');
  const response = {
    setHeader: (key: string, value: string) => { res.setHeader(key, value); },
    status: (code: number) => { res.statusCode = code; return response; },
    json: (payload: unknown) => { res.end(JSON.stringify(payload)); },
  };
  await handleFirstStorePublication({ method: req.method, headers: req.headers, body: raw ? JSON.parse(raw) : {} }, response);
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
after(() => server.close());
const address = server.address();
assert.ok(address && typeof address !== 'string');
const endpoint = `http://127.0.0.1:${address.port}/api/action-execute?transport=first-store-publication`;

test('emulator token reaches authenticated publication handler and rejects invalid store ID', async () => {
  const response = await fetch(endpoint, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'publish', canonicalStoreId: 'invalid/id' }),
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json() as { error: string }).error, 'INVALID_CANONICAL_STORE_ID');
});

test('emulator handler rejects missing bearer token', async () => {
  const response = await fetch(endpoint, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'publish', canonicalStoreId: 'fictional_store' }),
  });
  assert.equal(response.status, 401);
  assert.equal((await response.json() as { error: string }).error, 'AUTH_REQUIRED');
});


test('authenticated HTTP publication grants 2 XP once, no Pitangas, and survives hide/republish', async () => {
  const db = getFirestore(app);
  const canonicalStoreId = 'fictional_http_publication_store';
  const listingId = `s_${uid.length}_${uid}`;
  const challengeRef = db.doc('global_challenges/first_store_published');
  const storeRef = db.doc(`stores/${canonicalStoreId}`);
  const listingRef = db.doc(`marketplace_listings/${listingId}`);
  const profileRef = db.doc(`users/${uid}/stores/${uid}`);
  const xpRef = db.doc(`users/${uid}/xpLedger/xp_first_store_${uid}`);
  const pitangaRef = db.doc(`users/${uid}/rewardLedger/earn_first_store_${uid}`);
  await Promise.all([
    challengeRef.set({ id: 'first_store_published', title: 'Primeira publicação', description: 'Publique a primeira loja', status: 'published', validationMode: 'deterministic', sponsorType: 'kyrub', rewardKCoins: 0, rewardXp: 2, maxCompletionsPerUser: 1 }),
    storeRef.set({ id: canonicalStoreId, ownerId: uid, firstStoreCreationVerified: true, publicationStatus: 'paused', plan: 'free' }),
    profileRef.set({ id: uid, ownerId: uid, name: 'Loja fictícia HTTP', slug: 'loja-ficticia-http', plan: 'free' }),
  ]);
  const act = async (action: 'publish' | 'hide') => {
    const response = await fetch(endpoint, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ action, canonicalStoreId }),
    });
    const payload = await response.json() as Record<string, unknown>;
    assert.equal(response.status, 200, JSON.stringify(payload));
    return payload;
  };
  assert.deepEqual(await act('publish'), { replay: false, pitangas: 0, xp: 2 });
  assert.equal((await storeRef.get()).get('publicationStatus'), 'published');
  assert.equal((await listingRef.get()).get('publicationStatus'), 'published');
  assert.equal((await xpRef.get()).get('deltaXp'), 2);
  assert.equal((await pitangaRef.get()).exists, false);
  const firstPublishedAt = (await storeRef.get()).get('firstPublishedAt');
  assert.deepEqual(await act('publish'), { replay: true, pitangas: 0, xp: 2 });
  assert.deepEqual(await act('hide'), { hidden: true });
  assert.equal((await listingRef.get()).get('publicationStatus'), 'paused');
  assert.deepEqual(await act('publish'), { replay: true, pitangas: 0, xp: 2 });
  assert.equal((await storeRef.get()).get('firstPublishedAt'), firstPublishedAt);
  assert.equal((await db.collection(`users/${uid}/xpLedger`).get()).size, 1);
  assert.equal((await pitangaRef.get()).exists, false);
});
