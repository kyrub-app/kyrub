import { adminDb } from '../firebaseAdmin.js';
import { normalizePromotionCode, normalizeStorePromotion, type StorePromotion } from '../../src/utils/storePromotions.js';
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

/**
 * Resolve the public Praça coupon code against the ERP's canonical promotion
 * collection. Reject duplicate normalized codes instead of guessing a winner.
 * The buyer UID and authoritative contract price must come from server auth
 * and the official plan catalog, never the public URL.
 */
export async function resolveOfficialPlanPromotionCodeFromErp(input: {
  officialStoreId: string;
  officialProductId: string;
  buyerUid: string;
  contractTotalMinor: number;
  code: string;
  now?: Date;
}) {
  const code = normalizePromotionCode(input.code);
  if (!code || code !== input.code.trim().toUpperCase()) {
    throw new Error('OFFICIAL_PROMOTION_CODE_INVALID');
  }
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(input.officialStoreId) ||
      !/^[a-zA-Z0-9_-]{1,128}$/.test(input.officialProductId) ||
      !input.buyerUid) {
    throw new Error('OFFICIAL_PROMOTION_INVALID_INPUT');
  }
  const designation = await adminDb.doc('kyrub_admin/official_store').get();
  if (!designation.exists || designation.get('canonicalStoreId') !== input.officialStoreId) {
    throw new Error('OFFICIAL_PROMOTION_STORE_FORBIDDEN');
  }
  const matches = await adminDb.collection(
    `stores/${input.officialStoreId}/promotions`
  ).where('code', '==', code).limit(2).get();
  if (matches.empty) throw new Error('OFFICIAL_PROMOTION_NOT_FOUND');
  if (matches.size !== 1) throw new Error('OFFICIAL_PROMOTION_CODE_AMBIGUOUS');
  const document = matches.docs[0];
  const promotion = normalizeStorePromotion({
    ...(document.data() as StorePromotion),
    id: document.id,
    storeId: input.officialStoreId,
  });
  if (promotion.code !== code) throw new Error('OFFICIAL_PROMOTION_CODE_CHANGED');
  return { promotion, quote: quoteOfficialPlanPromotion({ ...input, promotion }) };
}

export async function quoteOfficialPlanPromotionCodeFromErp(
  input: Parameters<typeof resolveOfficialPlanPromotionCodeFromErp>[0],
) {
  return (await resolveOfficialPlanPromotionCodeFromErp(input)).quote;
}
