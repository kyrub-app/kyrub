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
  const browserWarnings = [];
  const failedRequests = [];
  page.on('response', response => {
    if (response.status() >= 400) failedRequests.push({ status: response.status(), url: response.url().slice(0, 240) });
  });
  page.on('console', message => {
    if (message.type() === 'warning' || message.type() === 'error') browserWarnings.push(message.text());
  });
  const forbiddenFirebaseRequests = [];
  await page.route('**/*', async route => {
    const url = route.request().url();
    const parsed = new URL(url);
    const remoteFirebase = ['identitytoolkit.googleapis.com', 'securetoken.googleapis.com', 'firestore.googleapis.com', 'firebasestorage.googleapis.com'].includes(parsed.hostname) || parsed.hostname.endsWith('.firebaseio.com') || parsed.hostname.endsWith('.firebasestorage.app');
    if (remoteFirebase) {
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
    db.doc(`users/${uid}/stores/${uid}`).set({ id: uid, ownerId: uid, name: 'Loja Chromium', slug: 'loja-chromium', plan: 'free', canonicalStoreId }),
  ]);
  // Creating a Free store must not grant publication XP before publication.
  const beforePublication = await db.doc(`stores/${canonicalStoreId}`).get();
  assert.equal(beforePublication.data()?.plan, 'free');
  assert.equal(beforePublication.data()?.publicationStatus, 'paused');
  assert.equal((await db.collection(`users/${uid}/xpLedger`).get()).size, 0);
  assert.equal((await db.doc(`users/${uid}/rewardLedger/earn_first_store_${uid}`).get()).exists, false);
  const customToken = await auth.createCustomToken(uid);
  const signIn = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-emulator-key', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: customToken, returnSecureToken: true }),
  });
  const signInText = await signIn.text();
  assert.equal(signIn.status, 200, signInText);
  const idToken = JSON.parse(signInText).idToken;
  assert.ok(idToken);
  // Authenticate inside the actual browser Firebase SDK, not only Playwright's API client.
  const browserSignIn = await page.evaluate(async (emulatorCustomToken) => {
    const { auth } = await import('/src/utils/firebase.ts');
    const { signInWithCustomToken } = await import('/node_modules/.vite/deps/firebase_auth.js');
    const credentials = await signInWithCustomToken(auth, emulatorCustomToken);
    return { uid: credentials.user.uid, projectId: credentials.user.auth.app.options.projectId };
  }, customToken);
  assert.deepEqual(browserSignIn, { uid, projectId: 'kyrub-security-test' });
  const browserIdentity = await page.evaluate(async () => {
    const { auth } = await import('/src/utils/firebase.ts');
    return { uid: auth.currentUser?.uid, projectId: auth.app.options.projectId };
  });
  assert.deepEqual(browserIdentity, { uid, projectId: 'kyrub-security-test' });
  assert.deepEqual(forbiddenFirebaseRequests, [], 'Browser authentication must stay on the local emulator');
  // Navigate through the actual retailer interface instead of bypassing it.
  // Reload so the root auth listener and Renda tab mount with the signed-in
  // emulator identity, rather than retaining the initial anonymous UI.
  await page.reload({ waitUntil: 'domcontentloaded' });
  const fullAppEntry = page.locator('#renda-entry-open-full-app');
  await fullAppEntry.waitFor({ state: 'visible', timeout: 15000 });
  await fullAppEntry.click();
  await page.waitForURL(url => url.searchParams.get('app') === '1', { timeout: 15000 });
  assert.equal(new URL(page.url()).searchParams.get('app'), '1', 'Full Kyrub dashboard must be entered through the Renda landing');
  const retailerEntry = page.locator('#btn-criar-loja-ofertas');
  try {
    await retailerEntry.waitFor({ state: 'visible', timeout: 12000 });
  } catch (error) {
    const diagnostic = await page.evaluate(() => ({
      url: location.href,
      title: document.title,
      body: document.body.innerText.slice(0, 3000),
      buttons: [...document.querySelectorAll('button')].slice(0, 35).map(button => ({
        id: button.id, text: button.innerText.slice(0, 80),
      })),
    }));
    throw new Error('Retailer navigation entry absent: ' + JSON.stringify(diagnostic), { cause: error });
  }
  await page.getByRole('button', { name: 'Acessar loja' }).waitFor({ timeout: 30000 });
  await retailerEntry.click();
  await page.locator('#erp-main-header').waitFor({ state: 'visible', timeout: 15000 });
  await page.locator('#orange-house-config-btn').click();
  await page.getByText('Configurações da Loja', { exact: true }).waitFor({ state: 'visible', timeout: 15000 });
  await page.getByTestId('store-publication-toggle').waitFor({ state: 'visible', timeout: 15000 });
  assert.equal(await page.getByTestId('store-publication-toggle').getAttribute('aria-label'), 'Publicar loja no marketplace');
  assert.deepEqual(forbiddenFirebaseRequests, [], 'Retailer interface must remain emulator-isolated');

  // Exercise the authenticated endpoint from Chromium's page context with the
  // browser Firebase SDK token, not the separate Playwright request context.
  const authenticatedPublish = async (action) => {
    const result = await page.evaluate(async ({ action, canonicalStoreId }) => {
      const { auth } = await import('/src/utils/firebase.ts');
      const token = await auth.currentUser.getIdToken();
      const response = await fetch('/api/action-execute?transport=first-store-publication', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ action, canonicalStoreId }),
      });
      return { status: response.status, payload: await response.json() };
    }, { action, canonicalStoreId });
    assert.equal(result.status, 200, JSON.stringify(result.payload));
    assert.deepEqual(forbiddenFirebaseRequests, [], 'Browser publication must not call production Firebase');
    return result.payload;
  };
  // The fictional Firestore seed does not populate the local ERP profile form.
  // Complete the required store name through the real UI before publishing.
  await page.locator('[data-store-profile-field="name"]').fill('Loja Chromium');
  // The first publication must originate from the actual Store Configuration
  // button, not a direct test-only API invocation.
  const firstPublicationResponse = page.waitForResponse(response =>
    response.url().includes('/api/action-execute?transport=first-store-publication') &&
    response.request().method() === 'POST',
    { timeout: 20000 },
  );
  await page.getByTestId('store-publication-toggle').click();
  let uiPublicationResponse;
  try {
    uiPublicationResponse = await firstPublicationResponse;
  } catch (error) {
    const diagnostic = await page.evaluate(() => ({
      body: document.body.innerText.slice(-3500),
      publicationButton: (() => {
        const button = document.querySelector('[data-testid="store-publication-toggle"]');
        return button ? { text: button.textContent, disabled: button.disabled, ariaLabel: button.getAttribute('aria-label') } : null;
      })(),
    }));
    throw new Error('ERP publication click produced no trusted API response: ' + JSON.stringify({
      diagnostic, pageErrors: errors, browserWarnings: browserWarnings.filter(message => /Store kept locally|Store hours|permission|FirebaseError|sync/i.test(message)).slice(-20), failedRequests: failedRequests.slice(-35), forbiddenFirebaseRequests,
    }), { cause: error });
  }
  assert.equal(uiPublicationResponse.status(), 200, await uiPublicationResponse.text());
  assert.deepEqual(await uiPublicationResponse.json(), { replay: false, pitangas: 0, xp: 2 });
  assert.equal((await db.collection(`users/${uid}/xpLedger`).get()).size, 1, 'Actual UI publication must award exactly one XP ledger entry');
  assert.deepEqual(await authenticatedPublish('publish'), { replay: true, pitangas: 0, xp: 2 });
  assert.deepEqual(await authenticatedPublish('hide'), { hidden: true });
  const hiddenSnapshot = await db.doc(`stores/${canonicalStoreId}`).get();
  assert.equal(hiddenSnapshot.data()?.publicationStatus, 'paused');
  assert.equal((await db.collection(`users/${uid}/xpLedger`).get()).size, 1);

  assert.deepEqual(await authenticatedPublish('publish'), { replay: true, pitangas: 0, xp: 2 });
  // Verify the final canonical document using the same emulator-backed admin
  // client that seeded this fictional store. Avoid mixing duplicate Vite SDK
  // module instances inside page.evaluate (which rejects cross-instance refs).
  const canonicalSnapshot = await db.doc(`stores/${canonicalStoreId}`).get();
  assert.equal(canonicalSnapshot.exists, true);
  assert.equal(canonicalSnapshot.data()?.publicationStatus, 'published');
  assert.ok(typeof canonicalSnapshot.data()?.firstPublishedAt === 'string');
  assert.deepEqual(forbiddenFirebaseRequests, [], 'Chromium must remain isolated');
  assert.equal((await db.collection(`users/${uid}/xpLedger`).get()).size, 1);
  assert.equal((await db.doc(`users/${uid}/rewardLedger/earn_first_store_${uid}`).get()).exists, false);
  console.log('Chromium app smoke and authenticated emulator-backed publication API passed.');
} finally {
  await browser.close();
}
