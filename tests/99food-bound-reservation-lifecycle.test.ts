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

test('bound reservation lifecycle does not publish provider stock or emit fiscal documents', () => {
  assert.doesNotMatch(lifecycleSource, /available_quantity|mercadoLivrePutJson|sendNinetyNineFoodOrderStatus/);
  assert.doesNotMatch(lifecycleSource, /emit.*(?:nfe|nfce|nfse)/i);
});
