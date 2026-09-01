import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const serviceSource = readFileSync(
  'server/integrations/ninetyNineFoodAvailabilityAuthorizationService.ts',
  'utf8'
);
const routerSource = readFileSync(
  'server/integrations/ninetyNineFoodAvailabilityAuthorizationRouter.ts',
  'utf8'
);
const proposalRouterSource = readFileSync(
  'server/integrations/ninetyNineFoodAvailabilityProposalRouter.ts',
  'utf8'
);
const executorSource = readFileSync(
  'server/integrations/ninetyNineFoodAvailabilityExecutorService.ts',
  'utf8'
);
const executorRouterSource = readFileSync(
  'server/integrations/ninetyNineFoodAvailabilityExecutorRouter.ts',
  'utf8'
);

test('99Food availability authorization freezes exact canonical and provider identity evidence', () => {
  assert.match(serviceSource, /channelAvailabilitySnapshotId: snapshotId/);
  assert.match(serviceSource, /channelAvailabilitySourceFingerprint: sourceFingerprint/);
  assert.match(serviceSource, /bindingRevision/);
  assert.match(serviceSource, /catalogIdentityProviderEvidenceHash/);
  assert.match(serviceSource, /capabilityManifestHash/);
  assert.match(serviceSource, /providerMenuId/);
  assert.match(serviceSource, /providerItemOfferId/);
});

test('authorized quantity comes only from the already frozen proposal and current channel snapshot', () => {
  assert.match(serviceSource, /targetAvailableQuantity = integer\(proposal\.targetAvailableQuantity\)/);
  assert.match(serviceSource, /integer\(snapshot\.publishableUnits\) !== targetAvailableQuantity/);
  assert.match(serviceSource, /snapshot\.authority !== SNAPSHOT_AUTHORITY/);
  assert.doesNotMatch(serviceSource, /physicalQuantity\s*[-+]|availableToPromiseUnits\s*[-+]/);
});

test('authorization requires resolved exact ItemOffer identity and provider partial update capability', () => {
  assert.match(serviceSource, /identity\.status !== 'resolved'/);
  assert.match(serviceSource, /providerItemOfferId/);
  assert.match(serviceSource, /capability\.supportsPartialUpdate !== true/);
  assert.match(serviceSource, /merchant_v2_candidate/);
});

test('authorization token is random one-time evidence and only its hash is persisted', () => {
  assert.match(serviceSource, /randomBytes\(32\)\.toString\('base64url'\)/);
  assert.match(serviceSource, /tokenHash = sha256\(authorizationToken\)/);
  assert.match(serviceSource, /AUTHORIZATION_TTL_MS = 15 \* 60 \* 1000/);
  assert.match(serviceSource, /useCount: 0/);
  assert.match(serviceSource, /executionStatus: 'not_executed'/);
  assert.match(serviceSource, /const \{ tokenHash: _tokenHash, \.\.\.publicAuthorization \} = authorization/);
  assert.match(serviceSource, /authorizationToken/);
});

test('authorization revalidates proposal binding snapshot identity and capability in one transaction', () => {
  assert.match(serviceSource, /adminDb\.runTransaction/);
  assert.match(serviceSource, /transaction\.get\(proposalReference\)/);
  assert.match(serviceSource, /externalProductBindings/);
  assert.match(serviceSource, /channelAvailabilitySnapshots/);
  assert.match(serviceSource, /currentIdentityPath/);
  assert.match(serviceSource, /capabilityState\/menu/);
  assert.match(serviceSource, /PROPOSAL_STALE/);
  assert.match(serviceSource, /BINDING_STALE/);
  assert.match(serviceSource, /SNAPSHOT_STALE/);
  assert.match(serviceSource, /IDENTITY_STALE/);
  assert.match(serviceSource, /CAPABILITY_STALE/);
});

test('authorization freezes logical Merchant V2 mutation without inventing provider transport', () => {
  assert.match(serviceSource, /merchant_v2_item_offer_quantity_available/);
  assert.match(serviceSource, /field: 'quantityAvailable'/);
  assert.match(serviceSource, /value: targetAvailableQuantity/);
  assert.match(serviceSource, /intendedMutationHash/);
  assert.doesNotMatch(serviceSource, /method:\s*'PATCH'|method:\s*'PUT'|method:\s*'POST'/);
  assert.doesNotMatch(serviceSource, /await fetch\(|axios|sendAction|sendNinetyNineFoodOrderStatus/);
});

test('owner-authenticated authorization route is mounted under 99Food availability proposal router', () => {
  assert.match(routerSource, /verifyIdToken/);
  assert.match(routerSource, /\/availability-proposals\/:proposalId\/authorize/);
  assert.match(proposalRouterSource, /createNinetyNineFoodAvailabilityAuthorizationRouter/);
  assert.match(proposalRouterSource, /router\.use\(createNinetyNineFoodAvailabilityAuthorizationRouter\(\)\)/);
});

test('99Food executor consumes the one-time authorization timing-safely before provider mutation', () => {
  assert.match(executorSource, /timingSafeEqual/);
  assert.match(executorSource, /tokenMatches/);
  assert.match(executorSource, /useCount !== 0/);
  assert.match(executorSource, /transaction\.update\(authorizationReference,[\s\S]*useCount: 1/);
  const reserveIndex = executorSource.indexOf('useCount: 1');
  const providerWriteIndex = executorSource.indexOf('const response = await fetch(target.url');
  assert.ok(reserveIndex >= 0);
  assert.ok(providerWriteIndex > reserveIndex);
});

test('99Food executor implements only Merchant V2 updateItemOffer quantityAvailable PATCH', () => {
  assert.match(executorSource, /providerOperation: 'updateItemOffer'/);
  assert.match(executorSource, /httpMethod: 'PATCH'/);
  assert.match(executorSource, /item-offers\/\$\{encodeURIComponent\(input\.itemOfferId\)\}/);
  assert.match(executorSource, /const requestBody = \{ quantityAvailable: frozen\.targetAvailableQuantity \}/);
  assert.match(executorSource, /body: requestBodyText/);
  assert.doesNotMatch(executorSource, /const requestBody = \{[^}]*unityPrice|const requestBody = \{[^}]*status/);
});

test('99Food executor revalidates frozen binding snapshot identity and Discovery capability', () => {
  assert.match(executorSource, /BINDING_STALE/);
  assert.match(executorSource, /SNAPSHOT_STALE/);
  assert.match(executorSource, /IDENTITY_STALE/);
  assert.match(executorSource, /CAPABILITY_STALE/);
  assert.match(executorSource, /supportsPartialUpdate !== true/);
  assert.match(executorSource, /providerMenuId/);
  assert.match(executorSource, /providerItemOfferId/);
});

test('202 is accepted but not reconciled and ambiguous provider outcomes are never blindly retried', () => {
  assert.match(executorSource, /response\.status === 202/);
  assert.match(executorSource, /provider_write_accepted/);
  assert.match(executorSource, /response\.status >= 400 && response\.status < 500/);
  assert.match(executorSource, /provider_rejected/);
  assert.match(executorSource, /reconciliation_required/);
  assert.doesNotMatch(executorSource, /while\s*\(|setInterval|for\s*\([^)]*attempt/i);
});

test('executor route is owner-authenticated and nested under the authorization router', () => {
  assert.match(executorRouterSource, /verifyIdToken/);
  assert.match(executorRouterSource, /\/availability-authorizations\/:authorizationId\/execute/);
  assert.match(executorRouterSource, /authorizationToken/);
  assert.match(routerSource, /createNinetyNineFoodAvailabilityExecutorRouter/);
  assert.match(routerSource, /router\.use\(createNinetyNineFoodAvailabilityExecutorRouter\(\)\)/);
});

test('authorization and provider execution do not mutate Kyrub canonical inventory reservations ATP or fiscal state', () => {
  assert.doesNotMatch(serviceSource, /emit.*(?:nfe|nfce|nfse)/i);
  assert.doesNotMatch(serviceSource, /inventoryLedger|physicalQuantity\s*:|reservationStatus\s*:/);
  assert.doesNotMatch(executorSource, /inventoryLedger|physicalQuantity\s*:|reservationStatus\s*:|availableToPromiseUnits\s*:/);
  assert.doesNotMatch(executorSource, /emit.*(?:nfe|nfce|nfse)/i);
  assert.doesNotMatch(executorSource, /sendNinetyNineFoodOrderStatus|requestCancellation/);
});
