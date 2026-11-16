import { createHash } from 'node:crypto';
import { adminDb } from '../firebaseAdmin.js';
import { assertOfficialPromotionPaymentMatches } from './officialPlanPromotionAcceptedTerms.js';

const ROOT = 'kyrub_admin/control_plane';
const valid = (value: string) => /^[a-zA-Z0-9_-]{1,128}$/.test(value);
const reservationId = (checkoutId: string) =>
  createHash('sha256').update('official-plan-promotion:' + checkoutId).digest('hex');
const buyerKey = (uid: string) => createHash('sha256').update(uid).digest('hex');

/**
 * Canonical ERP coupon lifecycle. Payment status and coupon terms are read
 * from the official checkout and its canonical payment document.
 * A never-issued quote may expire only before provider issuance starts.
 * An outcome-unknown Pix must never be released by a clock timeout.
 */
export async function finalizeOfficialPlanPromotionReservation(input: {
  checkoutId: string;
  officialStoreId: string;
  promotionId: string;
  outcome: 'redeem' | 'release' | 'expire_unissued';
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
    const slotRef = adminDb.doc(`${ROOT}/store_subscriptions/${reservation.get('buyerUid')}`);
    const [buyer, slot] = await Promise.all([tx.get(buyerRef), tx.get(slotRef)]);
    if (!buyer.exists || buyer.get('buyerUid') !== reservation.get('buyerUid') ||
        buyer.get('promotionId') !== input.promotionId) {
      throw new Error('OFFICIAL_PROMOTION_BUYER_COUNTER_CONFLICT');
    }
    const status = reservation.get('status');
    const finalStatus = input.outcome === 'redeem' ? 'redeemed' : 'released';
    if (status === finalStatus) return { status: 'already_finalized' as const };
    if (status !== 'reserved') throw new Error('OFFICIAL_PROMOTION_FINALIZATION_CONFLICT');
    const checkoutStatus = checkout.get('status');
    const timestamp = input.now ?? new Date();
    if (!Number.isFinite(timestamp.getTime())) throw Error('OFFICIAL_PROMOTION_INVALID_DATE');
    if (input.outcome === 'expire_unissued') {
      const accepted = checkout.get('promotionAcceptedTerms');
      if (checkoutStatus !== 'accepted' ||
          !accepted || accepted.promotionId !== input.promotionId ||
          accepted.termsDigest !== checkout.get('acceptedPromotionDigest') ||
          checkout.get('acceptedOfferDigest') !== checkout.get('offerDigest') ||
          !Number.isFinite(Date.parse(checkout.get('expiresAt'))) ||
          !Number.isFinite(Date.parse(reservation.get('expiresAt'))) ||
          Date.parse(checkout.get('expiresAt')) > timestamp.getTime() ||
          Date.parse(reservation.get('expiresAt')) > timestamp.getTime() ||
          checkout.get('requestBody') || checkout.get('requestDigest') ||
          checkout.get('collectorId') || checkout.get('providerPaymentId') ||
          checkout.get('contractId') || checkout.get('subscriptionId') ||
          slot.get('officialPixCheckoutId') === input.checkoutId) {
        // The checkout or the provider request may already be in flight.
        throw Error('OFFICIAL_PROMOTION_UNISSUED_EXPIRY_FORBIDDEN');
      }
    } else if (input.outcome === 'redeem') {
      const accepted = checkout.get('promotionAcceptedTerms');
      const providerPaymentId = checkout.get('providerPaymentId');
      // The canonical payment document is created by the existing Mercado Pago
      // reconciliation transaction, not by a caller-controlled test adapter.
      const verifiedPayment = typeof providerPaymentId === 'string' &&
        /^\d{1,32}$/.test(providerPaymentId)
        ? await tx.get(adminDb.doc(
          `stores/${input.officialStoreId}/payments/official_pix_${providerPaymentId}`
        )) : null;
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
          checkout.get('acceptedPromotionDigest') !== accepted.termsDigest ||
          !verifiedPayment?.exists ||
          verifiedPayment.get('status') !== 'paid' ||
          verifiedPayment.get('method') !== 'pix' ||
          verifiedPayment.get('currency') !== 'BRL' ||
          verifiedPayment.get('provider') !== 'mercado-pago' ||
          verifiedPayment.get('providerPaymentId') !== providerPaymentId ||
          verifiedPayment.get('paymentIntentId') !== input.checkoutId ||
          verifiedPayment.get('amount') !== accepted.payableMinor / 100) {
        throw new Error('OFFICIAL_PROMOTION_PAYMENT_NOT_CONFIRMED');
      }
      assertOfficialPromotionPaymentMatches(accepted, {
        buyerUid: reservation.get('buyerUid'),
        officialStoreId: input.officialStoreId,
        officialProductId: reservation.get('productId'),
        months: accepted.months,
        paidMinor: Math.round(verifiedPayment!.get('amount') * 100),
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
    tx.update(reservationRef, { status: finalStatus, finalizedAt: timestamp.toISOString() });
    if (slot.get('officialPromotionReservationCheckoutId') === input.checkoutId) {
      tx.set(slotRef, { officialPromotionReservationCheckoutId: null }, { merge: true });
    }
    if (input.outcome === 'expire_unissued') {
      tx.update(checkoutRef, { status: 'expired', expiredAt: timestamp.toISOString() });
    }
    return { status: finalStatus };
  });
}
