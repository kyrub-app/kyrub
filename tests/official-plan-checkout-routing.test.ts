import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveCheckoutBillingRoute } from '../server/admin/officialPlanCheckoutRouting.js';

describe('Official Store plan checkout routing', () => {
  const officialStoreId = 'official-store';

  it('routes ordinary products from any store to merchant checkout', () => {
    assert.deepEqual(resolveCheckoutBillingRoute({
      sellerStoreId: 'merchant-1', officialStoreId,
    }), { kind: 'merchant', storeId: 'merchant-1' });
    assert.deepEqual(resolveCheckoutBillingRoute({
      sellerStoreId: officialStoreId, officialStoreId,
    }), { kind: 'merchant', storeId: officialStoreId });
  });

  it('routes only explicitly identified paid Kyrub plans from Official Store to platform billing', () => {
    for (const plan of ['pro', 'business'] as const) {
      assert.deepEqual(resolveCheckoutBillingRoute({
        sellerStoreId: officialStoreId, officialStoreId, platformPlanId: plan,
      }), { kind: 'platform-plan', plan });
    }
  });

  it('does not create a paid checkout for Free', () => {
    assert.deepEqual(resolveCheckoutBillingRoute({
      sellerStoreId: officialStoreId, officialStoreId, platformPlanId: 'free',
    }), { kind: 'free-plan', plan: 'free' });
  });

  it('rejects platform plans from other stores or without an official designation', () => {
    assert.throws(() => resolveCheckoutBillingRoute({
      sellerStoreId: 'merchant-1', officialStoreId, platformPlanId: 'pro',
    }), { code: 'PLATFORM_PLAN_OFFICIAL_STORE_ONLY' });
    assert.throws(() => resolveCheckoutBillingRoute({
      sellerStoreId: officialStoreId, officialStoreId: null, platformPlanId: 'business',
    }), { code: 'PLATFORM_PLAN_OFFICIAL_STORE_ONLY' });
  });
});
