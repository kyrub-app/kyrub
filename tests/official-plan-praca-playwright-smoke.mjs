import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const origin = 'http://127.0.0.1:3000';
const STORE = 'store-ae53dc42e57eb9d5c3f7151c1431';
const BUSINESS = 'draft_5f46706373714839a55846e6d8cb102c';
const PROMO = 'business-one-real-erp-coupon';
const projectId = 'kyrub-security-test';
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8088');
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:9099');
assert.equal(process.env.FIREBASE_PROJECT_ID, projectId);
assert.equal(process.env.VITE_KYRUB_FIREBASE_EMULATOR_E2E, 'true');
assert.notEqual(process.env.KYRUB_OFFICIAL_PLAN_PIX_CHECKOUT_ENABLED, 'true',
  'the browser must never enable live official Pix');

const adminApp = initializeApp({ projectId }, 'official-praça-chromium');
const adminAuth = getAuth(adminApp);
const db = getFirestore(adminApp);
const browser = await chromium.launch({ headless: true });
const stamp = Date.now();
const iso = value => new Date(value).toISOString();
const fakeUid = 'official_coupon_chromium_buyer';
let page;
try {
  await Promise.all([
    db.doc('stores/' + STORE).set({
      id: STORE, name: 'Kyrub Oficial', slug: 'kyrub-oficial',
      ownerId: 'official-fake-owner', publicationStatus: 'published', status: 'open',
      description: 'Planos oficiais Kyrub', primaryColor: '#164e63',
    }),
    db.doc('marketplace_listings/official-browser-store').set({
      listingType: 'store', storeId: STORE, slug: 'kyrub-oficial',
      publicationStatus: 'published', name: 'Kyrub Oficial', status: 'open',
      keywords: [], categories: [], description: 'Planos oficiais Kyrub',
    }),
    db.doc('marketplace_listings/official-browser-business').set({
      listingType: 'offer', storeId: STORE, productId: BUSINESS, offerId: BUSINESS,
      publicationStatus: 'published', name: 'Kyrub Business',
      description: 'Plano Business de teste', price: 397,
      category: 'Planos', isService: true, stock: 0,
    }),
    db.doc('stores/' + STORE + '/products/' + BUSINESS).set({
      id: BUSINESS, storeId: STORE, publicationStatus: 'published',
      name: 'Kyrub Business', description: 'Contrato Business',
      price: 397, isService: true, stock: 0,
      saleModality: {
        schemaVersion: 1, mode: 'subscription',
        subscription: { schemaVersion: 1, autoRenew: false,
          billingInterval: { unit: 'month', count: 1 },
          benefit: { kind: 'access', unitsPerCycle: null } },
      },
      contractDiscounts: [{ months: 1, discountPercent: 0 }],
    }),
    db.doc('social_posts/official-business-pilot-praça').set({
      postId: 'official-business-pilot-praça',
      sourcePostId: 'official-business-pilot-praça',
      authorId: 'official-fake-owner', authorName: 'Kyrub Oficial',
      authorAvatar: '', content: '🎟️ Business piloto · Cupom: BIZ1',
      publicationType: 'feed', visibility: 'public',
      taggedUsers: [], taggedUserIds: [], mediaUrls: [], audienceIds: [],
      storePromotion: { storeId: STORE, promotionId: PROMO },
      createdAtIso: iso(stamp), createdAt: new Date(stamp),
      updatedAt: new Date(stamp),
    }),
    db.doc('stores/' + STORE + '/promotions/' + PROMO).set({
      id: PROMO, storeId: STORE, code: 'BIZ1',
      title: 'Business piloto', badge: 'PILOTO',
      discountType: 'fixed', discountValue: 396,
      productIds: [BUSINESS], eligibility: { mode: 'public' },
      active: true, startsAt: iso(stamp - 86400000), endsAt: iso(stamp + 86400000),
      maxRedemptions: 1, maxRedemptionsPerBuyer: 1, redemptionCount: 0,
      createdBy: 'official-fake-owner', createdVia: 'manual',
      actionId: 'isolated-browser-pilot',
      createdAt: iso(stamp - 86400000), updatedAt: iso(stamp),
    }),
  ]);
  await adminAuth.createUser({ uid: fakeUid, email: 'official-coupon-chromium@example.invalid' });
  const promoUrl = origin + '/api/payments/promotions?storeId=' + encodeURIComponent(STORE);
  const discovery = await fetch(origin + '/api/marketplace-discovery/public/kyrub-oficial');
  assert.equal(discovery.status, 200, 'real storefront API must expose published canonical plan');
  const listing = await discovery.json();
  assert.equal(listing.store.id, STORE);
  assert.equal(listing.offers.filter(p => p.id === BUSINESS).length, 1);
  assert.equal(listing.offers.find(p => p.id === BUSINESS).saleModality.mode, 'subscription');
  const promoResponse = await fetch(promoUrl);
  assert.equal(promoResponse.status, 200, 'real promotions GET must work for canonical Official Store');
  const promoPayload = await promoResponse.json();
  assert.deepEqual(promoPayload.promotions.map(x => x.code), ['BIZ1']);
  assert.deepEqual(promoPayload.promotions[0].productIds, [BUSINESS]);
  const publicPromo = await fetch(origin + '/api/store-promotions/public/' + STORE + '/' + PROMO);
  assert.equal(publicPromo.status, 200);
  assert.equal((await publicPromo.json()).storeSlug, 'kyrub-oficial');

  page = await browser.newPage({ viewport: { width: 1365, height: 900 } });
  const pageErrors = [];
  const externalFirebase = [];
  const recorded = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.route('**/*', async route => {
    const requestUrl = new URL(route.request().url());
    if (['identitytoolkit.googleapis.com', 'securetoken.googleapis.com',
      'firestore.googleapis.com', 'firebasestorage.googleapis.com'].includes(requestUrl.hostname) ||
      requestUrl.hostname.endsWith('.firebaseio.com')) {
      externalFirebase.push(requestUrl.hostname);
      return route.abort('blockedbyclient');
    }
    return route.continue();
  });
  // Only the provider-facing Pix API is simulated. The storefront and public
  // ERP coupon discovery above are served by the actual local Express routes.
  await page.route(url => url.pathname === '/api/plan-control', async route => {
    const request = route.request();
    const op = new URL(request.url()).searchParams.get('op');
    // Unrelated panels can issue their own existing billing requests.
    // Intercept only the three official prepaid operations under test.
    if (!op?.startsWith('official.prepaid.')) return route.continue();
    const body = request.postDataJSON();
    recorded.push({ op, body, authorization: request.headers().authorization });
    let response;
    if (op === 'official.prepaid.quote') response = {
      checkoutId: 'a'.repeat(64), status: 'quoted',
      quote: {
        months: 1, totalMinor: 100, originalTotalMinor: 39700,
        promotionDiscountMinor: 39600, promotionCode: 'BIZ1',
        discountPercent: 0, monthlyEquivalentMinor: 39700,
      },
    };
    else if (op === 'official.prepaid.accept') response = { status: 'accepted' };
    else if (op === 'official.prepaid.checkout') response = {
      state: 'awaiting_payment',
      pix: { qrCode: 'FAKE-PIX-NOT-PAYABLE', expiresAt: '2099-12-31T00:00:00.000Z' },
    };
    else if (op === 'official.prepaid.payment-status') response = { state: 'awaiting_payment' };
    else throw Error('UNEXPECTED_PLAN_CONTROL:' + op);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(response) });
  });
  // Start in the real app with the Firebase Auth Emulator. The buyer must
  // click the live Praça coupon card, not type its URL into the address bar.
  await page.goto(origin + '/?app=1', { waitUntil: 'domcontentloaded' });
  const customToken = await adminAuth.createCustomToken(fakeUid);
  const login = await page.evaluate(async token => {
    const { auth } = await import('/src/utils/firebase.ts');
    const { signInWithCustomToken } = await import('/node_modules/.vite/deps/firebase_auth.js');
    const result = await signInWithCustomToken(auth, token);
    return { uid: result.user.uid, projectId: auth.app.options.projectId };
  }, customToken);
  assert.deepEqual(login, { uid: fakeUid, projectId });
  await page.reload({ waitUntil: 'domcontentloaded' });
  const pracaButton = page.getByRole('button', { name: 'Praça', exact: true });
  await pracaButton.waitFor({ state: 'visible', timeout: 20000 });
  await pracaButton.click();
  const couponLink = page.getByRole('link', { name: 'Aproveitar cupom BIZ1 na loja' });
  try {
    await couponLink.waitFor({ state: 'visible', timeout: 20000 });
  } catch (error) {
    const screen = await page.evaluate(() => ({
      url: location.href,
      app: document.querySelector('#root-app-container')?.textContent?.slice(0, 400),
      praca: document.querySelector('#praca-tab-container')?.textContent?.slice(0, 2000),
      cards: [...document.querySelectorAll('a')].map(a => ({
        href: a.getAttribute('href'), ariaLabel: a.getAttribute('aria-label'),
        text: a.textContent?.slice(0, 90),
      })).filter(a => a.href?.includes('coupon') || a.text?.includes('cupom')),
      errors: document.body.innerText.slice(-1300),
    }));
    const seed = await db.doc('social_posts/official-business-pilot-praça').get();
    const publicPromoAgain = await fetch(origin + '/api/store-promotions/public/' + STORE + '/' + PROMO);
    console.error('PRAÇA_COUPON_DIAGNOSTIC', JSON.stringify({
      screen, pageErrors, externalFirebase, seeded: seed.exists,
      publicPromoStatus: publicPromoAgain.status,
      publicPromoBody: await publicPromoAgain.text(),
    }));
    await page.screenshot({ path: 'playwright-official-praça-mural.png', fullPage: true });
    throw error;
  }
  assert.equal(
    new URL(await couponLink.getAttribute('href'), origin).pathname,
    '/@kyrub-oficial',
    'the real social card must link directly to the canonical Official Store',
  );
  assert.equal(
    new URL(await couponLink.getAttribute('href'), origin).searchParams.get('coupon'),
    'BIZ1',
  );
  await page.screenshot({ path: 'playwright-official-praça-mural.png', fullPage: true });
  await couponLink.click();
  await page.waitForURL(url => url.pathname === '/@kyrub-oficial'
    && url.searchParams.get('coupon') === 'BIZ1', { timeout: 20000 });
  const section = page.locator('#official-plan-contract-section');
  await section.waitFor({ state: 'visible', timeout: 20000 });
  await section.getByText('Cupom da Praça BIZ1 identificado').waitFor({ timeout: 15000 });
  assert.equal(await section.getAttribute('data-official-plan-route'), 'canonical-prepaid');
  await section.getByRole('button', { name: 'Consultar preço oficial do contrato' }).click();
  await section.getByText(/Preço original do contrato/).waitFor();
  assert.match(await section.innerText(), /R\$\s*397,00/);
  assert.match(await section.innerText(), /R\$\s*396,00/);
  assert.match(await section.innerText(), /R\$\s*1,00/);
  await section.getByRole('checkbox').check();
  await section.getByRole('button', { name: /Confirmar contratação e gerar Pix/ }).click();
  await section.getByText(/Aguardando pagamento Pix/).waitFor();
  assert.equal(recorded[0].op, 'official.prepaid.quote');
  assert.equal(recorded[0].body.promotionCode, 'BIZ1');
  assert.equal(recorded[0].body.productId, BUSINESS);
  assert.equal(recorded[0].body.storeId, STORE);
  assert.ok(recorded[0].authorization?.startsWith('Bearer '));
  assert.deepEqual(recorded.slice(1,3).map(x => x.op), [
    'official.prepaid.accept', 'official.prepaid.checkout',
  ]);
  assert.equal(recorded[1].body.acceptedTotalMinor, 100);
  assert.equal(recorded[2].body.checkoutId, 'a'.repeat(64));
  assert.equal(await section.getByRole('textbox', { name: 'Pix copia e cola' }).inputValue(), 'FAKE-PIX-NOT-PAYABLE');
  await page.screenshot({ path: 'playwright-official-praça-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await section.waitFor({ state: 'visible' });
  await page.screenshot({ path: 'playwright-official-praça-mobile.png', fullPage: true });
  assert.deepEqual(externalFirebase, [], 'no production Firebase endpoint may be used');
  assert.deepEqual(pageErrors, [], 'browser must not throw uncaught errors');
  assert.equal((await db.collection('stores/' + STORE + '/payments').get()).size, 0,
    'browser test may not persist payments or generate real charges');
  console.log('CHROMIUM OFFICIAL PRAÇA: REAL PUBLIC ERP GET + BROWSER CHECKOUT UI PASSED');
} finally {
  await page?.close().catch(() => {});
  await browser.close();
  await db.terminate();
  await deleteApp(adminApp);
}
