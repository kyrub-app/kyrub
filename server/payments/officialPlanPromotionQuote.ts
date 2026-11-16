import { isPromotionCurrentlyAvailable, isPromotionEligibleForBuyer, normalizeStorePromotion, quoteStorePromotion, type StorePromotion } from '../../src/utils/storePromotions.js';

/**
 * Pure pricing guard for an isolated official-plan promotion.
 * This does NOT authorize payment creation, redemption or a production pilot.
 * The caller must load the promotion from the Official Store ERP's\n * stores/{storeId}/promotions collection and the authoritative plan quote\n * on the server. Never create a parallel Control Plane coupon.
 */
export function quoteOfficialPlanPromotion(input: {
  promotion: StorePromotion;
  officialStoreId: string;
  officialProductId: string;
  buyerUid: string;
  contractTotalMinor: number;
  now?: Date;
}): { promotionId: string; code: string; originalTotalMinor: number; discountMinor: number; payableMinor: number } {
  const { officialStoreId, officialProductId, buyerUid, contractTotalMinor } = input;
  if (!officialStoreId || !officialProductId || !buyerUid ||
      !Number.isSafeInteger(contractTotalMinor) || contractTotalMinor <= 0) {
    throw new Error('OFFICIAL_PROMOTION_INVALID_INPUT');
  }
  const promotion = normalizeStorePromotion(input.promotion);
  if (promotion.storeId !== officialStoreId ||
      !promotion.productIds.includes(officialProductId) ||
      !isPromotionCurrentlyAvailable(promotion, input.now) ||
      !isPromotionEligibleForBuyer(promotion, buyerUid)) {
    throw new Error('OFFICIAL_PROMOTION_NOT_ELIGIBLE');
  }
  // The official quote is the only price source. Never trust cart or URL totals.
  const quote = quoteStorePromotion(promotion, [{
    productId: officialProductId,
    unitPrice: contractTotalMinor / 100,
    quantity: 1,
  }]);
  const payableMinor = Math.round(quote.total * 100);
  const discountMinor = contractTotalMinor - payableMinor;
  // Zero-value checkout cannot be sent to Pix; no negative or over-discount.
  if (!Number.isSafeInteger(payableMinor) || payableMinor < 1 ||
      !Number.isSafeInteger(discountMinor) || discountMinor <= 0 ||
      discountMinor >= contractTotalMinor) {
    throw new Error('OFFICIAL_PROMOTION_INVALID_TOTAL');
  }
  return { promotionId: promotion.id, code: promotion.code,
    originalTotalMinor: contractTotalMinor, discountMinor, payableMinor };
}
