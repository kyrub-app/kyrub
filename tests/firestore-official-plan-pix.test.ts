import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { loadOfficialPlanPixFixture } from './helpers/officialPlanPixFixture.js';

if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')) throw Error('LOCAL_FIRESTORE_EMULATOR_REQUIRED');
const app = initializeApp({ projectId: 'demo-kyrub-pix' }, 'official-pix-integration');
const db = getFirestore(app);
let payment: any, posts = 0;
(globalThis as any).__officialPix = { db,
  auth: async () => ({ uid: 'buyer', email: 'buyer@example.test', emailVerified: true }),
  request: async (path: string, init?: RequestInit) => {
    if (path === '/users/me') return { id: '42' };
    if (path === '/v1/payments' && init?.method === 'POST') {
      posts++; payment = { ...JSON.parse(init.body as string), id: '123', status: 'pending', collector_id: '42', currency_id: 'BRL',
        live_mode: true, point_of_interaction: { transaction_data: { qr_code: 'LOCAL-EMULATOR-PIX' } } }; return payment;
    }
    if (path === '/v1/payments/123') return payment;
    throw Error('UNEXPECTED_EXTERNAL_ACCESS');
  },
};
const api = await loadOfficialPlanPixFixture();
after(async () => { api.restoreFixture(); await db.terminate(); await deleteApp(app); });

test('real Firestore transaction races preserve one provider charge and one set of financial/reward effects', async () => {
  // This dedicated demo namespace can never reach a live database.
  for (const collection of await db.listCollections()) await db.recursiveDelete(collection);
  process.env.KYRUB_OFFICIAL_PLAN_PIX_CHECKOUT_ENABLED = 'true'; process.env.VERCEL_ENV = 'production';
  process.env.KYRUB_OFFICIAL_PLAN_PIX_PILOT_MODE = 'true';
  process.env.KYRUB_OFFICIAL_PLAN_PIX_PILOT_BUYER_UID = 'buyer';
  process.env.KYRUB_BILLING_MERCADO_PAGO_COLLECTOR_ID = '42';
  const root = 'kyrub_admin/control_plane';
  const modality = { schemaVersion: 1, mode: 'subscription', subscription: { schemaVersion: 1, autoRenew: true,
    billingInterval: { unit: 'month', count: 1 }, benefit: { kind: 'access', unitsPerCycle: null } } };
  const fixtures: Array<[string, object]> = [
    ['stores/official-store', { ownerId: 'owner', legacyTenantId: 'owner' }],
    ['kyrub_admin/official_store', { canonicalStoreId: 'official-store' }],
    ['stores/buyer-store', { ownerId: 'buyer', plan: 'free' }], ['users/buyer/stores/buyer', { plan: 'free' }],
    ['stores/official-store/products/product', { name: 'Owner defined plan', price: 197, publicationStatus: 'published',
      saleModality: modality, storePointsPerUnit: 5, contractDiscounts: [{ months: 1, discountPercent: 0 }, { months: 3, discountPercent: 10 }] }],
    [root + '/official_plan_products/product', { canonicalStoreId: 'official-store', productId: 'product', planId: 'pro', status: 'active',
      rewards: { xp: 30, achievement: { id: 'owner-defined-badge', title: 'Owner defined badge', description: '' } } }],
  ];
  await Promise.all(fixtures.map(([path, data]) => db.doc(path).set(data)));
  const q = await api.quoteOfficialPlanPix({ authorization: 'buyer', storeId: 'official-store', productId: 'product', selectedMonths: 1 });
  const input = { authorization: 'buyer', storeId: 'official-store', checkoutId: q.checkoutId };
  await api.acceptOfficialPlanPix({ ...input, acceptedTotalMinor: q.quote.totalMinor });
  await Promise.allSettled(Array.from({ length: 4 }, () => api.checkoutOfficialPlanPix(input)));
  assert.equal(posts, 1);
  const pilot = await db.doc(root + '/official_plan_pix_pilot/one_shot').get();
  assert.equal(pilot.get('checkoutId'), q.checkoutId);
  assert.equal(pilot.get('buyerId'), 'buyer');
  payment = { ...payment, status: 'approved', status_detail: 'pending_waiting_payment',
    date_approved: new Date().toISOString() };
  await assert.rejects(api.reconcileOfficialPlanPix(input), /OFFICIAL_PIX_PAYMENT_NOT_CONFIRMED/,
    'an approved status without accredited detail must never activate benefits');
  assert.equal((await db.collection('stores/official-store/prepaidSubscriptionContracts').get()).size, 0);
  assert.equal((await db.doc(root + '/store_entitlements/buyer').get()).exists, false);
  payment = { ...payment, status_detail: 'accredited',
    date_approved: '2000-01-01T00:00:00.000Z' };
  await assert.rejects(api.reconcileOfficialPlanPix(input), /OFFICIAL_PIX_PAYMENT_NOT_CONFIRMED/,
    'provider approval cannot predate buyer acceptance');
  assert.equal((await db.collection('stores/official-store/prepaidSubscriptionContracts').get()).size, 0);
  assert.equal((await db.doc(root + '/store_entitlements/buyer').get()).exists, false);
  payment = { ...payment, date_approved: new Date().toISOString() };
  const results = await Promise.all(Array.from({ length: 4 }, () => api.reconcileOfficialPlanPix(input)));
  assert(results.every(result => result.state === 'activated'));
  const expectedPaidAt = payment.date_approved;
  assert(results.every(result => result.startsAt === expectedPaidAt),
    'the paid term must start at provider approval, not callback time');
  assert(results.every(result => result.expiresAt === results[0].expiresAt),
    'concurrent callbacks must preserve one immutable expiry');
  const repeated = await api.reconcileOfficialPlanPix(input);
  assert.equal(repeated.startsAt, expectedPaidAt,
    'later callbacks must never restart the paid term');
  assert.equal(repeated.expiresAt, results[0].expiresAt);
  assert.equal((await db.doc('stores/buyer-store').get()).get('plan'), 'pro');
  for (const path of ['subscriptions', 'prepaidSubscriptionContracts', 'payments', 'economicLedger', 'storePointLedger']) {
    assert.equal((await db.collection(`stores/official-store/${path}`).get()).size, 1, path);
  }
  assert.equal((await db.collection('users/buyer/xpLedger').get()).size, 1);
  assert.equal((await db.doc('stores/official-store/crmCustomers/buyer').get()).get('subscriptionStats.activeSubscriptionCount'), 1);
  assert.equal((await db.collection('stores/official-store/subscriptions/' + results[0].subscriptionId + '/benefitCycles').get()).size, 1);
  assert.equal((await db.doc('users/buyer/achievements/owner-defined-badge').get()).get('userId'), 'buyer');
  assert.equal(posts, 1);
});

test('buyer without a canonical store cannot be charged while pre-store checkout gate is enabled', async () => {
  for (const collection of await db.listCollections()) await db.recursiveDelete(collection);
  posts = 0;
  payment = undefined;
  process.env.KYRUB_OFFICIAL_PLAN_PIX_CHECKOUT_ENABLED = 'true';
  process.env.VERCEL_ENV = 'production';
  process.env.KYRUB_OFFICIAL_PLAN_PIX_PILOT_MODE = 'true';
  process.env.KYRUB_OFFICIAL_PLAN_PIX_PILOT_BUYER_UID = 'buyer';
  process.env.KYRUB_BILLING_MERCADO_PAGO_COLLECTOR_ID = '42';
  const root = 'kyrub_admin/control_plane';
  const modality = { schemaVersion: 1, mode: 'subscription', subscription: {
    schemaVersion: 1, autoRenew: true,
    billingInterval: { unit: 'month', count: 1 },
    benefit: { kind: 'access', unitsPerCycle: null },
  } };
  await Promise.all([
    db.doc('stores/official-store').set({ ownerId: 'owner', legacyTenantId: 'owner' }),
    db.doc('kyrub_admin/official_store').set({ canonicalStoreId: 'official-store' }),
    db.doc('stores/official-store/products/product').set({
      name: 'Pro', price: 197, publicationStatus: 'published',
      saleModality: modality, storePointsPerUnit: 0,
      contractDiscounts: [{ months: 1, discountPercent: 0 }],
    }),
    db.doc(root + '/official_plan_products/product').set({
      canonicalStoreId: 'official-store', productId: 'product',
      planId: 'pro', status: 'active', rewards: { xp: 0 },
    }),
  ]);
  const q = await api.quoteOfficialPlanPix({
    authorization: 'buyer', storeId: 'official-store',
    productId: 'product', selectedMonths: 1,
  });
  const quoted = await db.doc(root + '/plan_pix_checkouts/' + q.checkoutId).get();
  assert.equal(quoted.get('buyerStoreProvisioningRequired'), true,
    'a buyer without a store must be explicitly marked for later provisioning');
  assert.equal(quoted.get('buyerStoreId'), null,
    'no canonical store must be invented for the buyer');
  const input = { authorization: 'buyer', checkoutId: q.checkoutId };
  await api.acceptOfficialPlanPix({ ...input, acceptedTotalMinor: q.quote.totalMinor });
  await assert.rejects(
    api.checkoutOfficialPlanPix(input),
    /OFFICIAL_PIX_PENDING_ACTIVATION_NOT_READY/,
  );
  assert.equal(posts, 0, 'must not call Mercado Pago to create a charge');
  assert.equal((await db.collection('stores/official-store/prepaidSubscriptionContracts').get()).size, 0);
  assert.equal((await db.collection('stores/official-store/subscriptions').get()).size, 0);
  assert.equal((await db.doc(root + '/store_entitlements/buyer').get()).exists, false,
    'blocked checkout must not grant Pro or Business entitlement');
  assert.equal((await db.doc('users/buyer/stores/buyer').get()).exists, false,
    'blocked checkout must not provision a private store');
  assert.equal((await db.doc('stores/buyer').get()).exists, false,
    'blocked checkout must not create a canonical store');

  // The production gate remains closed. This branch is enabled only with a
  // localhost Firestore emulator and isolated fake Mercado Pago credentials.
  process.env.KYRUB_OFFICIAL_PIX_EMULATOR_PRESTORE_TEST = 'true';
  try {
    const pending = await api.checkoutOfficialPlanPix(input);
    assert.equal(posts, 1, 'the isolated provider must receive exactly one Pix POST');
    assert.equal((await db.doc(root + '/plan_pix_checkouts/' + q.checkoutId).get()).get('providerPaymentId'), '123');
    assert.equal((await db.doc('stores/buyer').get()).exists, false);
    const accepted = await db.doc(root + '/plan_pix_checkouts/' + q.checkoutId).get();
    await db.doc(root + '/plan_pix_checkouts/' + q.checkoutId).update({ status: 'outcome_unknown' });
    payment = { ...payment, status: 'approved', status_detail: 'accredited',
      date_approved: new Date(Date.parse(accepted.get('acceptedAt')) + 1000).toISOString() };
  } finally {
    delete process.env.KYRUB_OFFICIAL_PIX_EMULATOR_PRESTORE_TEST;
  }
  const results = await Promise.all(Array.from({ length: 4 }, () => api.reconcileOfficialPlanPix(input)));
  assert(results.every(result => result.state === 'activated'));
  const settledCheckout = await db.doc(root + '/plan_pix_checkouts/' + q.checkoutId).get();
  const settledSlot = await db.doc(root + '/store_subscriptions/buyer').get();
  assert.equal(settledCheckout.get('status'), 'activated',
    'new no-store payments must never enter the legacy paid_pending_activation state');
  assert.equal(settledSlot.get('checkoutReservationStatus'), 'complete',
    'new paid contracts must be complete without an Ativar loja action');
  const settledContract = await db.collection('stores/official-store/prepaidSubscriptionContracts').get();
  assert.equal(settledContract.size, 1);
  assert.notEqual(settledContract.docs[0].get('state'), 'paid_pending_activation',
    'new contracts must not inherit the legacy pending activation state');
  assert.equal(settledContract.docs[0].get('startsAt'), payment.date_approved,
    'the contract must start at payment approval before store creation');
  assert(results.every(result => result.startsAt === payment.date_approved));
  assert(results.every(result => result.expiresAt === results[0].expiresAt));
  assert.equal((await db.doc(root + '/store_entitlements/buyer').get()).get('plan'), 'pro');
  assert.equal((await db.doc(root + '/store_entitlements/buyer').get()).get('benefitStartsAt'), payment.date_approved);
  assert.equal((await db.doc('stores/buyer').get()).exists, false,
    'paid entitlement must not implicitly create a canonical store');
  assert.equal((await db.collection('stores/official-store/prepaidSubscriptionContracts').get()).size, 1);
  assert.equal((await db.collection('stores/official-store/subscriptions').get()).size, 1);
  assert.equal((await db.collection('stores/official-store/payments').get()).size, 1);
  assert.equal((await db.collection('stores/official-store/economicLedger').get()).size, 1);
  const repeated = await api.reconcileOfficialPlanPix(input);
  assert.equal(repeated.startsAt, payment.date_approved);
  assert.equal(repeated.expiresAt, results[0].expiresAt);
  assert.equal(posts, 1, 'reconciliation must not issue a second Pix charge');

  // Creating the private store later must inherit Pro, never reset the paid term.
  const entitlementBefore = (await db.doc(root + '/store_entitlements/buyer').get()).data()!;
  const created = await api.ensureFreePlanForStoreCreation('Bearer buyer');
  assert.equal(created.plan, 'pro');
  assert.equal(created.created, true);
  assert.ok(created.canonicalStoreId);
  assert.equal((await db.doc('users/buyer/stores/buyer').get()).get('plan'), 'pro');
  assert.equal((await db.doc('stores/buyer').get()).exists, false,
    'private provisioning must not fabricate a canonical store');
  const again = await api.ensureFreePlanForStoreCreation('Bearer buyer');
  assert.equal(again.plan, 'pro');
  assert.equal(again.created, false);
  assert.equal(again.canonicalStoreId, created.canonicalStoreId);
  const entitlementAfter = (await db.doc(root + '/store_entitlements/buyer').get()).data()!;
  assert.equal(entitlementAfter.benefitStartsAt, entitlementBefore.benefitStartsAt);
  assert.equal(entitlementAfter.benefitEndsAt, entitlementBefore.benefitEndsAt);
  // Create my store already committed canonical activation. Reconciliation
  // after that activation must preserve the original Pix term.
  const activatedCanonical = await db.doc('stores/' + created.canonicalStoreId).get();
  assert.equal(activatedCanonical.get('ownerId'), 'buyer');
  assert.equal(activatedCanonical.get('plan'), 'pro');
  assert.equal(activatedCanonical.get('publicationStatus'), 'paused');
  assert.ok(activatedCanonical.get('activatedAt'));
  const afterProvisioning = await api.reconcileOfficialPlanPix(input);
  assert.equal(afterProvisioning.startsAt, payment.date_approved);
  assert.equal(afterProvisioning.expiresAt, results[0].expiresAt);
  const afterCanonicalCreation = await api.ensureFreePlanForStoreCreation('Bearer buyer');
  assert.equal(afterCanonicalCreation.plan, 'pro',
    'canonical registration must not trigger a Free downgrade');
  assert.equal(afterCanonicalCreation.created, false);
  const privateStore = await db.doc('users/buyer/stores/buyer').get();
  assert.equal(privateStore.get('plan'), 'pro');
  assert.equal(privateStore.get('ownerId'), 'buyer');
  const entitlementAfterCanonical = (await db.doc(root + '/store_entitlements/buyer').get()).data()!;
  assert.equal(entitlementAfterCanonical.benefitStartsAt, entitlementBefore.benefitStartsAt);
  assert.equal(entitlementAfterCanonical.benefitEndsAt, entitlementBefore.benefitEndsAt);
  assert.equal((await db.doc('stores/' + created.canonicalStoreId).get()).get('plan'), 'pro');
  assert.equal((await db.collection('stores/official-store/prepaidSubscriptionContracts').get()).size, 1);
  assert.equal((await db.collection('stores/official-store/subscriptions').get()).size, 1);
});
