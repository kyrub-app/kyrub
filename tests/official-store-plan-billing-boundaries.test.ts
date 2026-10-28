import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

/**
 * Characterization tests for #1007.
 * These protect existing billing boundaries while the Official Store ERP
 * becomes the sole commercial entry point for Kyrub plans.
 */
describe('Official Store Kyrub plan billing boundaries', () => {
  const platform = readFileSync('server/admin/paidPlanSubscriptionService.ts', 'utf8');
  const merchant = readFileSync('server/payments/storeSubscriptionService.ts', 'utf8');
  const official = readFileSync('server/admin/officialStoreService.ts', 'utf8');

  test('Kyrub plan checkout uses platform billing credentials, not merchant OAuth', () => {
    assert.match(platform, /KYRUB_BILLING_MERCADO_PAGO_ACCESS_TOKEN/);
    assert.match(platform, /export const createOwnPaidPlanCheckout/);
    assert.match(platform, /\/preapproval/);
    assert.doesNotMatch(platform, /mercadoPagoStoreRequest/);
    assert.match(merchant, /mercadoPagoStoreRequest/);
  });

  test('Kyrub plan entitlement requires approved and accredited provider evidence', () => {
    assert.match(platform, /payment\.status\) !== 'approved'/);
    assert.match(platform, /payment\.status_detail\) !== 'accredited'/);
    assert.match(platform, /if \(status === 'authorized' && paymentEvidence\)/);
    assert.match(platform, /await activateSubscriptionEntitlement\(ownerId, next\)/);
  });

  test('Official Store identity is designated and resolved canonically', () => {
    assert.match(official, /getOfficialStoreIdentity/);
    assert.match(official, /resolveCanonicalStoreIdentity/);
    assert.match(official, /canonicalStoreId/);
    assert.match(official, /requireSuperAdmin/);
  });

  test('platform subscription checkout never fabricates a store for the buyer', () => {
    assert.match(platform, /await assertStoreExists\(ownerId\)/);
    assert.match(platform, /STORE_NOT_FOUND/);
  });
});
