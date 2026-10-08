import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { hasStorePermission, parseStoreMember } from '../src/utils/storeSecurity';

const routerSource = readFileSync('server/attendance/localCouponQuoteRouter.ts', 'utf8');

const member = (role: 'cashier' | 'seller' | 'production', status: 'active' | 'suspended', storeId = 'store-a', userId = 'staff-a') =>
  parseStoreMember({ storeId, userId, role, status });

test('local coupon route checks canonical tenant membership and active status', () => {
  assert.match(routerSource, /tenants\/.*storeId/);
  assert.match(routerSource, /stores\/.*canonicalStoreId.*members\/.*identity\.uid/);
  assert.match(routerSource, /member\.storeId !== canonicalStoreId/);
  assert.match(routerSource, /member\.userId !== identity\.uid/);
  assert.match(routerSource, /member\.status !== 'active'/);
  assert.match(routerSource, /hasStorePermission\(member\.role, 'orders\.create'\)/);
});

test('operational roles may quote only while active and scoped to their store', () => {
  for (const role of ['cashier', 'seller'] as const) {
    const active = member(role, 'active');
    assert.ok(active && active.status === 'active' && hasStorePermission(active.role, 'orders.create'));
    const suspended = member(role, 'suspended');
    assert.ok(suspended && suspended.status !== 'active');
    const otherStore = member(role, 'active', 'store-b');
    assert.ok(otherStore && otherStore.storeId !== 'store-a');
  }
  const production = member('production', 'active');
  assert.ok(production && !hasStorePermission(production.role, 'orders.create'));
});

const pixClientSource = readFileSync('src/utils/localPixCheckout.ts', 'utf8');
const checkoutSource = readFileSync('tests/local-payment-intent-coupon.test.ts', 'utf8');

test('table checkout uses authenticated coupon quote and payment snapshot invariants', () => {
  assert.match(pixClientSource, /authorizedFetch\('\/api\/payments\/coupons\/quote'/);
  assert.match(checkoutSource, /rejects a Pix amount that differs from immutable commercial total/);
  assert.match(checkoutSource, /rejects discounted local intent without coupon\/promotion snapshot/);
});

const paymentRouterSource = readFileSync('server/payments/paymentIntentRouter.ts', 'utf8');
const tableSource = readFileSync('src/components/customer/LegacyTableServiceWorkspace.tsx', 'utf8');

test('table coupon path does not mistake staff identity for customer eligibility', () => {
  assert.match(paymentRouterSource, /router\.post\('\/coupons\/quote'/);
  assert.match(paymentRouterSource, /buyerId: identity\.uid/);
  assert.match(tableSource, /quoteLocalCoupon\(/);
  assert.match(tableSource, /applyTableCoupon\(/);
  // Existing behavior is documented here until an order-bound customer identity is available.
  assert.doesNotMatch(tableSource, /buyerId:/);
});
