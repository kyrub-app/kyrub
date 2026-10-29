import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

describe('paid platform plan checkout requires authoritative pricing', () => {
  const billing = readFileSync(
    new URL('../server/admin/paidPlanSubscriptionService.ts', import.meta.url), 'utf8'
  );
  const catalog = readFileSync(
    new URL('../server/admin/publicPlanCatalogService.ts', import.meta.url), 'utf8'
  );

  it('charges the persisted official product price rather than compiled catalog prices', () => {
    assert.match(billing, /monthlyPriceBRL: price/);
    assert.match(billing, /OFFICIAL_PLAN_PRODUCT_CHANGED/);
    assert.match(billing, /OFFICIAL_PLAN_PRICE_CHANGED/);
  });

  it('retains compiled fallback for public plan display only', () => {
    assert.match(catalog, /source: 'compiled_v1'/);
    assert.match(catalog, /source: 'control_plane'/);
  });
});
