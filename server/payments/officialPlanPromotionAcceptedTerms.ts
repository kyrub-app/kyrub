import { createHash } from 'node:crypto';
import type { StorePromotion } from '../../src/utils/storePromotions.js';
import { quoteOfficialPlanPromotion } from './officialPlanPromotionQuote.js';

export interface OfficialPromotionAcceptedTerms {
  buyerUid: string;
  officialStoreId: string;
  officialProductId: string;
  months: 1 | 3 | 6 | 12;
  promotionId: string;
  code: string;
  originalTotalMinor: number;
  discountMinor: number;
  payableMinor: number;
  termsDigest: string;
}

/**
 * Build a deterministic, immutable commercial snapshot for isolated checkout tests.
 * Persistence, reservation, payment creation and redemption remain outside this module.
 */
export function buildOfficialPromotionAcceptedTerms(input: {
  promotion: StorePromotion;
  officialStoreId: string;
  officialProductId: string;
  buyerUid: string;
  months: 1 | 3 | 6 | 12;
  contractTotalMinor: number;
  now?: Date;
}): OfficialPromotionAcceptedTerms {
  if (![1, 3, 6, 12].includes(input.months)) {
    throw new Error('OFFICIAL_PROMOTION_INVALID_TERM');
  }
  const quote = quoteOfficialPlanPromotion(input);
  const terms = {
    buyerUid: input.buyerUid,
    officialStoreId: input.officialStoreId,
    officialProductId: input.officialProductId,
    months: input.months,
    ...quote,
  };
  const termsDigest = createHash('sha256').update(JSON.stringify(terms)).digest('hex');
  return Object.freeze({ ...terms, termsDigest });
}

/** Fail closed if a simulated provider callback or contract differs from accepted terms. */
export function assertOfficialPromotionPaymentMatches(
  accepted: OfficialPromotionAcceptedTerms,
  input: { buyerUid: string; officialStoreId: string; officialProductId: string;
    months: 1 | 3 | 6 | 12; paidMinor: number; termsDigest: string },
): void {
  const { termsDigest: _digest, ...terms } = accepted;
  const expected = createHash('sha256').update(JSON.stringify(terms)).digest('hex');
  if (expected !== accepted.termsDigest ||
      input.termsDigest !== expected ||
      input.buyerUid !== accepted.buyerUid ||
      input.officialStoreId !== accepted.officialStoreId ||
      input.officialProductId !== accepted.officialProductId ||
      input.months !== accepted.months ||
      !Number.isSafeInteger(input.paidMinor) ||
      input.paidMinor !== accepted.payableMinor) {
    throw new Error('OFFICIAL_PROMOTION_PAYMENT_MISMATCH');
  }
}
