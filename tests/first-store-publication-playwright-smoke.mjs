import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const origin = 'http://127.0.0.1:3000';
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST,'127.0.0.1:9099');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8088');
assert.equal(process.env.FIREBASE_PROJECT_ID,'kyrub-security-test');
assert.equal(process.env.GCLOUD_PROJECT,'kyrub-security-test');
assert.equal(process.env.GOOGLE_CLOUD_PROJECT,'kyrub-security-test');
assert.equal(process.env.KYRUB_FIRST_STORE_PUBLICATION_E2E_LOCAL,'true');
assert.equal(process.env.NODE_ENV==='production',false);
assert.ok(!process.env.VERCEL&&!process.env.FIREBASE_SERVICE_ACCOUNT_JSON&&!process.env.GOOGLE_APPLICATION_CREDENTIALS);

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
    const { auth, db, storage } = await import(new URL('/src/utils/firebase.ts', location.origin).href);
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
    db.doc(`users/${uid}/stores/${uid}`).set({
      id: uid, ownerId: uid, ownerEmail: 'chromium-publication@example.invalid',
      name: 'Loja Chromium', slug: 'loja-chromium', description: '', logo: '',
      banner: '', primaryColor: '#0f766e', plan: 'free', keywords: [],
      offerImages: [], address: '', contact: '', status: 'open',
      createdAt: new Date(), updatedAt: new Date(), canonicalStoreId,
    }),
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
    const { auth } = await import(new URL('/src/utils/firebase.ts', location.origin).href);
    const { signInWithCustomToken } = await import(new URL('/node_modules/.vite/deps/firebase_auth.js', location.origin).href);
    const credentials = await signInWithCustomToken(auth, emulatorCustomToken);
    return { uid: credentials.user.uid, projectId: credentials.user.auth.app.options.projectId };
  }, customToken);
  assert.deepEqual(browserSignIn, { uid, projectId: 'kyrub-security-test' });
  const browserIdentity = await page.evaluate(async () => {
    const { auth } = await import(new URL('/src/utils/firebase.ts', location.origin).href);
    return { uid: auth.currentUser?.uid, projectId: auth.app.options.projectId };
  });
  assert.deepEqual(browserIdentity, { uid, projectId: 'kyrub-security-test' });
  assert.deepEqual(forbiddenFirebaseRequests, [], 'Browser authentication must stay on the local emulator');
  // These private views use the same emulator identity as the ERP session.
  const privateViews = await page.evaluate(async () => {
    const { auth } = await import(new URL('/src/utils/firebase.ts', location.origin).href);
    const authorization = 'Bearer ' + await auth.currentUser.getIdToken();
    const read = async (url, options = {}) => {
      const response = await fetch(url, { ...options, headers: { authorization, 'content-type': 'application/json' } });
      if (!response.ok) throw Error('Private view returned HTTP ' + response.status);
      return response.json();
    };
    const [account, inbox, journey] = await Promise.all([
      read('/api/pitangas'), read('/api/notifications?limit=10'),
      read('/api/action-execute?transport=semeadura', {method:'POST', body:JSON.stringify({action:'journey'})}),
    ]);
    return [account.pitangas, account.xp, inbox.unreadCount, journey.journey.totalSeeds];
  });
  assert.deepEqual(privateViews, [0, 0, 0, 0]);
  // Institutional publication fixture from the exact canonical data contract.
  // The Admin disclosure transaction itself is independently tested in
  // demo-global-challenges; this browser test does not bypass its release gate.
  const communityId='chromium-official-community-fixture';
  const institutionalPostId='chromium-official-challenge-fixture';
  const now=new Date(),nowIso=now.toISOString();
  await Promise.all([
    db.doc('communities/'+communityId).set({communityId,ownerId:'chromium-institutional-owner',ownerName:'Fixture',ownerAvatar:'',
      name:'Comunidade oficial de teste',description:'Homologação isolada',category:'Kyrub',location:'',visibility:'public',
      rules:'Respeito',coverImage:'',coverPath:'',memberCount:1,lastMembershipChangeId:communityId+'__chromium-institutional-owner',
      createdAtIso:nowIso,createdAt:now,updatedAtIso:nowIso,updatedAt:now,activityAtIso:nowIso,activityAt:now}),
    db.doc('community_posts/'+institutionalPostId).set({postId:institutionalPostId,communityId,authorId:'kyrub:institutional',
      authorName:'Kyrub Oficial',authorAvatar:'',institutionalChallengeId:'first_store_published',
      content:'Publique sua primeira loja — desafio de homologação',mediaUrls:[],allowComments:true,pinnedCommentId:'',
      createdAtIso:nowIso,createdAt:now,updatedAtIso:nowIso,updatedAt:now}),
    db.doc('community_square_posts/'+institutionalPostId).set({postId:institutionalPostId,communityId,createdAt:now}),
  ]);
  const checkInstitutionalChallenge=async (expected)=>{
    await page.goto(origin+'/?app=1',{waitUntil:'domcontentloaded'});
    const bootstrap=page.locator('#kyrub-bootstrap-screen');
    const taba=page.getByRole('button',{name:'Taba — Praça',exact:true});
    const card=page.locator('[data-community-post-id="'+institutionalPostId+'"]');
    const details=card.locator('[aria-label="Detalhes do desafio da plataforma"]');
    const expectedStatus=expected==='available'?'Disponível':'Concluído com registro';
    let verified=false,lastError;
    for(let attempt=1;attempt<=4;attempt++){
      try{
        await page.locator('#root-app-container').waitFor({state:'visible',timeout:20000});
        await bootstrap.waitFor({state:'hidden',timeout:20000});
        await page.waitForTimeout(1200);
        await bootstrap.waitFor({state:'hidden',timeout:20000});
        if(!await card.isVisible()){
          await taba.click({timeout:10000});
          await page.locator('#praca-tab-container').waitFor({state:'visible',timeout:15000});
          await card.waitFor({state:'visible',timeout:20000});
        }
        if(!await details.isVisible()){
          const catalogResponse=page.waitForResponse(r=>r.url().includes('transport=global-challenge-catalog')&&r.request().method()==='GET',{timeout:15000});
          const [response]=await Promise.all([catalogResponse,card.getByRole('button',{name:'Ver desafio',exact:true}).click({timeout:10000})]);
          assert.equal(response.status(),200,await response.text());
          const payload=await response.json();
          const original=payload.challenges.find(c=>c.id==='first_store_published');
          assert.equal(original?.status,expected);
          assert.equal(original?.rewardXp,2);
          assert.equal(original?.rewardPitangas,0);
        }
        await details.getByText(expectedStatus,{exact:true}).waitFor({timeout:10000});
        // Verify all visible assertions from one DOM snapshot, not separate
        // reads that could span a LegacyApp remount.
        const rendered=await card.evaluate(el=>{
          const panel=el.querySelector('[aria-label="Detalhes do desafio da plataforma"]');
          return {author:el.querySelector('header')?.textContent??'',details:panel?.innerText??''};
        },undefined,{timeout:10000});
        assert.match(rendered.author,/Kyrub Oficial/);
        assert.ok(rendered.details.split('\n').some(line=>line.trim()===expectedStatus),'Canonical challenge status not visible');
        assert.match(rendered.details,/2 XP · 0 Pitangas/);
        assert.match(rendered.details,/Consultar o desafio não concede recompensas/);
        // Require the complete panel to remain open after a second read. Do
        // not silently accept a transient render as stable visual acceptance.
        await page.waitForTimeout(1000);
        assert.equal(await details.isVisible(),true,'Challenge panel disappeared after consultation');
        const stable=await details.innerText({timeout:5000});
        assert.match(stable,/Consultar o desafio não concede recompensas/);
        assert.ok(stable.split('\n').some(line=>line.trim()===expectedStatus));
        verified=true;break;
      }catch(error){
        lastError=error;
        console.log('CHALLENGE_READ_RETRY',expected,attempt,String(error).split('\n')[0]);
        // Only read/navigation retries. Do not repeat the ERP publication.
      }
    }
    if(!verified){
      await page.screenshot({path:'playwright-kyrub-challenge-'+expected+'-failure.png',fullPage:true});
      const diagnostic=await page.evaluate(()=>({url:location.href,bootstrap:!!document.querySelector('#kyrub-bootstrap-screen'),body:document.body.innerText.slice(0,2500)}));
      throw Error('Challenge consultation unstable: '+JSON.stringify({expected,diagnostic,errors,browserWarnings:browserWarnings.slice(-15),failedRequests:failedRequests.slice(-15)}),{cause:lastError});
    }
    assert.equal((await db.collection('users/'+uid+'/xpLedger').get()).size,expected==='available'?0:1);
    assert.equal((await db.collection('users/'+uid+'/rewardLedger').get()).size,0);
    assert.deepEqual(forbiddenFirebaseRequests,[]);
    await page.screenshot({path:expected==='available'?'playwright-kyrub-challenge-available.png':'playwright-kyrub-challenge-completed.png',fullPage:true});
  };
  await checkInstitutionalChallenge('available');
  await page.goto(origin+'/',{waitUntil:'domcontentloaded'});
  // Root / now opens the real Renda/Catu workspace directly, including for
  // authenticated users. The old optional ?entry=renda onboarding screen
  // has a separate #renda-entry-open-full-app button; that is NOT the root UX.
  // Reload so the real workspace uses the emulator-authenticated identity.
  await page.reload({ waitUntil: 'domcontentloaded' });
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
  // Cloud product synchronization can legitimately remount LegacyApp while
  // entering the ERP. Wait for bootstrap and reopen only non-mutating UI.
  // Never force a click, dispatch DOM events or substitute a direct API call
  // for the publication toggle.
  const configToggle=page.getByTestId('store-publication-toggle');
  const bootstrap=page.locator('#kyrub-bootstrap-screen');
  const erpHeader=page.locator('#erp-main-header');
  const configButton=page.locator('#orange-house-config-btn');
  let configError;
  for(let attempt=1;attempt<=4;attempt++){
    try{
      await bootstrap.waitFor({state:'hidden',timeout:20000});
      await page.waitForTimeout(1200);
      await bootstrap.waitFor({state:'hidden',timeout:20000});
      if(await configToggle.isVisible())break;
      if(!await erpHeader.isVisible()){
        await page.getByRole('button',{name:'Acessar loja',exact:true}).waitFor({state:'visible',timeout:10000});
        await retailerEntry.click({timeout:10000});
        await erpHeader.waitFor({state:'visible',timeout:10000});
      }
      await bootstrap.waitFor({state:'hidden',timeout:10000});
      await configButton.click({timeout:10000});
      await page.getByText('Configurações da Loja',{exact:true}).waitFor({state:'visible',timeout:10000});
      await configToggle.waitFor({state:'visible',timeout:10000});
      break;
    }catch(error){
      configError=error;
      console.log('ERP_CONFIG_NAVIGATION_RETRY',attempt, String(error).split('\n')[0]);
    }
  }
  if(!await configToggle.isVisible()){
    await page.screenshot({path:'playwright-kyrub-erp-navigation-failure.png',fullPage:true});
    const diagnostic=await page.evaluate(()=>({url:location.href,bootstrap:!!document.querySelector('#kyrub-bootstrap-screen'),erp:!!document.querySelector('#erp-main-header'),config:!!document.querySelector('#orange-house-config-btn'),body:document.body.innerText.slice(0,2200)}));
    throw Error('ERP configuration unavailable after bounded UI navigation: '+JSON.stringify({diagnostic,errors,browserWarnings:browserWarnings.slice(-15),failedRequests:failedRequests.slice(-15)}),{cause:configError});
  }
  assert.equal(await page.getByTestId('store-publication-toggle').getAttribute('aria-label'), 'Publicar loja no marketplace');
  assert.deepEqual(forbiddenFirebaseRequests, [], 'Retailer interface must remain emulator-isolated');

  // Exercise the authenticated endpoint from Chromium's page context with the
  // browser Firebase SDK token, not the separate Playwright request context.
  const authenticatedPublish = async (action) => {
    const result = await page.evaluate(async ({ action, canonicalStoreId }) => {
      const { auth } = await import(new URL('/src/utils/firebase.ts', location.origin).href);
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
  await checkInstitutionalChallenge('completed');
  assert.equal((await db.collection('users/'+uid+'/challengeRewards').get()).size,1);
  console.log('Chromium Taba challenge discovery, actual ERP publication and completed challenge consultation passed.');
} finally {
  await browser.close();
}
