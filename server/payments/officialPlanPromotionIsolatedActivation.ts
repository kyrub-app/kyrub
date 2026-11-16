import { createHash } from 'node:crypto';
import { adminDb } from '../firebaseAdmin.js';
import { assertOfficialPromotionPaymentMatches } from './officialPlanPromotionAcceptedTerms.js';

const ROOT = 'kyrub_admin/control_plane';
const digest = (checkoutId: string) =>
  createHash('sha256').update('official-plan-promotion:' + checkoutId).digest('hex');

/**
 * Emulator-only Business entitlement projection for E2E. It is deliberately
 * separate from the real plan activation service and cannot touch production.
 */
export async function activateIsolatedPromotionalBusiness(input: {
  checkoutId: string;
  buyerUid: string;
}) {
  if (!/^(localhost|127\.0\.0\.1):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? '') ||
      process.env.KYRUB_OFFICIAL_PROMOTION_ISOLATED_PIX_TEST !== 'true') {
    throw Error('OFFICIAL_PROMOTION_EMULATOR_REQUIRED');
  }
  if (!/^[a-f0-9]{64}$/.test(input.checkoutId) ||
      !/^[a-zA-Z0-9_-]{1,128}$/.test(input.buyerUid)) {
    throw Error('OFFICIAL_PROMOTION_INVALID_INPUT');
  }
  const checkoutRef = adminDb.doc(`${ROOT}/plan_pix_checkouts/${input.checkoutId}`);
  const contractRef = adminDb.doc(`${ROOT}/isolated_promotion_contracts/${input.checkoutId}`);
  const entitlementRef = adminDb.doc(`${ROOT}/isolated_promotion_entitlements/${input.buyerUid}`);
  return adminDb.runTransaction(async tx => {
    const [checkout, contract, entitlement] = await Promise.all([
      tx.get(checkoutRef), tx.get(contractRef), tx.get(entitlementRef),
    ]);
    if (!checkout.exists || checkout.get('buyerId') !== input.buyerUid ||
        !['paid_pending_activation', 'activated'].includes(checkout.get('status')) ||
        checkout.get('simulatedPayment') !== true ||
        !checkout.get('providerPaymentId')) {
      throw Error('OFFICIAL_PROMOTION_PAYMENT_NOT_CONFIRMED');
    }
    const paidAt = checkout.get('providerPaidAt');
    if (typeof paidAt !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(paidAt) ||
        !Number.isFinite(Date.parse(paidAt))) {
      throw Error('OFFICIAL_PROMOTION_PAYMENT_DATE_REQUIRED');
    }
    const offer = checkout.get('offer');
    const accepted = checkout.get('promotionAcceptedTerms');
    if (!accepted || offer?.quote?.months !== 1 ||
        offer?.quote?.totalMinor !== 39700 ||
        accepted.payableMinor !== 100 ||
        checkout.get('providerPaidMinor') !== 100 ||
        accepted.originalTotalMinor !== 39700 ||
        checkout.get('acceptedOfferDigest') !== checkout.get('offerDigest')) {
      throw Error('OFFICIAL_PROMOTION_BUSINESS_OFFER_INVALID');
    }
    const designation = await tx.get(adminDb.doc('kyrub_admin/official_store'));
    const mapping = await tx.get(adminDb.doc(`${ROOT}/official_plan_products/${offer.productId}`));
    if (designation.get('canonicalStoreId') !== offer.storeId ||
        mapping.get('canonicalStoreId') !== offer.storeId ||
        mapping.get('planId') !== 'business' ||
        mapping.get('productId') !== offer.productId ||
        mapping.get('status') !== 'active') {
      throw Error('OFFICIAL_PROMOTION_BUSINESS_MAPPING_INVALID');
    }
    assertOfficialPromotionPaymentMatches(accepted, {
      buyerUid: input.buyerUid, officialStoreId: offer.storeId,
      officialProductId: offer.productId, months: 1,
      paidMinor: checkout.get('providerPaidMinor'), termsDigest: accepted.termsDigest,
    });
    const reservation = await tx.get(adminDb.doc(
      `stores/${offer.storeId}/promotionReservations/${digest(input.checkoutId)}`
    ));
    if (!reservation.exists || !['reserved', 'redeemed'].includes(reservation.get('status')) ||
        reservation.get('buyerUid') !== input.buyerUid ||
        reservation.get('promotionId') !== accepted.promotionId ||
        reservation.get('payableMinor') !== 100) {
      throw Error('OFFICIAL_PROMOTION_RESERVATION_REQUIRED');
    }
    if (contract.exists) {
      if (contract.get('paymentId') !== checkout.get('providerPaymentId') ||
          contract.get('buyerUid') !== input.buyerUid ||
          contract.get('startsAt') !== paidAt ||
          contract.get('termsDigest') !== accepted.termsDigest) {
        throw Error('OFFICIAL_PROMOTION_CONTRACT_CONFLICT');
      }
      return { status: 'already_activated' as const, contractId: input.checkoutId };
    }
    if (entitlement.exists && entitlement.get('checkoutId') !== input.checkoutId) {
      throw Error('OFFICIAL_PROMOTION_ACTIVE_PLAN_CONFLICT');
    }
    // Clamp the calendar day when the following month is shorter.
    const start = new Date(paidAt);
    const endsAt = new Date(start);
    const originalDay = start.getUTCDate();
    endsAt.setUTCDate(1);
    endsAt.setUTCMonth(endsAt.getUTCMonth() + 1);
    const lastDay = new Date(Date.UTC(endsAt.getUTCFullYear(), endsAt.getUTCMonth() + 1, 0)).getUTCDate();
    endsAt.setUTCDate(Math.min(originalDay, lastDay));
    const record = {
      checkoutId: input.checkoutId, buyerUid: input.buyerUid, planId: 'business',
      storeId: offer.storeId, productId: offer.productId,
      paymentId: checkout.get('providerPaymentId'),
      originalTotalMinor: 39700, paidMinor: 100, months: 1,
      promotionId: accepted.promotionId, termsDigest: accepted.termsDigest,
      startsAt: paidAt, endsAt: endsAt.toISOString(), simulated: true,
    };
    tx.create(contractRef, record);
    tx.set(entitlementRef, record);
    tx.update(checkoutRef, { status: 'activated', isolatedContractId: input.checkoutId });
    return { status: 'activated' as const, contractId: input.checkoutId };
  });
}
