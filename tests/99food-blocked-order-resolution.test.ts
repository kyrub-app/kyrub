import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const resolutionSource = readFileSync(
  'server/integrations/ninetyNineFoodOrderBlockResolutionService.ts',
  'utf8'
);
const lifecycleSource = readFileSync(
  'server/inventory/ninetyNineFoodReservationLifecycle.ts',
  'utf8'
);
const routerSource = readFileSync(
  'server/integrations/ninetyNineFoodRouter.ts',
  'utf8'
);

test('blocked 99Food orders remain operator decisions instead of automatic provider actions', () => {
  assert.match(resolutionSource, /blocked_insufficient_atp/);
  assert.match(resolutionSource, /blocked_product_binding_unresolved/);
  assert.match(resolutionSource, /store_owner_block_resolution/);
  assert.doesNotMatch(lifecycleSource, /sendNinetyNineFoodOrderStatus|requestCancellation/);
});

test('operator may retry reservation after correcting inventory or product binding', () => {
  assert.match(resolutionSource, /retryNinetyNineFoodBlockedOrderReservation/);
  assert.match(resolutionSource, /reconcileNinetyNineFoodOrderReservation/);
  assert.match(routerSource, /\/blocked-orders\/:orderId\/retry-reservation/);
});

test('provider rejection requires an explicit authenticated route and non-empty reason', () => {
  assert.match(routerSource, /\/blocked-orders\/:orderId\/reject/);
  assert.match(resolutionSource, /requestedByUserId !== tenantId/);
  assert.match(resolutionSource, /!reason/);
  assert.match(resolutionSource, /sendNinetyNineFoodOrderStatus\(tenantId, providerOrderId, 'rejected', reason\)/);
});

test('rejection is reserved before provider write and ambiguous failures are never blindly retried', () => {
  const reservationIndex = resolutionSource.indexOf("status: 'executing'");
  const providerWriteIndex = resolutionSource.indexOf('sendNinetyNineFoodOrderStatus');
  assert.ok(reservationIndex >= 0);
  assert.ok(providerWriteIndex > reservationIndex);
  assert.match(resolutionSource, /NINETY_NINE_FOOD_BLOCK_REJECTION_ALREADY_RESERVED/);
  assert.match(resolutionSource, /status: 'reconciliation_required'/);
  assert.doesNotMatch(resolutionSource, /while\s*\(|setInterval|setTimeout/);
});

test('blocked-order resolution does not publish stock or emit fiscal documents', () => {
  assert.doesNotMatch(resolutionSource, /available_quantity|mercadoLivrePutJson/);
  assert.doesNotMatch(resolutionSource, /emit.*(?:nfe|nfce|nfse)/i);
});
