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
    db.doc(`${root}/official_plan_products/${productId}`).set({ canonicalStoreId: storeId, productId, planId: 'business', status: 'active' }),
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
  await checkoutRef.update({ acceptedOfferDigest: 'original-offer-digest' });
  const confirmation = { paymentId: 'simulated-pix-001', checkoutId, buyerUid,
    amountMinor: 100, currency: 'BRL', method: 'pix', status: 'approved' };
  await assert.rejects(api.confirmIsolatedOfficialPromotionPix({
    checkoutId, buyerUid, paidAt: '2026-11-16T12:00:00.000Z', confirmation: { ...confirmation, amountMinor: 39700 },
  }), /PAYMENT_MISMATCH/);
  const confirmations = await Promise.all(Array.from({ length: 4 }, () =>
    api.confirmIsolatedOfficialPromotionPix({ checkoutId, buyerUid, paidAt: '2026-11-16T12:00:00.000Z', confirmation })));
  assert.equal(confirmations.filter((x: any) => x.status === 'confirmed').length, 1);
  assert.equal(confirmations.filter((x: any) => x.status === 'already_confirmed').length, 3);
  const paymentClaims = await db.collection(`${root}/isolated_promotion_payment_claims`).get();
  assert.equal(paymentClaims.size, 1, 'concurrent callbacks claim provider payment only once');
  assert.equal(paymentClaims.docs[0].get('checkoutId'), checkoutId);
  assert.equal(paymentClaims.docs[0].get('amountMinor'), 100);
  // A second accepted checkout cannot claim the first checkout's provider payment ID.
  // Seed only the second checkout/reservation: the promotion itself has a one-use cap.
  const reusedCheckoutId = 'e'.repeat(64);
  const accepted = (await checkoutRef.get()).get('promotionAcceptedTerms');
  await Promise.all([
    db.doc(`${root}/plan_pix_checkouts/${reusedCheckoutId}`).set({
      checkoutId: reusedCheckoutId, buyerId: buyerUid, offer,
      offerDigest: 'second-offer-digest', acceptedOfferDigest: 'second-offer-digest',
      promotionAcceptedTerms: accepted, status: 'accepted',
    }),
    db.doc(`stores/${storeId}/promotionReservations/${(await import('node:crypto')).createHash('sha256').update('official-plan-promotion:' + reusedCheckoutId).digest('hex')}`).set({
      checkoutId: reusedCheckoutId, buyerUid, promotionId,
      payableMinor: 100, status: 'reserved',
    }),
  ]);
  await assert.rejects(api.confirmIsolatedOfficialPromotionPix({
    checkoutId: reusedCheckoutId, buyerUid, paidAt: '2026-11-16T12:00:00.000Z',
    confirmation: { ...confirmation, checkoutId: reusedCheckoutId },
  }), /PAYMENT_REUSED/, 'one provider payment cannot confirm two checkouts');
  assert.equal((await db.collection(`${root}/isolated_promotion_payment_claims`).get()).size, 1);
  assert.equal((await db.doc(`${root}/plan_pix_checkouts/${reusedCheckoutId}`).get()).get('status'), 'accepted');

  await assert.rejects(api.confirmIsolatedOfficialPromotionPix({
    checkoutId, buyerUid, paidAt: '2026-11-17T12:00:00.000Z', confirmation,
  }), /PAYMENT_REPLAY_CONFLICT/, 'replayed payment cannot change its approval time');
  await assert.rejects(api.confirmIsolatedOfficialPromotionPix({
    checkoutId, buyerUid, paidAt: 'not-a-date', confirmation,
  }), /INVALID_INPUT/, 'invalid provider approval time must fail closed');
  assert.equal((await checkoutRef.get()).get('providerPaidMinor'), 100);
  assert.equal((await checkoutRef.get()).get('status'), 'paid_pending_activation');
  for (const [start, expiry] of [
    ['2026-01-31T12:34:56.000Z', '2026-02-28T12:34:56.000Z'],
    ['2028-01-31T12:34:56.000Z', '2028-02-29T12:34:56.000Z'],
    ['2026-03-31T12:34:56.000Z', '2026-04-30T12:34:56.000Z'],
    ['2026-12-31T12:34:56.000Z', '2027-01-31T12:34:56.000Z'],
  ]) {
    assert.equal(api.calculateIsolatedBusinessExpiry(start).toISOString(), expiry);
  }
  const paidAt = '2026-11-16T12:00:00.000Z';
  const activations = await Promise.all(Array.from({ length: 4 }, () =>
    api.activateIsolatedPromotionalBusiness({ checkoutId, buyerUid })));
  assert.equal(activations.filter((x: any) => x.status === 'activated').length, 1);
  assert.equal(activations.filter((x: any) => x.status === 'already_activated').length, 3);
  const contract = await db.doc(`${root}/isolated_promotion_contracts/${checkoutId}`).get();
  const entitlement = await db.doc(`${root}/isolated_promotion_entitlements/${buyerUid}`).get();
  assert.equal(contract.get('planId'), 'business');
  assert.equal(contract.get('paidMinor'), 100);
  assert.equal(contract.get('startsAt'), paidAt);
  assert.equal(contract.get('endsAt'), '2026-12-16T12:00:00.000Z');
  assert.equal(entitlement.get('checkoutId'), checkoutId);
  assert.equal((await api.confirmIsolatedOfficialPromotionPix({
    checkoutId, buyerUid, paidAt, confirmation,
  })).status, 'already_confirmed', 'matching callback after activation is idempotent');
  await assert.rejects(api.confirmIsolatedOfficialPromotionPix({
    checkoutId, buyerUid, paidAt: '2026-11-17T12:00:00.000Z', confirmation,
  }), /PAYMENT_REPLAY_CONFLICT/, 'activation cannot change confirmed payment timestamp');
  await checkoutRef.update({ status: 'quoted' });
  await assert.rejects(api.confirmIsolatedOfficialPromotionPix({
    checkoutId, buyerUid, paidAt, confirmation,
  }), /PAYMENT_STATE_CONFLICT/, 'replay must reject inconsistent checkout state');
  await checkoutRef.update({ status: 'activated' });
  assert.equal((await db.collection(`${root}/isolated_promotion_contracts`).get()).size, 1);
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
