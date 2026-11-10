import assert from 'node:assert/strict';
import test from 'node:test';
import { assertNoOfficialPlanProducts } from '../server/payments/officialPlanMarketplaceGuard.js';

test('ordinary merchant products remain eligible', async () => {
  await assert.doesNotReject(assertNoOfficialPlanProducts(['regular-product'], async () => false));
});

test('mapped official plan cannot be mixed with ordinary products', async () => {
  await assert.rejects(
    assertNoOfficialPlanProducts(['ordinary', 'official-pro'], async id => id === 'official-pro'),
    /CHECKOUT_OFFICIAL_PLAN_REQUIRES_OFFICIAL_FLOW/
  );
});

test('a stale or inactive plan mapping still blocks generic checkout', async () => {
  await assert.rejects(
    assertNoOfficialPlanProducts(['official-business'], async () => true),
    /CHECKOUT_OFFICIAL_PLAN_REQUIRES_OFFICIAL_FLOW/
  );
});

test('mapping lookup errors fail closed', async () => {
  await assert.rejects(
    assertNoOfficialPlanProducts(['unknown'], async () => { throw new Error('FIRESTORE_UNAVAILABLE'); }),
    /FIRESTORE_UNAVAILABLE/
  );
});

test('deduplicates repeated items before lookup', async () => {
  let calls = 0;
  await assertNoOfficialPlanProducts(['regular', 'regular'], async () => { calls++; return false; });
  assert.equal(calls, 1);
});

test('invalid IDs cannot bypass mapping lookup', async () => {
  await assert.rejects(assertNoOfficialPlanProducts(['invalid/id'], async () => false), /CHECKOUT_PRODUCT_NOT_AVAILABLE/);
});
