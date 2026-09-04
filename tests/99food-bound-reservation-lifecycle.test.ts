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
const catalogIdentitySource = readFileSync(
  'server/integrations/ninetyNineFoodCatalogIdentityService.ts',
  'utf8'
);
const catalogIdentityRouterSource = readFileSync(
  'server/integrations/ninetyNineFoodCatalogIdentityRouter.ts',
  'utf8'
);
const routerSource = readFileSync(
  'server/integrations/ninetyNineFoodRouter.ts',
  'utf8'
);
const operationsClientSource = readFileSync(
  'src/utils/storeChannelOperations.ts',
  'utf8'
);
const operationsQueueSource = readFileSync(
  'src/components/store/StoreChannelOperationsQueue.tsx',
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
  const unresolvedBranchIndex = lifecycleSource.indexOf('if (!reservationId) {', findIndex);
  const resolveIndex = lifecycleSource.indexOf(
    'resolveNinetyNineFoodBoundOrderLines(',
    unresolvedBranchIndex
  );
  assert.ok(findIndex >= 0);
  assert.ok(unresolvedBranchIndex > findIndex);
  assert.ok(resolveIndex > unresolvedBranchIndex);
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

test('reservation retry performs an authoritative order readback after canonical reconciliation', () => {
  const retryStart = resolutionSource.indexOf('export const retryNinetyNineFoodBlockedOrderReservation');
  const retryEnd = resolutionSource.indexOf('export const rejectNinetyNineFoodBlockedOrder', retryStart);
  const retrySection = resolutionSource.slice(retryStart, retryEnd);
  const reconcileIndex = retrySection.indexOf('await reconcileNinetyNineFoodOrderReservation(tenantId, orderId)');
  const readbackIndex = retrySection.indexOf('const readbackSnapshot = await adminDb.doc(orderPath(canonicalStoreId, orderId)).get()');

  assert.ok(retryStart >= 0);
  assert.ok(retryEnd > retryStart);
  assert.ok(reconcileIndex >= 0);
  assert.ok(readbackIndex > reconcileIndex);
  assert.match(retrySection, /integrationProvider\(readbackOrder\) !== '99food'/);
  assert.match(retrySection, /NINETY_NINE_FOOD_BLOCK_RETRY_READBACK_INVALID/);
  assert.match(retrySection, /reconciliationState,/);
  assert.match(retrySection, /state,/);
  assert.match(retrySection, /evidence: reservationEvidence\(readbackOrder\)/);
  assert.match(retrySection, /checkedAt: new Date\(\)\.toISOString\(\)/);
  assert.doesNotMatch(retrySection, /sendNinetyNineFoodOrderStatus|requestedAction: 'reject_order'/);
});

test('reservation retry browser contract validates both reconciliation and authoritative readback states', () => {
  const retryStart = operationsClientSource.indexOf('export const retryNinetyNineFoodBlockedOrderReservation');
  const retryEnd = operationsClientSource.indexOf('export const buildStoreChannelOperationalItems', retryStart);
  const retrySection = operationsClientSource.slice(retryStart, retryEnd);

  assert.match(operationsClientSource, /export type NinetyNineFoodReservationRetryState/);
  assert.match(operationsClientSource, /export interface NinetyNineFoodReservationRetryResult/);
  assert.match(retrySection, /const reconciliationState = retryState\(payload\.reconciliationState\)/);
  assert.match(retrySection, /const state = retryState\(payload\.state\)/);
  assert.match(retrySection, /unresolvedExternalProductIds: retryStringList/);
  assert.match(retrySection, /requiredQuantity: retryFiniteNumber/);
  assert.match(retrySection, /availableQuantity: retryFiniteNumber/);
  assert.doesNotMatch(retrySection, /localStorage|sessionStorage|indexedDB/);
});

test('reservation retry UI reports the authoritative outcome then reloads the queue without another retry', () => {
  const feedbackStart = operationsQueueSource.indexOf('const retryFeedback =');
  const componentStart = operationsQueueSource.indexOf('export default function StoreChannelOperationsQueue');
  const feedbackSection = operationsQueueSource.slice(feedbackStart, componentStart);
  const handlerStart = operationsQueueSource.indexOf('const retryReservation = async');
  const handlerEnd = operationsQueueSource.indexOf('const operationBusy', handlerStart);
  const handlerSection = operationsQueueSource.slice(handlerStart, handlerEnd);

  assert.ok(feedbackStart >= 0);
  assert.match(feedbackSection, /result\.reconciliationState !== result\.state/);
  assert.match(feedbackSection, /result\.state === 'reserved'/);
  assert.match(feedbackSection, /result\.state === 'blocked_insufficient_atp'/);
  assert.match(feedbackSection, /result\.state === 'blocked_product_binding_unresolved'/);
  assert.match(feedbackSection, /result\.state === 'blocked_authority_unresolved'/);
  assert.match(feedbackSection, /result\.state === 'released'/);
  assert.match(feedbackSection, /result\.state === 'consumed'/);
  assert.match(feedbackSection, /result\.state === 'waiting_physical_consumption'/);
  assert.match(feedbackSection, /Nenhum status foi enviado à 99Food/);
  assert.doesNotMatch(feedbackSection, /retryNinetyNineFoodBlockedOrderReservation|sendNinetyNineFoodOrderStatus|openRemediation/);

  const retryCallIndex = handlerSection.indexOf('const result = await retryNinetyNineFoodBlockedOrderReservation');
  const toneIndex = handlerSection.indexOf('setActionFeedbackTone(retryFeedbackTone(result.state))');
  const feedbackIndex = handlerSection.indexOf('setActionFeedback(retryFeedback(result))');
  const refreshIndex = handlerSection.indexOf('await refresh()');
  assert.ok(retryCallIndex >= 0);
  assert.ok(toneIndex > retryCallIndex);
  assert.ok(feedbackIndex > toneIndex);
  assert.ok(refreshIndex > feedbackIndex);
  assert.equal(handlerSection.match(/retryNinetyNineFoodBlockedOrderReservation/g)?.length, 1);
});

test('reservation retry feedback tone follows the authoritative readback state', () => {
  const blockedHelperStart = operationsQueueSource.indexOf('const retryStateRemainsBlocked =');
  const toneStart = operationsQueueSource.indexOf('const retryFeedbackTone =');
  const feedbackStart = operationsQueueSource.indexOf('const retryFeedback =', toneStart);
  const blockedHelperSection = operationsQueueSource.slice(blockedHelperStart, toneStart);
  const toneSection = operationsQueueSource.slice(toneStart, feedbackStart);

  assert.match(operationsQueueSource, /type RetryFeedbackTone = 'success' \| 'warning' \| 'neutral'/);
  assert.ok(blockedHelperStart >= 0);
  assert.ok(toneStart > blockedHelperStart);
  assert.ok(feedbackStart > toneStart);
  assert.match(blockedHelperSection, /state === 'blocked_insufficient_atp'/);
  assert.match(blockedHelperSection, /state === 'blocked_product_binding_unresolved'/);
  assert.match(blockedHelperSection, /state === 'blocked_authority_unresolved'/);
  assert.match(toneSection, /retryStateRemainsBlocked\(state\)/);
  assert.match(toneSection, /return 'warning'/);
  assert.match(toneSection, /state === 'reserved'/);
  assert.match(toneSection, /state === 'consumed'/);
  assert.match(toneSection, /state === 'waiting_physical_consumption'/);
  assert.match(toneSection, /return 'success'/);
  assert.match(toneSection, /return 'neutral'/);
  assert.match(operationsQueueSource, /actionFeedbackTone === 'warning'/);
  assert.match(operationsQueueSource, /actionFeedbackTone === 'neutral'/);
  assert.match(operationsQueueSource, /border-amber-500\/20 bg-amber-500\/5 text-amber-100/);
  assert.match(operationsQueueSource, /border-emerald-500\/20 bg-emerald-500\/5 text-emerald-200/);
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

test('99Food catalog identity reads Merchant V2 and snapshots without provider mutation', () => {
  assert.match(catalogIdentitySource, /merchants\/\$\{encodeURIComponent\(context\.merchantId\)\}/);
  assert.match(catalogIdentitySource, /menus\/\$\{encodeURIComponent\(menuId\)\}\/snapshot/);
  assert.match(catalogIdentitySource, /method: 'GET'/);
  assert.match(catalogIdentitySource, /scope: 'od\.menu'/);
  assert.doesNotMatch(catalogIdentitySource, /method: 'PUT'|method: 'PATCH'|method: 'DELETE'/);
});

test('99Food catalog identity accepts only exact ItemOffer id or externalCode matches', () => {
  assert.match(catalogIdentitySource, /looksLikeItemOffer = Object\.prototype\.hasOwnProperty\.call\(candidate, 'unityPrice'\)/);
  assert.match(catalogIdentitySource, /externalProductId === itemOfferId \|\| externalProductId === externalCode/);
  assert.doesNotMatch(catalogIdentitySource, /name.*externalProductId|includes\(externalProductId\)|levenshtein|fuzzy/i);
  assert.match(catalogIdentitySource, /'resolved' \| 'not_found' \| 'ambiguous'/);
});

test('99Food catalog identity freezes provider evidence and current binding revision', () => {
  assert.match(catalogIdentitySource, /providerEvidenceHash/);
  assert.match(catalogIdentitySource, /provider_merchant_snapshot_exact_identity_match/);
  assert.match(catalogIdentitySource, /Number\(current\?\.revision\) !== binding\.revision/);
  assert.match(catalogIdentitySource, /NINETY_NINE_FOOD_CATALOG_IDENTITY_BINDING_STALE/);
  assert.match(catalogIdentitySource, /transaction\.create\(resolutionReference/);
});

test('99Food catalog identity API is owner-authenticated and nested under the 99Food integration router', () => {
  assert.match(catalogIdentityRouterSource, /verifyIdToken/);
  assert.match(catalogIdentityRouterSource, /\/product-bindings\/:externalProductId\/catalog-identity/);
  assert.match(catalogIdentityRouterSource, /\/catalog-identity\/resolve/);
  assert.match(availabilityProposalRouterSource, /createNinetyNineFoodCatalogIdentityRouter/);
  assert.match(availabilityProposalRouterSource, /router\.use\(createNinetyNineFoodCatalogIdentityRouter\(\)\)/);
});

test('bound reservation block resolution availability proposal discovery and identity resolution do not publish provider stock or emit fiscal documents', () => {
  assert.doesNotMatch(lifecycleSource, /available_quantity|mercadoLivrePutJson|sendNinetyNineFoodOrderStatus/);
  assert.doesNotMatch(lifecycleSource, /emit.*(?:nfe|nfce|nfse)/i);
  assert.doesNotMatch(resolutionSource, /available_quantity|mercadoLivrePutJson/);
  assert.doesNotMatch(resolutionSource, /emit.*(?:nfe|nfce|nfse)/i);
  assert.doesNotMatch(availabilityProposalSource, /sendAction|sendNinetyNineFoodOrderStatus|fetch\(|axios|available_quantity/);
  assert.doesNotMatch(availabilityProposalSource, /emit.*(?:nfe|nfce|nfse)/i);
  assert.doesNotMatch(menuCapabilitySource, /sendNinetyNineFoodOrderStatus|sendAction|available_quantity|emit.*(?:nfe|nfce|nfse)/i);
  assert.doesNotMatch(catalogIdentitySource, /quantityAvailable\s*:.*target|sendAction|sendNinetyNineFoodOrderStatus|emit.*(?:nfe|nfce|nfse)/i);
});
