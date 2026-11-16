import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { loadOfficialPromotionEmulatorFixture } from './helpers/officialPromotionEmulatorFixture.js';

if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')) {
  throw Error('LOCAL_FIRESTORE_EMULATOR_REQUIRED');
}
process.env.KYRUB_OFFICIAL_PROMOTION_ISOLATED_PIX_TEST = 'true';
const app = initializeApp({ projectId: 'demo-kyrub-official-promotion' }, 'official-promotion-e2e');
const db = getFirestore(app);
const api = await loadOfficialPromotionEmulatorFixture(db);
after(async () => { await db.terminate(); await deleteApp(app); });
const root = 'kyrub_admin/control_plane';
const storeId = 'official-store';
const productId = 'business';
const promotionId = 'erp-business-one-real';
const buyerUid = 'third-fictitious-user';
const checkoutId = 'c'.repeat(64);
const checkoutRef = db.doc(`${root}/plan_pix_checkouts/${checkoutId}`);
const promotionRef = db.doc(`stores/${storeId}/promotions/${promotionId}`);
const promotion = {
  storeId, code: 'BUSINESS-UM-REAL', title: 'Piloto Business',
  badge: 'PILOTO', discountType: 'fixed', discountValue: 396,
  productIds: [productId], eligibility: { mode: 'public' }, active: true,
  startsAt: '2026-01-01T00:00:00.000Z', endsAt: '2027-01-01T00:00:00.000Z',
  maxRedemptions: 1, maxRedemptionsPerBuyer: 1, redemptionCount: 0,
  createdBy: 'owner', createdVia: 'manual', actionId: 'pilot',
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
};
const offer = { storeId, productId, quote: { months: 1, totalMinor: 39700 } };
const args = { checkoutId, buyerUid, officialStoreId: storeId, officialProductId: productId,
  promotionId, contractTotalMinor: 39700, now: new Date('2026-11-16T12:00:00Z') };

test('ERP coupon snapshot, transactional reservation and one-time redemption in Firestore Emulator', async () => {
  for (const collection of await db.listCollections()) await db.recursiveDelete(collection);
  await Promise.all([
    db.doc('kyrub_admin/official_store').set({ canonicalStoreId: storeId }),
    promotionRef.set(promotion),
    checkoutRef.set({ checkoutId, buyerId: buyerUid, offer, offerDigest: 'original-offer-digest',
      status: 'quoted' }),
  ]);
  const attach = await api.attachIsolatedOfficialPromotionToCheckout({
    checkoutId, buyerUid, promotionId, now: args.now,
  });
  assert.equal(attach.accepted.payableMinor, 100);
  const repeated = await api.attachIsolatedOfficialPromotionToCheckout({
    checkoutId, buyerUid, promotionId, now: args.now,
  });
  assert.equal(repeated.status, 'already_attached');
  const concurrent = await Promise.all(Array.from({ length: 4 }, () =>
    api.reserveOfficialPlanPromotionForCheckout(args)));
  assert.equal(concurrent.filter((x: any) => x.status === 'reserved').length, 1);
  assert.equal((await promotionRef.get()).get('reservedCount'), 1);
  const otherCheckout = 'd'.repeat(64);
  await db.doc(`${root}/plan_pix_checkouts/${otherCheckout}`).set({
    checkoutId: otherCheckout, buyerId: 'another-buyer', offer,
    offerDigest: 'another-offer-digest', status: 'quoted',
  });
  await assert.rejects(api.reserveOfficialPlanPromotionForCheckout({
    ...args, checkoutId: otherCheckout, buyerUid: 'another-buyer',
  }), /ACCEPTED_TERMS_REQUIRED/);
  await assert.rejects(api.finalizeOfficialPlanPromotionReservation({
    checkoutId, officialStoreId: storeId, promotionId, outcome: 'redeem',
  }), /PAYMENT_NOT_CONFIRMED/);
  // Emulator-only test fixture simulates the persisted result of an already
  // reconciled payment; it does NOT represent an actual Mercado Pago callback.
  await checkoutRef.update({
    status: 'activated', acceptedOfferDigest: 'original-offer-digest',
    providerPaymentId: 'simulated-pix-001',
  });
  const finalized = await Promise.all(Array.from({ length: 4 }, () =>
    api.finalizeOfficialPlanPromotionReservation({
      checkoutId, officialStoreId: storeId, promotionId, outcome: 'redeem',
    })));
  assert.equal(finalized.filter((x: any) => x.status === 'redeemed').length, 1);
  assert.equal(finalized.filter((x: any) => x.status === 'already_finalized').length, 3);
  const updated = await promotionRef.get();
  assert.equal(updated.get('reservedCount'), 0);
  assert.equal(updated.get('redemptionCount'), 1);
  const buyerCounters = await db.collection(`stores/${storeId}/promotionBuyerReservations`).get();
  assert.equal(buyerCounters.size, 1);
  assert.equal(buyerCounters.docs[0].get('reservationCount'), 0);
  assert.equal(buyerCounters.docs[0].get('redemptionCount'), 1);
});
