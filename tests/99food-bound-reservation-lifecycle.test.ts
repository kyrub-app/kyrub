import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const lifecycleSource = readFileSync(
  'server/inventory/ninetyNineFoodReservationLifecycle.ts',
  'utf8'
);
const bindingSource = readFileSync(
  'server/integrations/ninetyNineFoodProductBindingService.ts',
  'utf8'
);
const resolutionSource = readFileSync(
  'server/integrations/ninetyNineFoodOrderBlockResolutionService.ts',
  'utf8'
);
const routerSource = readFileSync(
  'server/integrations/ninetyNineFoodRouter.ts',
  'utf8'
);

test('new 99Food reservations resolve external items exclusively through active product bindings', () => {
  assert.match(lifecycleSource, /resolveActiveNinetyNineFoodProductBinding/);
  assert.match(lifecycleSource, /externalProductId: line\.externalProductId/);
  assert.match(lifecycleSource, /productId: entry\.binding\.canonicalProductId/);
  assert.doesNotMatch(lifecycleSource, /split\('::'/);
  assert.doesNotMatch(lifecycleSource, /item\.name[\s\S]*canonicalProductId/);
});

test('unmapped 99Food items block reservation before ATP reservation is attempted', () => {
  const unresolvedIndex = lifecycleSource.indexOf("state: 'blocked_product_binding_unresolved'");
  const reserveIndex = lifecycleSource.indexOf('reserveCanonicalOrderInventory({');
  assert.ok(unresolvedIndex >= 0);
  assert.ok(reserveIndex > unresolvedIndex);
  assert.match(lifecycleSource, /unmapped_99food_products:/);
  assert.match(lifecycleSource, /return 'blocked_product_binding_unresolved'/);
});

test('existing reservations can complete historical release and consumption without remapping product identity', () => {
  const findIndex = lifecycleSource.indexOf('let reservationId = await findReservationId');
  const resolveIndex = lifecycleSource.indexOf('resolveBoundOrderLines(', findIndex);
  assert.ok(findIndex >= 0);
  assert.ok(resolveIndex > findIndex);
  assert.match(lifecycleSource, /if \(!reservationId\) \{/);
  assert.match(lifecycleSource, /ledgerStatus === 'consumed'/);
  assert.match(lifecycleSource, /nextStatus: 'released'/);
});

test('binding resolver requires the deterministic active 99Food identity mapping', () => {
  assert.match(bindingSource, /bindingIdFor\(authority\.canonicalStoreId, authority\.externalStoreId, externalProductId\)/);
  assert.match(bindingSource, /binding\.status !== 'active'/);
  assert.match(bindingSource, /binding\.externalProductId !== externalProductId/);
  assert.match(bindingSource, /return binding/);
});

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

test('provider rejection requires explicit authenticated action and a non-empty reason', () => {
  assert.match(routerSource, /\/blocked-orders\/:orderId\/reject/);
  assert.match(resolutionSource, /requestedByUserId !== tenantId/);
  assert.match(resolutionSource, /!reason/);
  assert.match(resolutionSource, /sendNinetyNineFoodOrderStatus\(tenantId, providerOrderId, 'rejected', reason\)/);
});

test('rejection is reserved before provider write and ambiguous failures are not blindly retried', () => {
  const reservationIndex = resolutionSource.indexOf("status: 'executing'");
  const providerWriteIndex = resolutionSource.indexOf('sendNinetyNineFoodOrderStatus');
  assert.ok(reservationIndex >= 0);
  assert.ok(providerWriteIndex > reservationIndex);
  assert.match(resolutionSource, /NINETY_NINE_FOOD_BLOCK_REJECTION_ALREADY_RESERVED/);
  assert.match(resolutionSource, /status: 'reconciliation_required'/);
  assert.doesNotMatch(resolutionSource, /while\s*\(|setInterval|setTimeout/);
});

test('bound reservation and block resolution do not publish provider stock or emit fiscal documents', () => {
  assert.doesNotMatch(lifecycleSource, /available_quantity|mercadoLivrePutJson|sendNinetyNineFoodOrderStatus/);
  assert.doesNotMatch(lifecycleSource, /emit.*(?:nfe|nfce|nfse)/i);
  assert.doesNotMatch(resolutionSource, /available_quantity|mercadoLivrePutJson/);
  assert.doesNotMatch(resolutionSource, /emit.*(?:nfe|nfce|nfse)/i);
});
