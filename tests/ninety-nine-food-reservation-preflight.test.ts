import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const canonical = readFileSync(
  'server/inventory/canonicalInventoryReservationService.ts',
  'utf8'
);
const lifecycle = readFileSync(
  'server/inventory/ninetyNineFoodReservationLifecycle.ts',
  'utf8'
);
const blockService = readFileSync(
  'server/integrations/ninetyNineFoodOrderBlockResolutionService.ts',
  'utf8'
);
const router = readFileSync(
  'server/integrations/ninetyNineFoodRouter.ts',
  'utf8'
);
const client = readFileSync(
  'src/utils/storeChannelOperations.ts',
  'utf8'
);
const queue = readFileSync(
  'src/components/store/StoreChannelOperationsQueue.tsx',
  'utf8'
);

test('canonical preflight and real reservation share the same ATP evaluator', () => {
  const inspectSection = canonical.match(
    /export const inspectCanonicalOrderInventoryAvailability[\s\S]*?\n};\n\nexport const reserveCanonicalOrderInventory/
  )?.[0] ?? '';
  const reserveSection = canonical.match(
    /export const reserveCanonicalOrderInventory[\s\S]*?\n};\n\nexport const transitionCanonicalInventoryReservation/
  )?.[0] ?? '';

  assert.match(canonical, /const evaluateAvailabilityLines =/);
  assert.match(inspectSection, /evaluateAvailabilityLines\(/);
  assert.match(reserveSection, /evaluateAvailabilityLines\(/);
  assert.match(reserveSection, /transaction\.create\(reservationReference/);
});

test('canonical inventory preflight is a consistent read with no reservation write', () => {
  const inspectSection = canonical.match(
    /export const inspectCanonicalOrderInventoryAvailability[\s\S]*?\n};\n\nexport const reserveCanonicalOrderInventory/
  )?.[0] ?? '';

  assert.match(inspectSection, /adminDb\.runTransaction/);
  assert.match(inspectSection, /transaction\.get\(inventoryReference\)/);
  assert.match(inspectSection, /transaction\.get\(reservationReference\)/);
  assert.match(inspectSection, /transaction\.get\(activeReservationsQuery\)/);
  assert.doesNotMatch(
    inspectSection,
    /transaction\.(?:create|set|update|delete)\(/
  );
});

test('99Food preflight reuses the exact current binding resolver instead of fuzzy matching', () => {
  assert.match(lifecycle, /export const extractNinetyNineFoodExternalOrderLines/);
  assert.match(lifecycle, /export const resolveNinetyNineFoodBoundOrderLines/);
  assert.match(lifecycle, /resolveActiveNinetyNineFoodProductBinding/);

  const preflightSection = blockService.match(
    /export const preflightNinetyNineFoodBlockedOrderReservation[\s\S]*?\n};\n\nexport const retryNinetyNineFoodBlockedOrderReservation/
  )?.[0] ?? '';
  assert.match(preflightSection, /extractNinetyNineFoodExternalOrderLines\(order\)/);
  assert.match(preflightSection, /resolveNinetyNineFoodBoundOrderLines/);
  assert.match(preflightSection, /inspectCanonicalOrderInventoryAvailability/);
  assert.match(preflightSection, /state: 'binding_unresolved'/);
  assert.match(preflightSection, /'ready_for_retry'/);
  assert.doesNotMatch(preflightSection, /fuzzy|similar|title|sku/i);
});

test('99Food preflight service never reconciles, reserves, rejects or writes provider state', () => {
  const preflightSection = blockService.match(
    /export const preflightNinetyNineFoodBlockedOrderReservation[\s\S]*?\n};\n\nexport const retryNinetyNineFoodBlockedOrderReservation/
  )?.[0] ?? '';

  assert.doesNotMatch(preflightSection, /reconcileNinetyNineFoodOrderReservation/);
  assert.doesNotMatch(preflightSection, /sendNinetyNineFoodOrderStatus/);
  assert.doesNotMatch(preflightSection, /reserveCanonicalOrderInventory/);
  assert.doesNotMatch(preflightSection, /\.set\(|\.update\(|\.create\(|runTransaction/);
  assert.match(preflightSection, /\.get\(\)/);
});

test('authenticated preflight is GET and the reservation retry remains a separate POST', () => {
  assert.match(
    router,
    /router\.get\('\/blocked-orders\/:orderId\/preflight'/
  );
  assert.match(router, /preflightNinetyNineFoodBlockedOrderReservation/);
  assert.match(
    router,
    /router\.post\('\/blocked-orders\/:orderId\/retry-reservation'/
  );

  const clientPreflight = client.match(
    /export const preflightNinetyNineFoodBlockedOrderReservation[\s\S]*?\n};\n\nexport const retryNinetyNineFoodBlockedOrderReservation/
  )?.[0] ?? '';
  assert.match(clientPreflight, /\/preflight`/);
  assert.doesNotMatch(clientPreflight, /method:\s*'POST'/);
});

test('queue preflight cannot arm or execute the reservation retry', () => {
  const preflightHandler = queue.match(
    /const preflightReservation = async[\s\S]*?\n  };\n\n  const retryReservation/
  )?.[0] ?? '';

  assert.match(preflightHandler, /preflightNinetyNineFoodBlockedOrderReservation/);
  assert.match(preflightHandler, /setConfirmRetryOrderId\(''\)/);
  assert.doesNotMatch(preflightHandler, /retryNinetyNineFoodBlockedOrderReservation/);
  assert.match(queue, /ATP suficiente nesta leitura/);
  assert.match(queue, /O preflight não criou reserva/);
  assert.match(queue, /pode ficar desatualizado/);
});

test('two-step explicit retry remains intact after adding the preflight', () => {
  const retryHandler = queue.match(
    /const retryReservation = async[\s\S]*?\n  };\n\n  return \(/
  )?.[0] ?? '';

  assert.match(retryHandler, /confirmRetryOrderId !== item\.reference/);
  assert.match(retryHandler, /setConfirmRetryOrderId\(item\.reference\)/);
  assert.match(retryHandler, /retryNinetyNineFoodBlockedOrderReservation/);
  assert.match(queue, /Confirmar nova tentativa/);
});
