import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const source = readFileSync(new URL('../server/admin/officialPlanProductLookup.ts', import.meta.url), 'utf8');
describe('official plan product lookup boundaries', () => {
  it('reads a persisted product from the canonical store instead of trusting a cart plan tag', () => {
    assert.match(source, /stores\/\$\{seller\.canonicalStoreId\}\/products\/\$\{productId\}/);
    assert.match(source, /data\.platformPlanId/);
    assert.doesNotMatch(source, /input\.platformPlanId/);
  });
  it('checks subscription modality and official store identity before platform routing', () => {
    assert.match(source, /parseProductSaleModality/);
    assert.match(source, /getOfficialStoreIdentity/);
    assert.match(source, /resolveCheckoutBillingRoute/);
    assert.match(source, /PLATFORM_PLAN_TAG_NOT_AUTHORIZED/);
  });
});
