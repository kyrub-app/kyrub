import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSubscriptionSaleModality } from '../shared/productSaleModality.js';
import { matchesOfficialPlanProduct } from '../server/admin/officialPlanProductContract.js';

const product = () => ({
  publicationStatus: 'published',
  kyrubPlanId: 'pro',
  price: 70,
  saleModality: buildSubscriptionSaleModality({
    billingUnit: 'month',
    billingIntervalCount: 1,
    benefitKind: 'access',
  }),
});

test('accepts a published monthly access product with matching plan and server price', () => {
  assert.equal(matchesOfficialPlanProduct(product(), 'pro', 7000), true);
});

test('rejects unpublished, mismatched plan, and mismatched prices', () => {
  assert.equal(matchesOfficialPlanProduct({ ...product(), publicationStatus: 'draft' }, 'pro', 7000), false);
  assert.equal(matchesOfficialPlanProduct(product(), 'business', 7000), false);
  assert.equal(matchesOfficialPlanProduct(product(), 'pro', 6999), false);
  assert.equal(matchesOfficialPlanProduct({ ...product(), price: '70' }, 'pro', 7000), false);
});

test('rejects one-time products and non-monthly recurrence', () => {
  assert.equal(matchesOfficialPlanProduct({ ...product(), saleModality: { schemaVersion: 1, mode: 'one_time', subscription: null } }, 'pro', 7000), false);
  assert.equal(matchesOfficialPlanProduct({ ...product(), saleModality: buildSubscriptionSaleModality({ billingUnit: 'year', benefitKind: 'access' }) }, 'pro', 7000), false);
  assert.equal(matchesOfficialPlanProduct({ ...product(), saleModality: buildSubscriptionSaleModality({ billingUnit: 'month', billingIntervalCount: 2, benefitKind: 'access' }) }, 'pro', 7000), false);
  assert.equal(matchesOfficialPlanProduct({ ...product(), saleModality: buildSubscriptionSaleModality({ billingUnit: 'month', benefitKind: 'usage_credits', unitsPerCycle: 1 }) }, 'pro', 7000), false);
});

test('rejects missing or invalid product data', () => {
  assert.equal(matchesOfficialPlanProduct(null, 'pro', 7000), false);
  assert.equal(matchesOfficialPlanProduct({}, 'pro', 7000), false);
  assert.equal(matchesOfficialPlanProduct(product(), 'pro', 0), false);
});
