import { adminDb } from '../firebaseAdmin.js';
import { normalizeStorePromotion, type StorePromotion } from '../../src/utils/storePromotions.js';
import { quoteOfficialPlanPromotion } from './officialPlanPromotionQuote.js';

/**
 * Read-only ERP authority boundary for official plan coupons.
 * Coupons are created in the Official Store ERP, never in Control Plane.
 * This function neither reserves nor redeems a coupon and cannot issue Pix.
 */
export async function quoteOfficialPlanPromotionFromErp(input: {
  officialStoreId: string;
  officialProductId: string;
  buyerUid: string;
  contractTotalMinor: number;
  promotionId: string;
  now?: Date;
}) {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(input.officialStoreId) ||
      !/^[a-zA-Z0-9_-]{1,128}$/.test(input.officialProductId) ||
      !/^[a-zA-Z0-9_-]{1,128}$/.test(input.promotionId) ||
      !input.buyerUid) {
    throw new Error('OFFICIAL_PROMOTION_INVALID_INPUT');
  }
  // Fail closed unless the store is the canonical Official Store.
  const designation = await adminDb.doc('kyrub_admin/official_store').get();
  if (!designation.exists || designation.get('canonicalStoreId') !== input.officialStoreId) {
    throw new Error('OFFICIAL_PROMOTION_STORE_FORBIDDEN');
  }
  const document = await adminDb.doc(
    `stores/${input.officialStoreId}/promotions/${input.promotionId}`
  ).get();
  if (!document.exists) throw new Error('OFFICIAL_PROMOTION_NOT_FOUND');
  const promotion = normalizeStorePromotion({
    ...(document.data() as StorePromotion),
    id: document.id,
    storeId: input.officialStoreId,
  });
  return quoteOfficialPlanPromotion({ ...input, promotion });
}
