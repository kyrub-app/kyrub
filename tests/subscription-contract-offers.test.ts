import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  calculateSubscriptionContractOffer,
  validateSubscriptionContractDiscounts,
} from '../shared/subscriptionContractOffers.js';

describe('shared subscription contract offers', () => {
  it('calculates monthly, quarterly, semiannual and annual prepaid totals', () => {
    assert.equal(calculateSubscriptionContractOffer(7000, 1, 0).totalMinor, 7000);
    assert.equal(calculateSubscriptionContractOffer(7000, 3, 5).totalMinor, 19950);
    assert.equal(calculateSubscriptionContractOffer(7000, 6, 10).totalMinor, 37800);
    assert.equal(calculateSubscriptionContractOffer(7000, 12, 20).totalMinor, 67200);
  });
  it('rejects duplicate terms and invalid discounts', () => {
    assert.throws(() => validateSubscriptionContractDiscounts([
      { months: 3, discountPercent: 5 },
      { months: 3, discountPercent: 10 },
    ]), /DUPLICATE/);
    assert.throws(() => calculateSubscriptionContractOffer(7000, 12, 101), /INVALID/);
    assert.throws(() => calculateSubscriptionContractOffer(-1, 1, 0), /INVALID/);
    assert.throws(() => validateSubscriptionContractDiscounts([{ months: 3, discountPercent: 5 }]), /MISSING_MONTHLY_BASELINE/);
    assert.throws(() => calculateSubscriptionContractOffer(Number.MAX_SAFE_INTEGER, 12, 20), /INVALID/);
  });
});
