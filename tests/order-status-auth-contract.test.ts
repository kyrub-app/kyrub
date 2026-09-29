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
const authSource = readFileSync(
  'server/ai/consultantAuth.ts',
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

test('browser Firebase tokens are validated against the Kyrub auth project, not a generic server project env', () => {
  assert.match(authSource, /DEFAULT_FIREBASE_PROJECT_ID = 'kyrub-b8d0e'/);
  assert.match(authSource, /process\.env\.KYRUB_FIREBASE_PROJECT_ID/);
  assert.doesNotMatch(
    authSource,
    /process\.env\.FIREBASE_PROJECT_ID/,
    'a Vercel backend project id must not override the Firebase Authentication audience'
  );
  assert.match(authSource, /projectId = resolveFirebaseAuthProjectId\(\)/);
});
