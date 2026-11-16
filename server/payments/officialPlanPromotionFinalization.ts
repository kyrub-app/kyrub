import { createHash } from 'node:crypto';
import { adminDb } from '../firebaseAdmin.js';
import { assertOfficialPromotionPaymentMatches } from './officialPlanPromotionAcceptedTerms.js';

const ROOT = 'kyrub_admin/control_plane';
const valid = (value: string) => /^[a-zA-Z0-9_-]{1,128}$/.test(value);
const reservationId = (checkoutId: string) =>
  createHash('sha256').update('official-plan-promotion:' + checkoutId).digest('hex');
const buyerKey = (uid: string) => createHash('sha256').update(uid).digest('hex');

/**
 * Isolated reservation lifecycle. The official checkout must become the source
 * of truth before this helper can be called in any real payment flow.
 *
 * Releasing requires a persisted terminal unpaid checkout; consuming requires
 * a persisted paid checkout and matching accepted amount. Caller-supplied
 * payment status is never trusted.
 */
export async function finalizeOfficialPlanPromotionReservation(input: {
  checkoutId: string;
  officialStoreId: string;
  promotionId: string;
  outcome: 'redeem' | 'release';
  now?: Date;
}) {
  if (![input.checkoutId, input.officialStoreId, input.promotionId].every(valid)) {
    throw new Error('OFFICIAL_PROMOTION_INVALID_INPUT');
  }
  const designation = await adminDb.doc('kyrub_admin/official_store').get();
  if (designation.get('canonicalStoreId') !== input.officialStoreId) {
    throw new Error('OFFICIAL_PROMOTION_STORE_FORBIDDEN');
  }
  const reservationRef = adminDb.doc(
    `stores/${input.officialStoreId}/promotionReservations/${reservationId(input.checkoutId)}`
  );
  const promotionRef = adminDb.doc(
    `stores/${input.officialStoreId}/promotions/${input.promotionId}`
  );
  const checkoutRef = adminDb.doc(`${ROOT}/plan_pix_checkouts/${input.checkoutId}`);
  return adminDb.runTransaction(async tx => {
    const [reservation, promotion, checkout] = await Promise.all([
      tx.get(reservationRef), tx.get(promotionRef), tx.get(checkoutRef),
    ]);
    if (!reservation.exists || !promotion.exists || !checkout.exists ||
        reservation.get('checkoutId') !== input.checkoutId ||
        reservation.get('promotionId') !== input.promotionId ||
        reservation.get('buyerUid') !== checkout.get('buyerId')) {
      throw new Error('OFFICIAL_PROMOTION_FINALIZATION_CONFLICT');
    }
    const buyerRef = adminDb.doc(
      `stores/${input.officialStoreId}/promotionBuyerReservations/${input.promotionId}_${buyerKey(reservation.get('buyerUid'))}`
    );
    const buyer = await tx.get(buyerRef);
    if (!buyer.exists || buyer.get('buyerUid') !== reservation.get('buyerUid') ||
        buyer.get('promotionId') !== input.promotionId) {
      throw new Error('OFFICIAL_PROMOTION_BUYER_COUNTER_CONFLICT');
    }
    const status = reservation.get('status');
    const finalStatus = input.outcome === 'redeem' ? 'redeemed' : 'released';
    if (status === finalStatus) return { status: 'already_finalized' as const };
    if (status !== 'reserved') throw new Error('OFFICIAL_PROMOTION_FINALIZATION_CONFLICT');
    const checkoutStatus = checkout.get('status');
    if (input.outcome === 'redeem') {
      const accepted = checkout.get('promotionAcceptedTerms');
      if (!['activated', 'paid_pending_activation'].includes(checkoutStatus) ||
          !accepted || accepted.payableMinor !== reservation.get('payableMinor') ||
          accepted.originalTotalMinor !== reservation.get('originalTotalMinor') ||
          accepted.promotionId !== input.promotionId ||
          accepted.buyerUid !== reservation.get('buyerUid') ||
          accepted.officialProductId !== reservation.get('productId') ||
          accepted.officialStoreId !== input.officialStoreId ||
          checkout.get('offer')?.storeId !== input.officialStoreId ||
          checkout.get('offer')?.productId !== reservation.get('productId') ||
          checkout.get('offer')?.quote?.totalMinor !== accepted.originalTotalMinor ||
          checkout.get('acceptedOfferDigest') !== checkout.get('offerDigest') ||
          !checkout.get('providerPaymentId') ||
          checkout.get('simulatedPayment') !== true ||
          checkout.get('providerPaidMinor') !== accepted.payableMinor) {
        throw new Error('OFFICIAL_PROMOTION_PAYMENT_NOT_CONFIRMED');
      }
      assertOfficialPromotionPaymentMatches(accepted, {
        buyerUid: reservation.get('buyerUid'),
        officialStoreId: input.officialStoreId,
        officialProductId: reservation.get('productId'),
        months: accepted.months,
        paidMinor: checkout.get('providerPaidMinor'),
        termsDigest: accepted.termsDigest,
      });
    } else if (!['expired', 'cancelled', 'rejected'].includes(checkoutStatus)) {
      // A timed-out reservation cannot be released while the Pix outcome is unknown.
      throw new Error('OFFICIAL_PROMOTION_CHECKOUT_NOT_TERMINAL');
    }
    const reservedCount = promotion.get('reservedCount');
    const buyerCount = buyer.get('reservationCount');
    if (!Number.isSafeInteger(reservedCount) || reservedCount < 1 ||
        !Number.isSafeInteger(buyerCount) || buyerCount < 1) {
      throw new Error('OFFICIAL_PROMOTION_COUNTER_CONFLICT');
    }
    const updates: Record<string, number> = { reservedCount: reservedCount - 1 };
    if (input.outcome === 'redeem') {
      const redeemed = promotion.get('redemptionCount');
      if (!Number.isSafeInteger(redeemed) || redeemed < 0) throw new Error('OFFICIAL_PROMOTION_COUNTER_CONFLICT');
      updates.redemptionCount = redeemed + 1;
    }
    tx.update(promotionRef, updates);
    const redeemedByBuyer = buyer.get('redemptionCount') ?? 0;
    if (!Number.isSafeInteger(redeemedByBuyer) || redeemedByBuyer < 0) {
      throw new Error('OFFICIAL_PROMOTION_COUNTER_CONFLICT');
    }
    tx.update(buyerRef, {
      reservationCount: buyerCount - 1,
      redemptionCount: redeemedByBuyer + (input.outcome === 'redeem' ? 1 : 0),
    });
    tx.update(reservationRef, { status: finalStatus, finalizedAt: (input.now ?? new Date()).toISOString() });
    return { status: finalStatus };
  });
}
