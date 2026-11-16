import { adminDb } from '../firebaseAdmin.js';
import { normalizeStorePromotion, type StorePromotion } from '../../src/utils/storePromotions.js';
import { buildOfficialPromotionAcceptedTerms } from './officialPlanPromotionAcceptedTerms.js';

/**
 * Persist an ERP coupon snapshot on an existing official checkout ONLY inside
 * the Firebase Emulator. This is a test adapter, not a public API endpoint.
 * It does not call Mercado Pago, grant entitlements or enable the Pix pilot.
 */
export async function attachIsolatedOfficialPromotionToCheckout(input: {
  checkoutId: string;
  buyerUid: string;
  promotionId: string;
  now?: Date;
}) {
  if (!/^(localhost|127\.0\.0\.1):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? '') ||
      process.env.KYRUB_OFFICIAL_PROMOTION_ISOLATED_PIX_TEST !== 'true') {
    throw new Error('OFFICIAL_PROMOTION_EMULATOR_REQUIRED');
  }
  if (!/^[a-f0-9]{64}$/.test(input.checkoutId) ||
      !/^[a-zA-Z0-9_-]{1,128}$/.test(input.buyerUid) ||
      !/^[a-zA-Z0-9_-]{1,128}$/.test(input.promotionId)) {
    throw new Error('OFFICIAL_PROMOTION_INVALID_INPUT');
  }
  const checkoutRef = adminDb.doc(
    `kyrub_admin/control_plane/plan_pix_checkouts/${input.checkoutId}`
  );
  const checkoutDoc = await checkoutRef.get();
  if (!checkoutDoc.exists || checkoutDoc.get('buyerId') !== input.buyerUid) {
    throw new Error('OFFICIAL_PROMOTION_CHECKOUT_FORBIDDEN');
  }
  const offer = checkoutDoc.get('offer');
  const storeId = offer?.storeId;
  const productId = offer?.productId;
  const months = offer?.quote?.months;
  const originalTotalMinor = offer?.quote?.totalMinor;
  if (typeof storeId !== 'string' || typeof productId !== 'string' ||
      ![1, 3, 6, 12].includes(months) ||
      !Number.isSafeInteger(originalTotalMinor) || originalTotalMinor < 1) {
    throw new Error('OFFICIAL_PROMOTION_OFFER_INVALID');
  }
  const designationRef = adminDb.doc('kyrub_admin/official_store');
  const promotionRef = adminDb.doc(`stores/${storeId}/promotions/${input.promotionId}`);
  return adminDb.runTransaction(async tx => {
    const [checkout, designation, promotionDoc] = await Promise.all([
      tx.get(checkoutRef), tx.get(designationRef), tx.get(promotionRef),
    ]);
    if (!checkout.exists || checkout.get('buyerId') !== input.buyerUid ||
        checkout.get('status') !== 'quoted' ||
        checkout.get('offerDigest') !== checkoutDoc.get('offerDigest') ||
        designation.get('canonicalStoreId') !== storeId ||
        checkout.get('offer')?.storeId !== storeId ||
        checkout.get('offer')?.productId !== productId ||
        checkout.get('offer')?.quote?.months !== months ||
        checkout.get('offer')?.quote?.totalMinor !== originalTotalMinor) {
      throw new Error('OFFICIAL_PROMOTION_CHECKOUT_CHANGED');
    }
    if (!promotionDoc.exists) throw new Error('OFFICIAL_PROMOTION_NOT_FOUND');
    const promotion = normalizeStorePromotion({
      ...(promotionDoc.data() as StorePromotion),
      id: promotionDoc.id, storeId,
    });
    const accepted = buildOfficialPromotionAcceptedTerms({
      promotion, officialStoreId: storeId, officialProductId: productId,
      buyerUid: input.buyerUid, months, contractTotalMinor: originalTotalMinor,
      now: input.now,
    });
    if (checkout.get('promotionAcceptedTerms')) {
      if (checkout.get('promotionAcceptedTerms').termsDigest !== accepted.termsDigest) {
        throw new Error('OFFICIAL_PROMOTION_ACCEPTED_TERMS_CONFLICT');
      }
      return { status: 'already_attached' as const, accepted };
    }
    tx.update(checkoutRef, { promotionAcceptedTerms: accepted });
    return { status: 'attached' as const, accepted };
  });
}
