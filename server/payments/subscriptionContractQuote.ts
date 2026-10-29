import {
  calculateSubscriptionContractOffer,
  parseSubscriptionContractDiscounts,
  type ContractTermMonths,
  type SubscriptionContractOffer,
} from '../../shared/subscriptionContractOffers.js';
import { parseProductSaleModality } from '../../shared/productSaleModality.js';
import { validateSubscriptionContractPaymentTerms, type SubscriptionContractPaymentTerms } from '../../shared/subscriptionContractPaymentTerms.js';

/**
 * Store-neutral checkout pricing boundary. Callers must supply a persisted,
 * server-verified product price and offers; never use cart-supplied prices.
 * Platform plan prices must be supplied from the authoritative control plane.
 */
export const resolveSubscriptionContractQuote = (input: {
  persistedSaleModality: unknown;
  authoritativeMonthlyPriceMinor: number;
  persistedOffers: unknown;
  selectedMonths: ContractTermMonths;
  paymentTerms: SubscriptionContractPaymentTerms;
}): SubscriptionContractOffer => {
  const modality = parseProductSaleModality(input.persistedSaleModality);
  if (!modality || modality.mode !== 'subscription' || !modality.subscription ||
      modality.subscription.billingInterval.unit !== 'month' ||
      modality.subscription.billingInterval.count !== 1) {
    throw new Error('INVALID_SUBSCRIPTION_PRODUCT_FOR_CONTRACT');
  }
  const offers = parseSubscriptionContractDiscounts(input.persistedOffers);
  if (!offers) throw new Error('INVALID_PERSISTED_SUBSCRIPTION_OFFERS');
  const selected = offers.find(offer => offer.months === input.selectedMonths);
  if (!selected) throw new Error('SUBSCRIPTION_TERM_NOT_OFFERED');
  const quote = calculateSubscriptionContractOffer(
    input.authoritativeMonthlyPriceMinor,
    selected.months,
    selected.discountPercent
  );
  validateSubscriptionContractPaymentTerms(quote, input.paymentTerms);
  return quote;
};
