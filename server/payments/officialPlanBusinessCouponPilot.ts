import { isPromotionCurrentlyAvailable, normalizeStorePromotion, type StorePromotion } from '../../src/utils/storePromotions.js';
import type { OfficialPromotionAcceptedTerms } from './officialPlanPromotionAcceptedTerms.js';

/**
 * Dedicated, default-off commercial pilot. Never substitutes an ERP coupon,
 * never sets a product price and never enables the provider by itself.
 */
export const liveBusinessCouponPilotEnabled = () =>
  process.env.KYRUB_OFFICIAL_PLAN_PIX_PILOT_BUSINESS_COUPON_ENABLED === 'true';

export type BusinessCouponPilotOffer = {
  storeId: string;
  productId: string;
  plan: string;
  priceMinor: number;
  quote: { months: number; totalMinor: number };
};

export const assertLiveBusinessCouponPilot = (input: {
  buyerUid: string;
  offer: BusinessCouponPilotOffer;
  accepted: OfficialPromotionAcceptedTerms;
  promotion?: StorePromotion;
}) => {
  const expectedBuyerUid = process.env.KYRUB_OFFICIAL_PLAN_PIX_PILOT_BUYER_UID?.trim() || '';
  const expectedPromotionId = process.env.KYRUB_OFFICIAL_PLAN_PIX_PILOT_PROMOTION_ID?.trim() || '';
  const expectedCode = process.env.KYRUB_OFFICIAL_PLAN_PIX_PILOT_PROMOTION_CODE?.trim() || '';
  const { buyerUid, offer, accepted } = input;
  const validId = (value: string) => /^[A-Za-z0-9_-]{1,128}$/.test(value);
  const validCode = (value: string) => /^[A-Z0-9_-]{1,48}$/.test(value);

  if (!liveBusinessCouponPilotEnabled() ||
      process.env.KYRUB_OFFICIAL_PLAN_PIX_CHECKOUT_ENABLED !== 'true' ||
      process.env.KYRUB_OFFICIAL_PLAN_PIX_PILOT_MODE !== 'true' ||
      !validId(expectedBuyerUid) || buyerUid !== expectedBuyerUid ||
      !validId(expectedPromotionId) || !validCode(expectedCode) ||
      offer.plan !== 'business' || offer.quote.months !== 1 ||
      offer.priceMinor !== 39700 || offer.quote.totalMinor !== 39700 ||
      accepted.buyerUid !== buyerUid || accepted.officialStoreId !== offer.storeId ||
      accepted.officialProductId !== offer.productId || accepted.months !== 1 ||
      accepted.originalTotalMinor !== 39700 || accepted.discountMinor !== 39600 ||
      accepted.payableMinor !== 100 ||
      accepted.promotionId !== expectedPromotionId || accepted.code !== expectedCode) {
    throw new Error('OFFICIAL_PIX_BUSINESS_COUPON_PILOT_FORBIDDEN');
  }

  if (input.promotion) {
    const promotion = normalizeStorePromotion(input.promotion);
    if (promotion.id !== expectedPromotionId ||
        promotion.storeId !== offer.storeId || promotion.code !== expectedCode ||
        promotion.discountType !== 'fixed' || promotion.discountValue !== 396 ||
        promotion.productIds.length !== 1 || promotion.productIds[0] !== offer.productId ||
        promotion.eligibility.mode !== 'specific_user' ||
        promotion.eligibility.userIds?.length !== 1 ||
        promotion.eligibility.userIds[0] !== buyerUid ||
        promotion.maxRedemptions !== 1 || promotion.maxRedemptionsPerBuyer !== 1 ||
        !isPromotionCurrentlyAvailable(promotion)) {
      throw new Error('OFFICIAL_PIX_BUSINESS_COUPON_PILOT_FORBIDDEN');
    }
  }
};
