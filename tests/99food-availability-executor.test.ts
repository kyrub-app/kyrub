import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const serviceSource = readFileSync(
  'server/integrations/ninetyNineFoodAvailabilityExecutorService.ts',
  'utf8'
);
const routerSource = readFileSync(
  'server/integrations/ninetyNineFoodAvailabilityExecutorRouter.ts',
  'utf8'
);
const authorizationRouterSource = readFileSync(
  'server/integrations/ninetyNineFoodAvailabilityAuthorizationRouter.ts',
  'utf8'
);

test('99Food availability executor consumes the one-time authorization timing-safely before provider mutation', () => {
  assert.match(serviceSource, /timingSafeEqual/);
  assert.match(serviceSource, /tokenMatches/);
  assert.match(serviceSource, /useCount !== 0/);
  assert.match(serviceSource, /transaction\.update\(authorizationReference,[\s\S]*useCount: 1/);
  const reserveIndex = serviceSource.indexOf("useCount: 1");
  const patchIndex = serviceSource.indexOf("method: 'PATCH'");
  assert.ok(reserveIndex >= 0);
  assert.ok(patchIndex > reserveIndex);
});

test('executor implements only the official Merchant V2 updateItemOffer quantityAvailable patch', () => {
  assert.match(serviceSource, /providerOperation: 'updateItemOffer'/);
  assert.match(serviceSource, /httpMethod: 'PATCH'/);
  assert.match(serviceSource, /item-offers\/\$\{encodeURIComponent\(input\.itemOfferId\)\}/);
  assert.match(serviceSource, /const requestBody = \{ quantityAvailable: frozen\.targetAvailableQuantity \}/);
  assert.match(serviceSource, /body: requestBodyText/);
  assert.doesNotMatch(serviceSource, /requestBody = \{[^}]*unityPrice|requestBody = \{[^}]*status/);
});

test('executor requires the frozen binding snapshot identity and Discovery capability to remain current', () => {
  assert.match(serviceSource, /BINDING_STALE/);
  assert.match(serviceSource, /SNAPSHOT_STALE/);
  assert.match(serviceSource, /IDENTITY_STALE/);
  assert.match(serviceSource, /CAPABILITY_STALE/);
  assert.match(serviceSource, /supportsPartialUpdate !== true/);
  assert.match(serviceSource, /providerMenuId/);
  assert.match(serviceSource, /providerItemOfferId/);
});

test('202 is accepted but not reconciled and ambiguous outcomes never retry automatically', () => {
  assert.match(serviceSource, /response\.status === 202/);
  assert.match(serviceSource, /provider_write_accepted/);
  assert.match(serviceSource, /response\.status >= 400 && response\.status < 500/);
  assert.match(serviceSource, /provider_rejected/);
  assert.match(serviceSource, /reconciliation_required/);
  assert.doesNotMatch(serviceSource, /while\s*\(|setInterval|retry\s*\(|for\s*\([^)]*attempt/i);
});

test('executor route is owner-authenticated and mounted under the authorization router', () => {
  assert.match(routerSource, /verifyIdToken/);
  assert.match(routerSource, /\/availability-authorizations\/:authorizationId\/execute/);
  assert.match(routerSource, /authorizationToken/);
  assert.match(authorizationRouterSource, /createNinetyNineFoodAvailabilityExecutorRouter/);
  assert.match(authorizationRouterSource, /router\.use\(createNinetyNineFoodAvailabilityExecutorRouter\(\)\)/);
});

test('provider execution does not mutate Kyrub canonical inventory reservations ATP or fiscal state', () => {
  assert.doesNotMatch(serviceSource, /inventoryLedger|physicalQuantity\s*:|reservationStatus\s*:|availableToPromiseUnits\s*:/);
  assert.doesNotMatch(serviceSource, /emit.*(?:nfe|nfce|nfse)/i);
  assert.doesNotMatch(serviceSource, /sendNinetyNineFoodOrderStatus|requestCancellation/);
});
