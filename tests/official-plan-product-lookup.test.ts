import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const source = readFileSync(new URL('../server/admin/officialPlanProductLookup.ts', import.meta.url), 'utf8');
describe('official plan product lookup boundaries', () => {
  it('reads a persisted product from the canonical store instead of trusting a cart plan tag', () => {
    assert.match(source, /stores\/\$\{seller\.canonicalStoreId\}\/products\/\$\{productId\}/);
    assert.match(source, /official_plan_products/);
    assert.match(source, /mappingData\.planId/);
    assert.doesNotMatch(source, /input\.platformPlanId/);
  });
  it('checks subscription modality and official store identity before platform routing', () => {
    assert.match(source, /parseProductSaleModality/);
    assert.match(source, /getOfficialStoreIdentity/);
    assert.match(source, /resolveCheckoutBillingRoute/);
    assert.match(source, /UNTRUSTED_PRODUCT_PLAN_TAG/);
    assert.match(source, /INVALID_PLATFORM_PLAN_MAPPING/);
  });
});


describe('official plan product management gateway', () => {
  it('exposes the admin-only mapping operation without a new serverless function', () => {
    const gateway = readFileSync(new URL('../api/plan-control.ts', import.meta.url), 'utf8');
    const management = readFileSync(new URL('../server/admin/officialPlanProductManagement.ts', import.meta.url), 'utf8');
    assert.match(gateway, /case 'admin\.official-plan-product\.assign'/);
    assert.match(gateway, /await assignOfficialPlanProduct\(/);
    assert.match(management, /admin\.role !== 'super_admin'/);
    assert.match(management, /transaction\.get\(productRef\)/);
    assert.match(management, /transaction\.set\(mappingRef/);
  });
});


test('official plan contract offers cannot silently fall back to monthly-only checkout', () => {
  const source = readFileSync('server/admin/officialPlanProductLookup.ts', 'utf8');
  assert.match(source, /planId !== null && data\.contractDiscounts !== undefined/);
  assert.match(source, /OFFICIAL_PLAN_CONTRACT_CHECKOUT_REQUIRED/);
});
