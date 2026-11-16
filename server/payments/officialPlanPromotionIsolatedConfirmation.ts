import { createHash } from 'node:crypto';
import { adminDb } from '../firebaseAdmin.js';
import { verifyIsolatedOfficialPlanPromotionPix, type IsolatedOfficialPixConfirmation } from './officialPlanPromotionSimulatedPix.js';

/**
 * Emulator-only payment confirmation. Never calls Mercado Pago or grants a plan.
 * Stores a verified amount and payment identity for transactional coupon redemption.
 */
export async function confirmIsolatedOfficialPromotionPix(input: {
  checkoutId: string;
  buyerUid: string;
  confirmation: IsolatedOfficialPixConfirmation;
  paidAt: string;
}) {
  if (!/^(localhost|127\.0\.0\.1):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? '') ||
      process.env.KYRUB_OFFICIAL_PROMOTION_ISOLATED_PIX_TEST !== 'true') {
    throw new Error('OFFICIAL_PROMOTION_EMULATOR_REQUIRED');
  }
  if (!/^[a-f0-9]{64}$/.test(input.checkoutId) ||
      !/^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{3})?Z$/.test(input.paidAt) ||
      !Number.isFinite(Date.parse(input.paidAt))) {
    throw Error('OFFICIAL_PROMOTION_INVALID_INPUT');
  }
  const ref = adminDb.doc(`kyrub_admin/control_plane/plan_pix_checkouts/${input.checkoutId}`);
  return adminDb.runTransaction(async tx => {
    const checkout = await tx.get(ref);
    if (!checkout.exists || checkout.get('buyerId') !== input.buyerUid ||
        !checkout.get('promotionAcceptedTerms')) {
      throw Error('OFFICIAL_PROMOTION_CHECKOUT_CONFLICT');
    }
    const offer = checkout.get('offer');
    const accepted = checkout.get('promotionAcceptedTerms');
    const verified = verifyIsolatedOfficialPlanPromotionPix({
      checkoutId: input.checkoutId, buyerUid: input.buyerUid,
      offer, accepted, confirmation: input.confirmation,
    });
    const existingPayment = checkout.get('providerPaymentId');
    if (existingPayment) {
      if (existingPayment !== verified.simulatedPaymentId ||
          checkout.get('providerPaidMinor') !== verified.paidMinor ||
          checkout.get('simulatedPayment') !== true ||
          checkout.get('providerPaidAt') !== input.paidAt) {
        throw Error('OFFICIAL_PROMOTION_PAYMENT_REPLAY_CONFLICT');
      }
      return { status: 'already_confirmed' as const, ...verified };
    }
    if (!['quoted', 'accepted'].includes(checkout.get('status')) ||
        checkout.get('acceptedOfferDigest') !== checkout.get('offerDigest')) {
      throw Error('OFFICIAL_PROMOTION_CHECKOUT_NOT_ACCEPTED');
    }
    const reservationId = createHash('sha256').update('official-plan-promotion:' + input.checkoutId).digest('hex');
    const reservation = await tx.get(adminDb.doc(
      `stores/${accepted.officialStoreId}/promotionReservations/${reservationId}`
    ));
    if (!reservation.exists || reservation.get('status') !== 'reserved' ||
        reservation.get('buyerUid') !== input.buyerUid ||
        reservation.get('promotionId') !== accepted.promotionId ||
        reservation.get('payableMinor') !== verified.paidMinor) {
      throw Error('OFFICIAL_PROMOTION_RESERVATION_REQUIRED');
    }
    tx.update(ref, {
      status: 'paid_pending_activation',
      providerPaymentId: verified.simulatedPaymentId,
      providerPaidMinor: verified.paidMinor,
      providerPaidAt: input.paidAt,
      simulatedPayment: true,
    });
    return { status: 'confirmed' as const, ...verified };
  });
}
