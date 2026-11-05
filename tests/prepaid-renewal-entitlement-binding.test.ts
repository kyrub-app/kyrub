import assert from 'node:assert/strict';
import test from 'node:test';
import { assertPrepaidRenewalEntitlementBinding } from '../server/payments/prepaidRenewalEntitlementBinding.js';

const base = () => ({
  storeId: 'store-a', previousContractId: 'contract-a', customerId: 'buyer-a', productId: 'product-a',
  predecessor: { storeId: 'store-a', contractId: 'contract-a', customerId: 'buyer-a', productId: 'product-a', subscriptionId: 'sub-a' },
  subscription: { id: 'sub-a', storeId: 'store-a', buyerId: 'buyer-a', productId: 'product-a' },
});
test('requires explicit predecessor subscription ID', () => {
  const input = base();
  assert.equal(assertPrepaidRenewalEntitlementBinding(input).subscriptionId, 'sub-a');
  assert.throws(() => assertPrepaidRenewalEntitlementBinding({
    ...input, predecessor: { ...input.predecessor, subscriptionId: undefined },
  }), /RENEWAL_ENTITLEMENT_BINDING_NOT_VERIFIED/);
});
test('rejects matching buyer/product without exact subscription identity', () => {
  const input = base();
  assert.throws(() => assertPrepaidRenewalEntitlementBinding({
    ...input, subscription: { ...input.subscription, id: 'sub-b' },
  }), /RENEWAL_ENTITLEMENT_BINDING_NOT_VERIFIED/);
});
test('rejects cross-store, cross-buyer and cross-product substitution', () => {
  for (const field of ['storeId', 'buyerId', 'productId']) {
    const input = base();
    assert.throws(() => assertPrepaidRenewalEntitlementBinding({
      ...input, subscription: { ...input.subscription, [field]: 'other' },
    }), /RENEWAL_ENTITLEMENT_BINDING_NOT_VERIFIED/);
  }
});
test('rejects missing subscription and unsafe IDs', () => {
  const input = base();
  assert.throws(() => assertPrepaidRenewalEntitlementBinding({ ...input, subscription: null }), /RENEWAL_ENTITLEMENT_BINDING_NOT_VERIFIED/);
  assert.throws(() => assertPrepaidRenewalEntitlementBinding({
    ...input, predecessor: { ...input.predecessor, subscriptionId: '../other' },
  }), /RENEWAL_ENTITLEMENT_BINDING_NOT_VERIFIED/);
});
