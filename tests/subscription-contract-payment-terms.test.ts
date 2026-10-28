import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { calculateSubscriptionContractOffer } from '../shared/subscriptionContractOffers.js';
import { validateSubscriptionContractPaymentTerms } from '../shared/subscriptionContractPaymentTerms.js';

describe('contract term versus provider billing cadence', () => {
  it('allows monthly recurring only for undiscounted monthly offers', () => {
    const monthly = calculateSubscriptionContractOffer(7000, 1, 0);
    assert.doesNotThrow(() => validateSubscriptionContractPaymentTerms(monthly, {
      collectionMode: 'recurring', billingIntervalMonths: 1, installments: null,
    }));
    assert.throws(() => validateSubscriptionContractPaymentTerms(
      calculateSubscriptionContractOffer(7000, 12, 20),
      { collectionMode: 'recurring', billingIntervalMonths: 1, installments: null },
    ), /UNSUPPORTED_RECURRING/);
  });
  it('allows prepaid annual terms with independently selected installments', () => {
    const annual = calculateSubscriptionContractOffer(7000, 12, 20);
    assert.doesNotThrow(() => validateSubscriptionContractPaymentTerms(annual, {
      collectionMode: 'prepaid', installments: 6,
    }));
    assert.throws(() => validateSubscriptionContractPaymentTerms(annual, {
      collectionMode: 'prepaid', installments: 0,
    }), /INVALID_CONTRACT_INSTALLMENTS/);
  });
});
