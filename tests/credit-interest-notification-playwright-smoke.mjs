import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { proposeOrderCreditInterest, respondToOrderCreditInterest, loadOwnerCreditInterestProposal, listOwnCreditInterestProposals } from '../server/payments/orderCreditInterestService.ts';
import { listUserNotifications, markUserNotificationRead } from '../server/notifications/userNotificationService.ts';
import { getPrimaryUserStoreDocumentPath } from '../src/utils/storePaths.ts';
import { buildDefaultUserCommunicationPreferences } from '../shared/userCommunicationPreferences.ts';

const origin = 'http://127.0.0.1:3000';
const projectId = 'kyrub-security-test';
const ownerId = 'credit_browser_owner';
const buyerId = 'credit_browser_buyer';
const canonicalStoreId = 'credit_browser_canonical';
const orderId = 'credit_browser_order';
const paymentId = 'credit_browser_payment';
const slug = 'credito-teste-browser';
const paymentPath = 'stores/' + ownerId + '/payments/' + paymentId;
const pendingOrderId = 'credit_browser_pending_order';
const pendingOrderPath = 'artifacts/' + ownerId + '/public/data/customerOrders/' + pendingOrderId;
const orderPath = 'artifacts/' + ownerId + '/public/data/customerOrders/' + orderId;

assert.equal(process.env.FIREBASE_PROJECT_ID, projectId);
assert.equal(process.env.GCLOUD_PROJECT, projectId);
assert.equal(process.env.GOOGLE_CLOUD_PROJECT, projectId);
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8088');
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:9099');
assert.equal(process.env.VITE_KYRUB_FIREBASE_EMULATOR_E2E, 'true');
assert.notEqual(process.env.KYRUB_OFFICIAL_PLAN_PIX_CHECKOUT_ENABLED, 'true');
assert.notEqual(process.env.VERCEL_ENV, 'production');

const adminApp = initializeApp({projectId}, 'credit-interest-browser-e2e');
const adminAuth = getAuth(adminApp);
const db = getFirestore(adminApp);
const browser = await chromium.launch({headless: true});
const errors = [];
const remoteFirebase = [];
const routed = [];
const contexts = [];

const respondJson = (route, status, data) =>
  route.fulfill({status, contentType: 'application/json', body: JSON.stringify(data)});

const verifyEmulatedUser = async request => {
  const authorization = request.headers().authorization || '';
  assert.match(authorization, /^Bearer \S+$/);
  // The Firebase Auth emulator validates this real buyer/owner ID token.
  const user = await adminAuth.verifyIdToken(authorization.slice(7));
  assert.ok([ownerId, buyerId].includes(user.uid));
  return user.uid;
};

async function createIsolatedPage(viewport) {
  const context = await browser.newContext({viewport});
  contexts.push(context);
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));

  // Fail closed: any attempt to reach a live Firebase REST endpoint is blocked
  // and will also fail the test. The Firestore and Auth SDK use local emulators.
  await page.route('**/*', async route => {
    const host = new URL(route.request().url()).hostname;
    if (['identitytoolkit.googleapis.com', 'securetoken.googleapis.com',
      'firestore.googleapis.com', 'firebasestorage.googleapis.com'].includes(host) ||
        host.endsWith('.firebaseio.com')) {
      remoteFirebase.push(host);
      return route.abort('blockedbyclient');
    }
    return route.continue();
  });

  // Browser-only adapter for the isolated test. This delegates to the actual
  // server services and Firestore transactions, never fabricated proposals or
  // balances. No test route, auth bypass or credential reaches production code.
  await page.route(url =>
    url.pathname === '/api/health' &&
    url.searchParams.get('transport') === 'store-promotions' &&
    url.searchParams.get('surface') === 'credit-interest', async route => {
    try {
      const request = route.request();
      const uid = await verifyEmulatedUser(request);
      const url = new URL(request.url());
      const action = url.searchParams.get('path');
      routed.push({uid,action,method:request.method()});
      if (action === 'status' && request.method() === 'GET') {
        assert.equal(uid, ownerId);
        return respondJson(route, 200, {proposal: await loadOwnerCreditInterestProposal({
          storeId: url.searchParams.get('storeId'), orderId: url.searchParams.get('orderId'),
          actorId: uid,
        })});
      }
      if (action === 'offer' && request.method() === 'POST') {
        assert.equal(uid, ownerId);
        const body = request.postDataJSON();
        return respondJson(route, 200, {proposal: await proposeOrderCreditInterest({
          storeId: body.storeId, orderId: body.orderId,
          actorId: uid, bonusPercent: body.bonusPercent,
        })});
      }
      if (action === 'mine' && request.method() === 'GET') {
        // Storefront is also viewable by its owner; only the targeted buyer
        // may see the pending consultation, enforced by the real service.
        return respondJson(route, 200, {proposals: await listOwnCreditInterestProposals({
          storeId: url.searchParams.get('storeId'), buyerId: uid,
        })});
      }
      if (action === 'respond' && request.method() === 'POST') {
        assert.equal(uid, buyerId);
        const body = request.postDataJSON();
        return respondJson(route, 200, {proposal: await respondToOrderCreditInterest({
          storeId: body.storeId, orderId: body.orderId, buyerId: uid, choice: body.choice,
        })});
      }
      throw Error('UNEXPECTED_CREDIT_INTEREST_HTTP:' + action);
    } catch (error) {
      errors.push('credit-interest transport: ' + String(error));
      return respondJson(route, 500, {error: 'Isolated E2E transport failed'});
    }
  });

  await page.route(url => url.pathname === '/api/notifications', async route => {
    try {
      const request = route.request();
      const uid = await verifyEmulatedUser(request);
      assert.equal(uid, buyerId);
      if (request.method() === 'GET') {
        const inbox = await listUserNotifications({recipientUserId: uid, limit: 60});
        return respondJson(route, 200, inbox);
      }
      throw Error('UNEXPECTED_NOTIFICATION_REQUEST');
    } catch (error) {
      errors.push('inbox transport: ' + String(error));
      return respondJson(route, 500, {error: 'Isolated E2E inbox failed'});
    }
  });
  await page.route(url => url.pathname === '/api/notifications/read', async route => {
    try {
      const request = route.request();
      const uid = await verifyEmulatedUser(request);
      assert.equal(uid, buyerId);
      assert.equal(request.method(), 'POST');
      await markUserNotificationRead({
        recipientUserId: uid, notificationId: request.postDataJSON().notificationId,
      });
      return route.fulfill({status: 204, body: ''});
    } catch (error) {
      errors.push('read transport: ' + String(error));
      return respondJson(route, 500, {error: 'Isolated E2E mark read failed'});
    }
  });
  await page.route(url => url.pathname === '/api/communication-preferences', async route => {
    try {
      const uid = await verifyEmulatedUser(route.request());
      return respondJson(route, 200, buildDefaultUserCommunicationPreferences(uid));
    } catch (error) {
      errors.push('preferences transport: ' + String(error));
      return respondJson(route, 500, {error: 'Isolated E2E preferences failed'});
    }
  });
  return page;
}

async function signIn(page, uid) {
  const token = await adminAuth.createCustomToken(uid);
  const login = await page.evaluate(async value => {
    const {auth} = await import('/src/utils/firebase.ts');
    const {signInWithCustomToken} = await import('/node_modules/.vite/deps/firebase_auth.js');
    const result = await signInWithCustomToken(auth, value);
    return {uid: result.user.uid, projectId: auth.app.options.projectId};
  }, token);
  assert.deepEqual(login, {uid,projectId});
}

try {
  await Promise.all([
    adminAuth.createUser({uid: ownerId, email: 'credit-owner@example.invalid'}),
    adminAuth.createUser({uid: buyerId, email: 'credit-buyer@example.invalid'}),
    db.doc(getPrimaryUserStoreDocumentPath(ownerId)).set({
      id: ownerId, ownerId, name: 'Loja compensação isolada', status: 'open',
    }),
    db.doc('tenants/' + ownerId).set({canonicalStoreId}),
    db.doc('stores/' + canonicalStoreId).set({
      id: canonicalStoreId, ownerId, slug, status: 'open', publicationStatus: 'published',
    }),
    db.doc('marketplace_listings/credit-browser-store').set({
      listingType: 'store', storeId: canonicalStoreId, ownerId, slug,
      publicationStatus: 'published', status: 'open',
      name: 'Loja compensação isolada', description: 'Ambiente de teste, sem Pix real',
      keywords: [], logo: '', banner: '',
    }),
    db.doc(orderPath).set({
      id: orderId, storeId: ownerId, buyerId, createdByUserId: buyerId,
      status: 'rejected', paymentStatus: 'paid', refundStatus: 'required',
      total: 0, buyerName: 'Comprador fictício',
    }),
    db.doc(pendingOrderPath).set({
      id: pendingOrderId, storeId: ownerId, buyerId, createdByUserId: buyerId,
      status: 'pending', paymentStatus: 'paid', refundStatus: 'not_required',
      buyerName: 'Comprador fictício', total: 0, subtotal: 0,
      items: [{lineId: 'one', name: 'Produto fictício', productId: 'test-product', price: 23.30, quantity: 1}],
    }),
    db.doc(paymentPath).set({
      id: paymentId, storeId: ownerId, orderId, buyerId,
      paymentIntentId: 'credit_browser_intent', amount: 23.30, currency: 'BRL',
      method: 'pix', context: 'marketplace', status: 'paid', provider: 'mercado-pago',
      providerPaymentId: 'mp_emulator_browser_no_charge',
      idempotencyKey: 'credit_browser_payment_key',
      createdAt: '2026-11-22T17:00:00.000Z',
      updatedAt: '2026-11-22T17:01:00.000Z',
      paidAt: '2026-11-22T17:01:00.000Z', refundedAt: '',
    }),
  ]);

  // Real public discovery is provided by the local Express server.
  const discovery = await fetch(origin + '/api/marketplace-discovery/public/' + slug);
  assert.equal(discovery.status, 200, 'published isolated store must be discoverable');
  const listing = await discovery.json();
  assert.equal(listing.store.id, canonicalStoreId);

  const owner = await createIsolatedPage({width: 1200, height: 850});
  await owner.goto(origin + '/@' + slug, {waitUntil: 'domcontentloaded'});
  await signIn(owner, ownerId);

  // Exercise the REAL scoped-rejection controller on a pending paid order
  // using its native capture listener and a DOM order card. We do not confirm
  // rejection here: the financial operation remains unmodified in Firestore.
  await owner.evaluate(async ({storeId, orderId}) => {
    const [reactModule, domModule, controllerModule] = await Promise.all([
      import('/node_modules/.vite/deps/react.js'),
      import('/node_modules/.vite/deps/react-dom_client.js'),
      import('/src/components/store/KdsScopedRejectionController.tsx'),
    ]);
    const React = reactModule.default ?? reactModule;
    const ReactDOM = domModule.default ?? domModule;
    const host = document.createElement('div');
    host.id = 'credit-scoped-rejection-controller-e2e';
    document.body.prepend(host);
    ReactDOM.createRoot(host).render(React.createElement(
      controllerModule.KdsScopedRejectionController,
      {storeId,notify: () => {throw Error('REJECTION_MUST_NOT_BE_CONFIRMED_IN_MODAL_TEST');}},
    ));
    const orderCard = document.createElement('div');
    orderCard.id = 'kyrub-customer-order-' + encodeURIComponent(orderId);
    const button = document.createElement('button');
    button.textContent = 'Recusar';
    orderCard.appendChild(button);
    document.body.prepend(orderCard);
  }, {storeId: ownerId, orderId: pendingOrderId});
  const modalTrigger = owner.locator('#kyrub-customer-order-' + pendingOrderId).getByRole('button', {name: 'Recusar'});
  await owner.waitForTimeout(300);
  await modalTrigger.click();
  const rejection = owner.locator('#credit-scoped-rejection-controller-e2e');
  await rejection.getByText('Recusa do pedido').waitFor({timeout: 15000});
  await rejection.locator('textarea').fill('Item indisponível (teste isolado)');
  await rejection.getByRole('button', {name: 'Pedido inteiro'}).click();
  await rejection.getByText('Propor crédito em reais com bônus opcional').click();
  await rejection.getByRole('spinbutton', {name: 'Bônus percentual pela compensação'}).fill('20');
  assert.match(await rejection.innerText(), /Bônus selecionado: \+20%/);
  assert.match(await rejection.innerText(), /O total operacional do pedido pode estar zerado/);
  assert.doesNotMatch(await rejection.innerText(), /Crédito estimado: R\$\s*0,00/);
  await owner.screenshot({path: 'playwright-credit-rejection-modal.png', fullPage: true});
  await rejection.getByRole('button', {name: 'Fechar recusa'}).click();
  assert.equal((await db.doc(pendingOrderPath).get()).get('status'), 'pending');

  // Mount the production merchant consultation component in a dedicated test
  // element. This checks its real controls, not navigation through the full ERP.
  await owner.evaluate(async props => {
    const [reactModule, domModule, {PostRejectionCreditInterest}] = await Promise.all([
      import('/node_modules/.vite/deps/react.js'),
      import('/node_modules/.vite/deps/react-dom_client.js'),
      import('/src/components/store/PostRejectionCreditInterest.tsx'),
    ]);
    // Vite may expose CommonJS React prebundles through default exports.
    const React = reactModule.default ?? reactModule;
    const ReactDOM = domModule.default ?? domModule;
    const node = document.createElement('div');
    node.id = 'credit-owner-component-e2e';
    document.body.prepend(node);
    ReactDOM.createRoot(node).render(React.createElement(PostRejectionCreditInterest, props));
  }, {storeId: ownerId, orderId});
  const ownerSection = owner.locator('#credit-owner-component-e2e');
  await ownerSection.getByRole('button', {name: 'Consultar interesse do comprador'}).waitFor({state:'visible',timeout:25000});
  await ownerSection.getByRole('spinbutton').fill('20');
  await ownerSection.getByRole('button', {name: 'Consultar interesse do comprador'}).click();
  await ownerSection.getByText(/Proposta registrada\. Valor pago/).waitFor({timeout:20000});
  assert.match(await ownerSection.innerText(), /R\$\s*23,30/);
  assert.match(await ownerSection.innerText(), /R\$\s*4,66/);
  assert.match(await ownerSection.innerText(), /R\$\s*27,96/);
  assert.match(await ownerSection.innerText(), /Nenhum crédito foi emitido/);
  await owner.screenshot({path:'playwright-credit-offer-owner.png',fullPage:true});

  const offer = await db.doc('stores/' + ownerId + '/orderCreditInterestProposals/' + orderId).get();
  assert.equal(offer.get('status'), 'awaiting_response');
  assert.equal(offer.get('proposedCreditMinor'), 2796);
  assert.equal(offer.get('creditIssued'), false);
  assert.deepEqual(await proposeOrderCreditInterest({
    storeId: ownerId, orderId, actorId: ownerId, bonusPercent:20,
  }), offer.data());
  const notificationBefore = await db.collection('users/' + buyerId + '/notifications').get();
  assert.equal(notificationBefore.size, 1, 'repeated offer creates no duplicate notifications');
  const notificationId = notificationBefore.docs[0].id;
  assert.equal(notificationBefore.docs[0].get('eventType'),'credit_interest_proposed');
  assert.equal(notificationBefore.docs[0].get('target.storeSlug'),slug);
  assert.equal(notificationBefore.docs[0].get('readAt'),'');

  const buyer = await createIsolatedPage({width: 390, height: 844});
  await buyer.goto(origin + '/?app=1', {waitUntil:'domcontentloaded'});
  await signIn(buyer, buyerId);
  await buyer.reload({waitUntil:'domcontentloaded'});
  const bell = buyer.locator('#canonical-notification-trigger');
  await bell.waitFor({state:'visible',timeout:30000});
  await bell.click();
  const inbox = buyer.locator('#canonical-notification-center');
  await inbox.waitFor({state:'visible',timeout:15000});
  await inbox.getByText('Proposta sobre pedido cancelado').waitFor({state:'visible',timeout:15000});
  assert.match(await inbox.innerText(), /1 não lida/);
  await buyer.screenshot({path:'playwright-credit-buyer-inbox.png',fullPage:true});
  await inbox.getByRole('button', {name:/Proposta sobre pedido cancelado/}).click();
  await buyer.waitForURL(url => url.pathname === '/@' + slug
    && url.searchParams.get('compensacao') === orderId, {timeout:20000});
  const card = buyer.locator('#credito-pedido-' + orderId);
  await card.waitFor({state:'visible',timeout:30000});
  assert.match(await card.innerText(), /R\$\s*23,30/);
  assert.match(await card.innerText(), /R\$\s*4,66/);
  assert.match(await card.innerText(), /R\$\s*27,96/);
  assert.match(await card.innerText(), /Nenhum crédito foi emitido/);
  await buyer.screenshot({path:'playwright-credit-buyer-proposal.png',fullPage:true});

  await card.getByRole('button', {name:'Tenho interesse em negociar crédito'}).click();
  await card.getByText(/Interesse registrado\. Ainda não há cupom emitido/).waitFor({timeout:15000});
  assert.equal((await db.doc('stores/' + ownerId + '/orderCreditInterestProposals/' + orderId).get()).get('status'),'interested');
  await card.getByRole('button', {name:'Mudei de ideia: prefiro a devolução do pagamento'}).click();
  await card.getByText(/Preferência pelo reembolso registrada/).waitFor({timeout:15000});
  await buyer.screenshot({path:'playwright-credit-buyer-refund-preference.png',fullPage:true});

  const finalProposal = await db.doc('stores/' + ownerId + '/orderCreditInterestProposals/' + orderId).get();
  assert.equal(finalProposal.get('status'),'prefers_refund');
  assert.equal(finalProposal.get('creditIssued'),false);
  assert.ok((await db.doc('users/' + buyerId + '/notifications/' + notificationId).get()).get('readAt'));
  assert.equal((await db.collection('users/' + buyerId + '/notifications').get()).size,1);
  assert.equal((await db.doc(paymentPath).get()).get('status'),'paid');
  assert.equal((await db.doc(orderPath).get()).get('refundStatus'),'required');
  assert.equal((await db.collection('stores/' + ownerId + '/orderCreditBalances').get()).size,0);
  assert.equal((await db.collection('stores/' + ownerId + '/promotions').get()).size,0);
  assert.equal((await db.collection('stores/' + ownerId + '/paymentRefunds').get()).size,0);
  assert.ok(routed.some(item=>item.uid===ownerId&&item.action==='offer'));
  assert.ok(routed.some(item=>item.uid===buyerId&&item.action==='mine'));
  assert.equal(routed.filter(item=>item.uid===buyerId&&item.action==='respond').length,2);
  assert.deepEqual(remoteFirebase,[],'browser must not contact production Firebase');
  assert.deepEqual(errors,[],'isolated browser adapters and UI must have no unhandled errors');
  console.log('CREDIT INTEREST BROWSER: OWNER COMPONENT → 1 NOTIFICATION → BELL → BUYER RESPONSE → REFUND PREFERENCE PASS (no money movement)');
} finally {
  for(const context of contexts)await context.close().catch(()=>{});
  await browser.close();
  await db.terminate();
  await deleteApp(adminApp);
}
