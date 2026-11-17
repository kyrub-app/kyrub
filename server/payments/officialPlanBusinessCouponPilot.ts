import { isPromotionCurrentlyAvailable, normalizeStorePromotion, type StorePromotion } from '../../src/utils/storePromotions.js';
import type { OfficialPromotionAcceptedTerms } from './officialPlanPromotionAcceptedTerms.js';
import { OFFICIAL_PLAN_BUSINESS_PRODUCT_ID, OFFICIAL_STORE_CANONICAL_ID } from '../../shared/officialPlanCanonicalDisplay.js';

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
  points?: number;
  rewards?: { xp?: number; achievement?: unknown };
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
      (offer.points ?? 0) !== 0 || (offer.rewards?.xp ?? 0) !== 0 ||
      Boolean(offer.rewards?.achievement) ||
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

/**
 * A public Praça card may disclose an offer *without* disclosing the buyer UID.
 * This is not authorization to redeem: only the private, authenticated checkout
 * determines whether the buyer actually owns the coupon.
 */
export const isPubliclyPresentableBusinessCouponPilot = (value: StorePromotion): boolean => {
  if (!liveBusinessCouponPilotEnabled() ||
      process.env.KYRUB_OFFICIAL_PLAN_PIX_CHECKOUT_ENABLED !== 'true' ||
      process.env.KYRUB_OFFICIAL_PLAN_PIX_PILOT_MODE !== 'true') return false;
  try {
    const promotion = normalizeStorePromotion(value);
    const uid = process.env.KYRUB_OFFICIAL_PLAN_PIX_PILOT_BUYER_UID?.trim() || '';
    return /^[A-Za-z0-9_-]{1,128}$/.test(uid) &&
      promotion.id === process.env.KYRUB_OFFICIAL_PLAN_PIX_PILOT_PROMOTION_ID &&
      promotion.code === process.env.KYRUB_OFFICIAL_PLAN_PIX_PILOT_PROMOTION_CODE &&
      promotion.storeId === OFFICIAL_STORE_CANONICAL_ID &&
      promotion.productIds.length === 1 &&
      promotion.productIds[0] === OFFICIAL_PLAN_BUSINESS_PRODUCT_ID &&
      promotion.discountType === 'fixed' && promotion.discountValue === 396 &&
      promotion.maxRedemptions === 1 && promotion.maxRedemptionsPerBuyer === 1 &&
      promotion.eligibility.mode === 'specific_user' &&
      promotion.eligibility.userIds?.length === 1 &&
      promotion.eligibility.userIds[0] === uid &&
      isPromotionCurrentlyAvailable(promotion);
  } catch {
    return false;
  }
};
