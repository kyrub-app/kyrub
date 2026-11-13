import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const origin = 'http://127.0.0.1:3000';
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1365, height: 900 } });
  const errors = [];
  const forbiddenFirebaseRequests = [];
  await page.route('**/*', async route => {
    const url = route.request().url();
    if (/https?:\\/\\/(?:[^/]+\\.)?(?:googleapis\\.com|firebaseio\\.com|firebasestorage\\.app|firebaseapp\\.com)/i.test(url) &&
        /(?:identitytoolkit|firestore|firebasestorage|securetoken|firebaseio)/i.test(url)) {
      forbiddenFirebaseRequests.push(url.replace(/\\?.*$/, ''));
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });
  page.on('pageerror', error => errors.push(error.message));
  const health = await page.request.get(origin + '/api/health');
  assert.equal(health.status(), 200);
  assert.equal((await health.json()).app, 'Kyrub');
  const response = await page.goto(origin + '/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  assert.ok(response && response.status() < 400, 'The Kyrub browser entrypoint must render');
  await page.locator('body').waitFor({ state: 'visible', timeout: 15000 });
  const browserFirebase = await page.evaluate(async () => {
    const { auth, db, storage } = await import('/src/utils/firebase.ts');
    return {
      projectId: auth.app.options.projectId,
      firestoreProject: db.app.options.projectId,
      storageProject: storage.app.options.projectId,
    };
  });
  assert.deepEqual(browserFirebase, {
    projectId: 'kyrub-security-test',
    firestoreProject: 'kyrub-security-test',
    storageProject: 'kyrub-security-test',
  });
  assert.deepEqual(forbiddenFirebaseRequests, [], 'Browser must never request production Firebase services');
  await page.screenshot({ path: 'playwright-kyrub-isolated-smoke.png', fullPage: true });
  const api = await page.request.post(origin + '/api/action-execute?transport=first-store-publication', {
    data: { action: 'publish', canonicalStoreId: 'fictional_browser_store' },
  });
  assert.equal(api.status(), 401, JSON.stringify(await api.json()));
  assert.equal((await api.json()).error, 'AUTH_REQUIRED');
  assert.deepEqual(errors, [], 'Browser should not throw uncaught errors during initial load');
  // Authenticate a fictional user using only the Firebase Auth Emulator.
  assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:9099');
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8088');
  assert.equal(process.env.FIREBASE_PROJECT_ID, 'kyrub-security-test');
  const app = initializeApp({ projectId: 'kyrub-security-test' }, 'chromium-publication-smoke');
  const auth = getAuth(app);
  const db = getFirestore(app);
  const uid = 'chromium_publication_fictional';
  const canonicalStoreId = 'chromium_publication_store';
  await auth.createUser({ uid, email: 'chromium-publication@example.invalid' });
  await Promise.all([
    db.doc('global_challenges/first_store_published').set({ id: 'first_store_published', title: 'Primeira publicação', description: 'Publique a primeira loja', status: 'published', validationMode: 'deterministic', sponsorType: 'kyrub', rewardKCoins: 0, rewardXp: 2, maxCompletionsPerUser: 1 }),
    db.doc(`stores/${canonicalStoreId}`).set({ id: canonicalStoreId, ownerId: uid, firstStoreCreationVerified: true, publicationStatus: 'paused', plan: 'free' }),
    db.doc(`users/${uid}/stores/${uid}`).set({ id: uid, ownerId: uid, name: 'Loja Chromium', slug: 'loja-chromium', plan: 'free' }),
  ]);
  const customToken = await auth.createCustomToken(uid);
  const signIn = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-emulator-key', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: customToken, returnSecureToken: true }),
  });
  const signInText = await signIn.text();
  assert.equal(signIn.status, 200, signInText);
  const idToken = JSON.parse(signInText).idToken;
  assert.ok(idToken);
  const authenticatedPublish = async (action) => {
    const result = await page.request.post(origin + '/api/action-execute?transport=first-store-publication', {
      headers: { authorization: `Bearer ${idToken}` },
      data: { action, canonicalStoreId },
    });
    const payload = await result.json();
    assert.equal(result.status(), 200, JSON.stringify(payload));
    return payload;
  };
  assert.deepEqual(await authenticatedPublish('publish'), { replay: false, pitangas: 0, xp: 2 });
  assert.deepEqual(await authenticatedPublish('publish'), { replay: true, pitangas: 0, xp: 2 });
  assert.deepEqual(await authenticatedPublish('hide'), { hidden: true });
  assert.deepEqual(await authenticatedPublish('publish'), { replay: true, pitangas: 0, xp: 2 });
  assert.equal((await db.collection(`users/${uid}/xpLedger`).get()).size, 1);
  assert.equal((await db.doc(`users/${uid}/rewardLedger/earn_first_store_${uid}`).get()).exists, false);
  console.log('Chromium app smoke and authenticated emulator-backed publication API passed.');
} finally {
  await browser.close();
}
