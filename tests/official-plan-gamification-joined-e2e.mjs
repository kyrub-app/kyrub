/**
 * Cross-PR, single-user canonical journey. Only run after PR #1137 is
 * overlaid on PR #1138 in an ephemeral CI worktree; never deployed.
 *
 * The isolated transport stubs only Firebase user authentication and the
 * Mercado Pago HTTP boundary. It does not duplicate transactions, ledgers,
 * catalog rules, coupons, contracts or publication rewards.
 */
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { loadOfficialPlanPixFixture } from './helpers/officialPlanPixFixture.ts';
import { grantCleanBaselineWelcomeInTransaction } from '../server/gamification/cleanBaselineWelcomeTransaction.ts';
import { publishFirstStoreAndAwardXp } from '../server/gamification/firstStorePublicationAuthority.ts';

if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')) {
  throw Error('LOCAL_FIRESTORE_EMULATOR_REQUIRED');
}
if (process.env.GCLOUD_PROJECT !== 'demo-kyrub-pix') {
  throw Error('UNEXPECTED_FIREBASE_PROJECT');
}
const app = initializeApp({ projectId: 'demo-kyrub-pix' }, 'joined-gamification-and-official-pix');
const db = getFirestore(app);
let payment = null;
let pixPosts = 0;
globalThis.__officialPix = {
  db,
  auth: async authorization => {
    assert.equal(authorization, 'buyer');
    return { uid: 'buyer', email: 'buyer@example.invalid', emailVerified: true };
  },
  request: async (path, init) => {
    if (path === '/users/me') return { id: '42' };
    if (path === '/v1/payments' && init?.method === 'POST') {
      pixPosts++;
      payment = {
        ...JSON.parse(String(init.body)), id: '123', status: 'pending',
        collector_id: '42', currency_id: 'BRL', live_mode: true,
        point_of_interaction: { transaction_data: { qr_code: 'EMULATOR-ONLY-PIX' } },
      };
      return payment;
    }
    if (path === '/v1/payments/123') return payment;
    if (path.startsWith('/v1/payments/search?')) {
      return { paging: { total: payment ? 1 : 0 }, results: payment ? [payment] : [] };
    }
    throw Error('UNEXPECTED_EXTERNAL_ACCESS:' + path);
  },
};
const api = await loadOfficialPlanPixFixture();
after(async () => {
  api.restoreFixture();
  await db.terminate();
  await deleteApp(app);
});

test('same buyer: 100 Pitangas → Free → 2 XP first publication → official Business R$1', async () => {
  for (const collection of await db.listCollections()) await db.recursiveDelete(collection);
  pixPosts = 0; payment = null;
  process.env.KYRUB_OFFICIAL_PLAN_PIX_CHECKOUT_ENABLED = 'true';
  process.env.KYRUB_OFFICIAL_PLAN_PIX_PILOT_MODE = 'true';
  process.env.KYRUB_OFFICIAL_PLAN_PIX_PILOT_BUYER_UID = 'buyer';
  process.env.KYRUB_OFFICIAL_PROMOTION_ISOLATED_PIX_TEST = 'true';
  process.env.KYRUB_BILLING_MERCADO_PAGO_COLLECTOR_ID = '42';
  process.env.VERCEL_ENV = 'production';
  const now = Date.now();
  const createdAt = new Date(now - 15000).toISOString();
  const cutoff = new Date(now - 3600000).toISOString();
  const root = 'kyrub_admin/control_plane';
  const userRoot = db.collection('users').doc('buyer');
  const promotionRef = db.doc('stores/official-store/promotions/one-real-business-coupon');
  const challenge = {
    id: 'first_store_published',
    title: 'Primeira publicação',
    description: 'Publique a primeira loja',
    status: 'published',
    validationMode: 'deterministic',
    sponsorType: 'kyrub',
    rewardKCoins: 0,
    rewardXp: 2,
    maxCompletionsPerUser: 1,
  };
  const saleModality = {
    schemaVersion: 1, mode: 'subscription',
    subscription: {
      schemaVersion: 1, autoRenew: false,
      billingInterval: { unit: 'month', count: 1 },
      benefit: { kind: 'access', unitsPerCycle: null },
    },
  };
  await Promise.all([
    db.doc('stores/official-store').set({
      ownerId: 'owner', legacyTenantId: 'owner',
      name: 'Kyrub Oficial', publicationStatus: 'published',
    }),
    db.doc('kyrub_admin/official_store').set({ canonicalStoreId: 'official-store' }),
    db.doc('global_challenges/first_store_published').set(challenge),
    db.doc('stores/official-store/products/business').set({
      name: 'Kyrub Business', price: 397, publicationStatus: 'published',
      saleModality, storePointsPerUnit: 0,
      contractDiscounts: [{ months: 1, discountPercent: 0 }],
    }),
    db.doc(root + '/official_plan_products/business').set({
      canonicalStoreId: 'official-store', productId: 'business',
      planId: 'business', status: 'active', rewards: { xp: 0 },
    }),
    promotionRef.set({
      id: 'one-real-business-coupon', storeId: 'official-store',
      code: 'BIZ1', title: 'Business piloto', badge: 'PILOTO',
      discountType: 'fixed', discountValue: 396, productIds: ['business'],
      eligibility: { mode: 'public' }, active: true,
      startsAt: new Date(now - 3600000).toISOString(),
      endsAt: new Date(now + 3600000).toISOString(),
      maxRedemptions: 1, maxRedemptionsPerBuyer: 1, redemptionCount: 0,
      createdBy: 'owner', createdVia: 'manual', actionId: 'joined-emulator',
      createdAt: createdAt, updatedAt: createdAt,
    }),
    userRoot.collection('authEvents').doc('first_login_v1').set({
      userId: 'buyer', eventType: 'first_login', schemaVersion: 1,
      issuer: 'trusted_auth_server', sourceEventId: 'emulator-auth-created-buyer',
      firebaseCreatedAt: createdAt, occurredAt: createdAt,
    }),
  ]);

  // PR #1137's real transactional welcome writer, not an invented bonus.
  const firstLogin = () => db.runTransaction(tx => grantCleanBaselineWelcomeInTransaction(tx, {
    userId: 'buyer', firebaseCreatedAt: createdAt, campaignEffectiveAt: cutoff,
    isolatedCleanBaseline: true,
    receiptRef: userRoot.collection('authEvents').doc('first_login_v1'),
    balanceRef: userRoot.collection('pitangaBalance').doc('balance'),
    ledgerCollection: userRoot.collection('rewardLedger'),
    awardRef: userRoot.collection('rewardLedger').doc('earn_first_login_welcome_v1'),
  }));
  const welcomes = await Promise.all(Array.from({ length: 3 }, () => firstLogin()));
  assert.equal(welcomes.filter(x => !x.replay).length, 1);
  assert.equal(welcomes.filter(x => x.replay).length, 2);
  assert.equal((await userRoot.collection('pitangaBalance').doc('balance').get()).get('availableKCoins'), 100);
  assert.equal((await userRoot.collection('rewardLedger').get()).size, 1);

  // The actual "Criar minha loja" service, not a pre-seeded Free mirror.
  const free = await api.ensureFreePlanForStoreCreation('Bearer buyer');
  assert.equal(free.created, true);
  assert.equal(free.plan, 'free');
  const canonicalStore = db.doc('stores/' + free.canonicalStoreId);
  const beforePublish = await canonicalStore.get();
  assert.equal(beforePublish.get('firstStoreCreationVerified'), true);
  assert.equal(beforePublish.get('publicationStatus'), 'paused');
  assert.equal((await userRoot.collection('xpLedger').get()).size, 0,
    'creating a store must not give publication XP');
  const freeReplay = await api.ensureFreePlanForStoreCreation('Bearer buyer');
  assert.equal(freeReplay.canonicalStoreId, free.canonicalStoreId);
  assert.equal(freeReplay.created, false);

  // Fill the normal store profile; publish through the real first-publication
  // authority used by the existing HTTP handler and UI.
  await userRoot.collection('stores').doc('buyer').set({
    name: 'Loja Buyer', slug: 'loja-buyer',
    description: '', address: '', logo: '', banner: '',
    primaryColor: '#ffffff', keywords: [], status: 'open',
  }, { merge: true });
  const published = await publishFirstStoreAndAwardXp(db, {
    authenticatedUserId: 'buyer', canonicalStoreId: free.canonicalStoreId,
  });
  assert.deepEqual(published, { replay: false, pitangas: 0, xp: 2 });
  const again = await publishFirstStoreAndAwardXp(db, {
    authenticatedUserId: 'buyer', canonicalStoreId: free.canonicalStoreId,
  });
  assert.deepEqual(again, { replay: true, pitangas: 0, xp: 2 });
  assert.equal((await userRoot.collection('xpLedger').get()).size, 1);
  assert.equal((await userRoot.collection('xpLedger').get()).docs[0].get('deltaXp'), 2);
  assert.equal((await userRoot.collection('rewardLedger').get()).size, 1,
    'first publication must not add Pitangas');
  assert.equal((await canonicalStore.get()).get('publicationStatus'), 'published');

  // PR #1138's real official Pix service, real ERP promotion reservation,
  // real contract / entitlement transactions, fake provider HTTP boundary.
  const quote = await api.quoteOfficialPlanPix({
    authorization: 'buyer', storeId: 'official-store',
    productId: 'business', selectedMonths: 1, promotionCode: 'BIZ1',
  });
  assert.equal(quote.quote.originalTotalMinor, 39700);
  assert.equal(quote.quote.promotionDiscountMinor, 39600);
  assert.equal(quote.quote.totalMinor, 100);
  const billing = { authorization: 'buyer', checkoutId: quote.checkoutId };
  await api.acceptOfficialPlanPix({ ...billing, acceptedTotalMinor: 100 });
  assert.equal((await promotionRef.get()).get('reservedCount'), 1);
  const issued = await api.checkoutOfficialPlanPix(billing);
  assert.equal(issued.state, 'awaiting_payment');
  assert.equal(pixPosts, 1);
  assert.equal(payment.transaction_amount, 1);
  const approvedAt = new Date().toISOString();
  payment = {
    ...payment, status: 'approved', status_detail: 'accredited',
    date_approved: approvedAt,
  };
  const reconciled = await Promise.all(Array.from({ length: 3 }, () =>
    api.reconcileOfficialPlanPix(billing)));
  assert(reconciled.every(x => x.state === 'activated' && x.startsAt === approvedAt));
  assert.equal((await db.doc(root + '/store_entitlements/buyer').get()).get('plan'), 'business');
  assert.equal((await canonicalStore.get()).get('plan'), 'business');
  assert.equal((await db.collection('stores/official-store/prepaidSubscriptionContracts').get()).size, 1);
  const contract = (await db.collection('stores/official-store/prepaidSubscriptionContracts').get()).docs[0];
  assert.equal(contract.get('totalPaidMinor'), 100);
  assert.equal(contract.get('monthlyBasePriceMinor'), 39700);
  assert.equal(contract.get('promotion.discountMinor'), 39600);
  assert.equal((await db.collection('stores/official-store/payments').get()).docs[0].get('amount'), 1);
  assert.equal((await promotionRef.get()).get('redemptionCount'), 1);
  assert.equal((await promotionRef.get()).get('reservedCount'), 0);
  assert.equal((await userRoot.collection('pitangaBalance').doc('balance').get()).get('availableKCoins'), 100);
  assert.equal((await userRoot.collection('rewardLedger').get()).size, 1);
  assert.equal((await userRoot.collection('xpLedger').get()).size, 1);
  assert.equal(pixPosts, 1, 'repeated callback cannot issue another payment');
});
