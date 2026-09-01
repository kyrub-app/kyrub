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

test('this cut does not emit fiscal documents or mutate canonical inventory', () => {
  assert.doesNotMatch(serviceSource, /emit.*(?:nfe|nfce|nfse)/i);
  assert.doesNotMatch(serviceSource, /inventoryLedger|physicalQuantity\s*:|reservationStatus\s*:/);
});
