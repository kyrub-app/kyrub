import { assertOfficialPromotionPaymentMatches, type OfficialPromotionAcceptedTerms } from './officialPlanPromotionAcceptedTerms.js';

/**
 * Pure, emulator-testable boundary between a canonical official plan offer
 * and an ERP coupon snapshot. No payment provider calls or Firestore writes.
 *
 * The real checkout still requires separate wiring, transactional reservation
 * and verification of provider payment before this can be activated.
 */
export function resolveOfficialPromotionalCheckoutAmount(input: {
  buyerUid: string;
  offer: {
    storeId: string;
    productId: string;
    quote: { months: 1 | 3 | 6 | 12; totalMinor: number };
  };
  accepted: OfficialPromotionAcceptedTerms;
  providerAmountMinor: number;
}) {
  const { offer, accepted } = input;
  if (!Number.isSafeInteger(offer.quote.totalMinor) || offer.quote.totalMinor < 1 ||
      accepted.originalTotalMinor !== offer.quote.totalMinor ||
      accepted.discountMinor !== accepted.originalTotalMinor - accepted.payableMinor ||
      accepted.discountMinor < 1 || accepted.payableMinor < 1) {
    throw new Error('OFFICIAL_PROMOTION_CHECKOUT_QUOTE_MISMATCH');
  }
  assertOfficialPromotionPaymentMatches(accepted, {
    buyerUid: input.buyerUid,
    officialStoreId: offer.storeId,
    officialProductId: offer.productId,
    months: offer.quote.months,
    paidMinor: input.providerAmountMinor,
    termsDigest: accepted.termsDigest,
  });
  return Object.freeze({
    originalTotalMinor: offer.quote.totalMinor,
    discountMinor: accepted.discountMinor,
    payableMinor: accepted.payableMinor,
    promotionId: accepted.promotionId,
    acceptedTermsDigest: accepted.termsDigest,
  });
}
