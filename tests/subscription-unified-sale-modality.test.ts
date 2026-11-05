import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSubscriptionSaleModality, parseProductSaleModality } from '../shared/productSaleModality.js';

test('existing recurring subscriptions default to automatic renewal', () => {
  const modality = buildSubscriptionSaleModality({
    billingUnit: 'month', billingIntervalCount: 1, benefitKind: 'access',
  });
  assert.equal(modality.subscription?.autoRenew, true);
  assert.deepEqual(parseProductSaleModality(modality), modality);
});

test('prepaid 3, 6 and 12 month contracts use canonical subscription terms without auto renewal', () => {
  for (const months of [3, 6, 12]) {
    const modality = buildSubscriptionSaleModality({
      billingUnit: 'month', billingIntervalCount: months, benefitKind: 'access', autoRenew: false,
    });
    assert.equal(modality.subscription?.autoRenew, false);
    assert.equal(modality.subscription?.billingInterval.count, months);
    assert.deepEqual(parseProductSaleModality(modality), modality);
  }
});

test('invalid autoRenew values fail closed', () => {
  const modality = buildSubscriptionSaleModality({
    billingUnit: 'month', benefitKind: 'access',
  });
  assert.equal(parseProductSaleModality({
    ...modality, subscription: { ...modality.subscription, autoRenew: 'false' },
  }), null);
});
