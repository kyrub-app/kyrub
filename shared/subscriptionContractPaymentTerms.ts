import type { SubscriptionContractOffer } from './subscriptionContractOffers.js';

/**
 * A prepaid term is NOT a recurring monthly payment. Prepaid contracts are charged once, in full, without installments.
 */
export type SubscriptionContractPaymentTerms =
  | { collectionMode: 'prepaid'; installments: number }
  | { collectionMode: 'recurring'; billingIntervalMonths: 1; installments: null };

export const validateSubscriptionContractPaymentTerms = (
  offer: SubscriptionContractOffer,
  payment: SubscriptionContractPaymentTerms
): void => {
  if (!payment || typeof payment !== 'object') throw new Error('INVALID_CONTRACT_PAYMENT_TERMS');
  if (payment.collectionMode === 'prepaid') {
    if ('billingIntervalMonths' in payment && payment.billingIntervalMonths !== undefined) {
      throw new Error('INVALID_CONTRACT_PAYMENT_TERMS');
    }
    if (payment.installments !== 1) {
      throw new Error('INVALID_CONTRACT_INSTALLMENTS');
    }
    return;
  }
  if (payment.collectionMode === 'recurring' &&
      offer.months === 1 && offer.discountPercent === 0 &&
      payment.billingIntervalMonths === 1 && payment.installments === null) return;
  throw new Error('UNSUPPORTED_RECURRING_CONTRACT_TERM');
};
