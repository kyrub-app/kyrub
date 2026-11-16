import { resolveOfficialPromotionalCheckoutAmount } from './officialPlanPromotionCheckoutAmount.js';
import type { OfficialPromotionAcceptedTerms } from './officialPlanPromotionAcceptedTerms.js';

export interface IsolatedOfficialPixConfirmation {
  paymentId: string;
  checkoutId: string;
  buyerUid: string;
  amountMinor: number;
  currency: 'BRL';
  method: 'pix';
  status: 'approved' | 'pending' | 'rejected';
}

/**
 * Emulator-only simulated provider verifier. No network calls, payment
 * creation or database writes. Its result is evidence for tests, NOT an
 * entitlement grant or a production payment authorization.
 */
export function verifyIsolatedOfficialPlanPromotionPix(input: {
  checkoutId: string;
  buyerUid: string;
  offer: { storeId: string; productId: string;
    quote: { months: 1 | 3 | 6 | 12; totalMinor: number } };
  accepted: OfficialPromotionAcceptedTerms;
  confirmation: IsolatedOfficialPixConfirmation;
  emulatorHost: string | undefined;
  isolatedFlag: string | undefined;
}) {
  if (!/^(localhost|127\.0\.0\.1):\d+$/.test(input.emulatorHost ?? '') ||
      input.isolatedFlag !== 'true') {
    throw new Error('OFFICIAL_PROMOTION_EMULATOR_REQUIRED');
  }
  const payment = input.confirmation;
  if (!/^[a-f0-9]{64}$/.test(input.checkoutId) ||
      !/^[a-zA-Z0-9_-]{1,128}$/.test(payment.paymentId) ||
      payment.checkoutId !== input.checkoutId ||
      payment.buyerUid !== input.buyerUid ||
      payment.currency !== 'BRL' || payment.method !== 'pix' ||
      payment.status !== 'approved') {
    throw new Error('OFFICIAL_PROMOTION_SIMULATED_PAYMENT_REJECTED');
  }
  const quote = resolveOfficialPromotionalCheckoutAmount({
    buyerUid: input.buyerUid, offer: input.offer, accepted: input.accepted,
    providerAmountMinor: payment.amountMinor,
  });
  return Object.freeze({
    checkoutId: input.checkoutId,
    simulatedPaymentId: payment.paymentId,
    paidMinor: quote.payableMinor,
    promotionId: quote.promotionId,
    acceptedTermsDigest: quote.acceptedTermsDigest,
    simulated: true as const,
  });
}
