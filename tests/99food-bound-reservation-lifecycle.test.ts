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
const availabilityProposalSource = readFileSync(
  'server/integrations/ninetyNineFoodAvailabilityProposalService.ts',
  'utf8'
);
const availabilityProposalRouterSource = readFileSync(
  'server/integrations/ninetyNineFoodAvailabilityProposalRouter.ts',
  'utf8'
);
const menuCapabilitySource = readFileSync(
  'server/integrations/ninetyNineFoodMenuCapabilityService.ts',
  'utf8'
);
const menuCapabilityRouterSource = readFileSync(
  'server/integrations/ninetyNineFoodMenuCapabilityRouter.ts',
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
  const providerWriteIndex = resolutionSource.indexOf('await sendNinetyNineFoodOrderStatus');
  assert.ok(reservationIndex >= 0);
  assert.ok(providerWriteIndex > reservationIndex);
  assert.match(resolutionSource, /NINETY_NINE_FOOD_BLOCK_REJECTION_ALREADY_RESERVED/);
  assert.match(resolutionSource, /status: 'reconciliation_required'/);
  assert.doesNotMatch(resolutionSource, /while\s*\(|setInterval|setTimeout/);
});

test('99Food availability proposal requires an active owner-mapped binding and frozen channel snapshot', () => {
  assert.match(availabilityProposalSource, /resolveActiveNinetyNineFoodProductBinding/);
  assert.match(availabilityProposalSource, /channelAvailabilitySnapshots\/\$\{snapshotId\}/);
  assert.match(availabilityProposalSource, /snapshot\.channel[\s\S]*PROVIDER/);
  assert.match(availabilityProposalSource, /kyrub_inventory_reservation_policy_snapshot/);
  assert.match(availabilityProposalSource, /inventoryAuthorityOwnerUserId/);
});

test('99Food availability proposal freezes and revalidates the active product binding revision', () => {
  assert.match(availabilityProposalSource, /bindingRevision: binding\.revision/);
  assert.match(availabilityProposalSource, /transaction\.get\(bindingReference\)/);
  assert.match(availabilityProposalSource, /binding\.bindingAuthority === BINDING_AUTHORITY/);
  assert.match(availabilityProposalSource, /binding\.status === 'active'/);
  assert.match(availabilityProposalSource, /NINETY_NINE_FOOD_AVAILABILITY_BINDING_STALE/);
  assert.match(availabilityProposalRouterSource, /CONFLICT\|BINDING_STALE/);
});

test('99Food availability proposal target comes only from publishableUnits and remains review-only', () => {
  assert.match(availabilityProposalSource, /targetAvailableQuantity: snapshot\.publishableUnits/);
  assert.match(availabilityProposalSource, /status: 'review_required'/);
  assert.match(availabilityProposalSource, /executionStatus: 'not_authorized'/);
  assert.match(availabilityProposalSource, /providerReadStatus: 'not_requested'/);
  assert.match(availabilityProposalSource, /kyrub_channel_availability_snapshot_and_store_owner_mapping/);
});

test('99Food availability proposal API is authenticated and mounted under the integration router', () => {
  assert.match(availabilityProposalRouterSource, /verifyIdToken/);
  assert.match(availabilityProposalRouterSource, /\/availability-proposals/);
  assert.match(availabilityProposalRouterSource, /\/product-bindings\/:externalProductId\/availability-proposals/);
  assert.match(routerSource, /createNinetyNineFoodAvailabilityProposalRouter/);
  assert.match(routerSource, /router\.use\(createNinetyNineFoodAvailabilityProposalRouter\(\)\)/);
});

test('99Food menu capability discovery derives the well-known URL only from the configured connection host', () => {
  assert.match(menuCapabilitySource, /new URL\('\/\.well-known\/opendelivery', parsed\.origin\)/);
  assert.match(menuCapabilitySource, /connectionPath\(tenantId\)/);
  assert.match(menuCapabilitySource, /clean\(current\?\.baseUrl[\s\S]*clean\(connection\.baseUrl/);
  assert.doesNotMatch(menuCapabilityRouterSource, /discoveryUrl.*request\.body|request\.query.*discovery/i);
});

test('99Food menu capability discovery is public-read only at provider and blocks redirects', () => {
  assert.match(menuCapabilitySource, /method: 'GET'/);
  assert.match(menuCapabilitySource, /redirect: 'error'/);
  assert.match(menuCapabilitySource, /accept: 'application\/json'/);
  assert.doesNotMatch(menuCapabilitySource, /authorization|clientSecret|merchantApiKey/i);
  assert.doesNotMatch(menuCapabilitySource, /method: 'POST'|method: 'PUT'|method: 'PATCH'|method: 'DELETE'/);
});

test('99Food menu capability discovery freezes provider-declared authentication authority', () => {
  assert.match(menuCapabilitySource, /authenticationSupportedGrantTypes: supportedGrantTypes/);
  assert.match(menuCapabilitySource, /authenticationClientIdGeneration: clientIdGeneration/);
  assert.match(menuCapabilitySource, /authentication\.supportedGrantTypes/);
  assert.match(menuCapabilitySource, /authentication\.clientIdGeneration/);
});

test('99Food menu capability discovery persists immutable provider evidence and classifies Merchant V2 conservatively', () => {
  assert.match(menuCapabilitySource, /authority: DISCOVERY_AUTHORITY/);
  assert.match(menuCapabilitySource, /provider_public_discovery/);
  assert.match(menuCapabilitySource, /transaction\.create\(snapshotReference/);
  assert.match(menuCapabilitySource, /merchant_v2_candidate/);
  assert.match(menuCapabilitySource, /merchant_unavailable/);
  assert.match(menuCapabilitySource, /supportsV2 && merchantSupported && Boolean\(merchantEndpoint\)/);
});

test('99Food menu capability discovery API is owner-authenticated and mounted under the integration router', () => {
  assert.match(menuCapabilityRouterSource, /verifyIdToken/);
  assert.match(menuCapabilityRouterSource, /\/capabilities\/menu/);
  assert.match(menuCapabilityRouterSource, /\/capabilities\/menu\/discover/);
  assert.match(routerSource, /createNinetyNineFoodMenuCapabilityRouter/);
  assert.match(routerSource, /router\.use\(createNinetyNineFoodMenuCapabilityRouter\(\)\)/);
});

test('bound reservation block resolution availability proposal and discovery do not publish provider stock or emit fiscal documents', () => {
  assert.doesNotMatch(lifecycleSource, /available_quantity|mercadoLivrePutJson|sendNinetyNineFoodOrderStatus/);
  assert.doesNotMatch(lifecycleSource, /emit.*(?:nfe|nfce|nfse)/i);
  assert.doesNotMatch(resolutionSource, /available_quantity|mercadoLivrePutJson/);
  assert.doesNotMatch(resolutionSource, /emit.*(?:nfe|nfce|nfse)/i);
  assert.doesNotMatch(availabilityProposalSource, /sendAction|sendNinetyNineFoodOrderStatus|fetch\(|axios|available_quantity/);
  assert.doesNotMatch(availabilityProposalSource, /emit.*(?:nfe|nfce|nfse)/i);
  assert.doesNotMatch(menuCapabilitySource, /sendNinetyNineFoodOrderStatus|sendAction|available_quantity|emit.*(?:nfe|nfce|nfse)/i);
});
