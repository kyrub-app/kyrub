import assert from 'node:assert/strict';
import test from 'node:test';
import { selectPublishedOfficialPlanPrice } from '../server/admin/officialPlanPublicPrice.js';
import { OFFICIAL_STORE_CANONICAL_ID, OFFICIAL_PLAN_PRO_PRODUCT_ID, OFFICIAL_PLAN_BUSINESS_PRODUCT_ID } from '../shared/officialPlanCanonicalDisplay.js';

const designation = { kind: 'official_cairobi_store', canonicalStoreId: OFFICIAL_STORE_CANONICAL_ID };
const modality = { schemaVersion: 1, mode: 'subscription', subscription: {
  schemaVersion: 1, autoRenew: false, billingInterval: { unit: 'month', count: 1 },
  benefit: { kind: 'access', unitsPerCycle: null },
} };
const fixture = (planId: 'pro' | 'business', price: number) => {
  const id = planId === 'pro' ? OFFICIAL_PLAN_PRO_PRODUCT_ID : OFFICIAL_PLAN_BUSINESS_PRODUCT_ID;
  return { planId, designation,
    product: { id, storeId: OFFICIAL_STORE_CANONICAL_ID, price,
      publicationStatus: 'published', saleModality: modality },
    mapping: { productId: id, canonicalStoreId: OFFICIAL_STORE_CANONICAL_ID, planId, status: 'active' },
  };
};

test('published Official Store is the paid-plan price source, without a hardcoded charge', () => {
  assert.equal(selectPublishedOfficialPlanPrice(fixture('pro', 197)), 197);
  assert.equal(selectPublishedOfficialPlanPrice(fixture('business', 397)), 397);
  assert.equal(selectPublishedOfficialPlanPrice(fixture('business', 425.75)), 425.75);
});

test('drafts, other stores, inactive mappings and recurring plans are rejected as public prices', () => {
  const x = fixture('business', 397);
  for (const changed of [
    { ...x, designation: { ...designation, canonicalStoreId: 'another-store' } },
    { ...x, product: { ...x.product, publicationStatus: 'draft' } },
    { ...x, product: { ...x.product, price: 0 } },
    { ...x, product: { ...x.product, price: 397.001 } },
    { ...x, product: { ...x.product, storeId: 'another-store' } },
    { ...x, mapping: { ...x.mapping, status: 'inactive' } },
    { ...x, mapping: { ...x.mapping, planId: 'pro' } },
    { ...x, product: { ...x.product, saleModality: { ...modality,
      subscription: { ...modality.subscription, autoRenew: true } } } },
  ]) assert.equal(selectPublishedOfficialPlanPrice(changed), null);
});
