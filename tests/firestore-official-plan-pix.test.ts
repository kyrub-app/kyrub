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
  payment = { ...payment, status: 'approved', status_detail: 'accredited', date_approved: new Date().toISOString() };
  const results = await Promise.all(Array.from({ length: 4 }, () => api.reconcileOfficialPlanPix(input)));
  assert(results.every(result => result.state === 'activated'));
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
  const input = { authorization: 'buyer', checkoutId: q.checkoutId };
  await api.acceptOfficialPlanPix({ ...input, acceptedTotalMinor: q.quote.totalMinor });
  await assert.rejects(
    api.checkoutOfficialPlanPix(input),
    /OFFICIAL_PIX_PENDING_ACTIVATION_NOT_READY/,
  );
  assert.equal(posts, 0, 'must not call Mercado Pago to create a charge');
  assert.equal((await db.collection('stores/official-store/prepaidSubscriptionContracts').get()).size, 0);
  assert.equal((await db.collection('stores/official-store/subscriptions').get()).size, 0);
});
