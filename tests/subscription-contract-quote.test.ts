import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildSubscriptionSaleModality } from '../shared/productSaleModality.js';
import { resolveSubscriptionContractQuote } from '../server/payments/subscriptionContractQuote.js';

const modality = buildSubscriptionSaleModality({ billingUnit: 'month', benefitKind: 'access' });
const offers = [{ months: 1, discountPercent: 0 }, { months: 12, discountPercent: 20 }];

describe('persisted contract checkout quote', () => {
  it('quotes the selected term from authoritative price and persisted offers', () => {
    const quote = resolveSubscriptionContractQuote({
      persistedSaleModality: modality, authoritativeMonthlyPriceMinor: 7000,
      persistedOffers: offers, selectedMonths: 12,
      paymentTerms: { collectionMode: 'prepaid', installments: 1 },
    });
    assert.equal(quote.totalMinor, 67200);
  });
  it('rejects unoffered terms and malformed persisted discounts', () => {
    const input = { persistedSaleModality: modality, authoritativeMonthlyPriceMinor: 7000, persistedOffers: offers, paymentTerms: { collectionMode: 'prepaid' as const, installments: 1 } };
    assert.throws(() => resolveSubscriptionContractQuote({ ...input, selectedMonths: 6 }), /NOT_OFFERED/);
    assert.throws(() => resolveSubscriptionContractQuote({
      ...input, persistedOffers: [{ months: 1, discountPercent: 0 }, { months: 12, discountPercent: 200 }],
      selectedMonths: 12,
    }), /INVALID_PERSISTED/);
  });
  it('does not allow annual discounted terms through monthly recurring billing', () => {
    const base = { persistedSaleModality: modality, authoritativeMonthlyPriceMinor: 7000, persistedOffers: offers, selectedMonths: 12 as const };
    assert.throws(() => resolveSubscriptionContractQuote({
      ...base, paymentTerms: { collectionMode: 'recurring', billingIntervalMonths: 1, installments: null },
    }), /UNSUPPORTED_RECURRING_CONTRACT_TERM/);
    assert.equal(resolveSubscriptionContractQuote({
      ...base, paymentTerms: { collectionMode: 'prepaid', installments: 6 },
    }).totalMinor, 67200);
  });
  it('preserves legacy monthly-only products without granting longer terms', () => {
    const base = {
      persistedSaleModality: modality,
      authoritativeMonthlyPriceMinor: 7000,
      persistedOffers: undefined,
      paymentTerms: { collectionMode: 'recurring' as const, billingIntervalMonths: 1 as const, installments: null },
    };
    assert.deepEqual(resolveSubscriptionContractQuote({ ...base, selectedMonths: 1 }), {
      months: 1, discountPercent: 0, totalMinor: 7000, monthlyEquivalentMinor: 7000,
    });
    assert.throws(() => resolveSubscriptionContractQuote({
      ...base, selectedMonths: 12,
    }), /SUBSCRIPTION_TERM_NOT_OFFERED/);
    assert.throws(() => resolveSubscriptionContractQuote({
      ...base, persistedOffers: null, selectedMonths: 1,
    }), /INVALID_PERSISTED_SUBSCRIPTION_OFFERS/);
  });
  it('rejects one-time product modality', () => {
    assert.throws(() => resolveSubscriptionContractQuote({
      persistedSaleModality: { schemaVersion: 1, mode: 'one_time', subscription: null },
      authoritativeMonthlyPriceMinor: 7000, persistedOffers: offers, selectedMonths: 12,
      paymentTerms: { collectionMode: 'prepaid', installments: 1 },
    }), /INVALID_SUBSCRIPTION_PRODUCT/);
  });
});
