import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const routerSource = readFileSync(
  'server/inventory/orderInventoryRouter.ts',
  'utf8'
);
const refundRouterSource = readFileSync(
  'server/payments/storePaymentRefundRouter.ts',
  'utf8'
);

test('order status and refund routes share the Vercel-safe Firebase token verifier', () => {
  assert.match(
    routerSource,
    /verifyFirebaseIdToken\(token\)/,
    'order status route must verify the browser Firebase ID token with the public-certificate verifier'
  );
  assert.doesNotMatch(
    routerSource,
    /adminAuth\.verifyIdToken\(token,\s*true\)/,
    'order status route must not require Admin Auth revocation lookup on Vercel'
  );
  assert.match(refundRouterSource, /verifyFirebaseIdToken/);
  assert.match(routerSource, /if \(!token\) throw new Error\('AUTH_REQUIRED'\)/);
  assert.match(routerSource, /actor|tenantId|authenticatedTenantId/);
});
