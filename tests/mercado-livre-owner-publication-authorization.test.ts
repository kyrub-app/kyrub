import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const servicePath = new URL('../server/integrations/mercadoLivreOutboundPublicationAuthorizationService.ts', import.meta.url);
const routerPath = new URL('../server/integrations/mercadoLivreRouter.ts', import.meta.url);

test('owner authorization freezes exactly the provider-validated payload', async () => {
  const source = await readFile(servicePath, 'utf8');
  assert.match(source, /providerPayload/);
  assert.match(source, /payload: validation\.providerPayload/);
  assert.match(source, /payloadHash/);
  assert.match(source, /providerStatus !== 204/);
  assert.match(source, /publicationReadiness !== 'ready_for_owner_authorization'/);
  assert.match(source, /publicationReadinessAuthority !== 'provider_items_validate'/);
});

test('authorization revalidates the exact seller publication model before granting owner authority', async () => {
  const source = await readFile(servicePath, 'utf8');
  const guardIndex = source.indexOf('await assertCurrentMercadoLivrePublicationCapability');
  const tokenIndex = source.indexOf('const authorizationToken = randomBytes(32)');
  assert.ok(guardIndex >= 0);
  assert.ok(tokenIndex > guardIndex);
  assert.match(source, /schemaVersion: 2/);
  assert.match(source, /providerCapabilityFingerprint/);
  assert.match(source, /providerPublicationModel: 'legacy_items'/);
  assert.match(source, /providerStockAuthority: 'item_available_quantity'/);
  assert.match(source, /providerCapability: proposal\.providerCapability/);
});

test('validation capability fingerprint must match the proposal before authorization', async () => {
  const source = await readFile(servicePath, 'utf8');
  assert.match(source, /providerCapabilityFingerprint, 80\) !== proposal\.providerCapabilityFingerprint/);
  assert.match(source, /currentValidation\.providerCapabilityFingerprint !== proposal\.providerCapabilityFingerprint/);
  assert.match(source, /providerPublicationModel !== proposal\.providerPublicationModel/);
  assert.match(source, /providerStockAuthority !== proposal\.providerStockAuthority/);
});

test('authorization is owner-only, expiring and single-use capable', async () => {
  const source = await readFile(servicePath, 'utf8');
  assert.match(source, /authorizedByUserId !== storeId/);
  assert.match(source, /randomBytes\(32\)/);
  assert.match(source, /tokenHash/);
  assert.match(source, /15 \* 60 \* 1000/);
  assert.match(source, /consumptionStatus: 'available'/);
  assert.match(source, /useCount: 0/);
  assert.match(source, /authority: 'store_owner_publication_authorization'/);
  assert.doesNotMatch(source, /tokenHash:\s*authorizationToken/);
});

test('raw authorization token is returned once but never persisted', async () => {
  const source = await readFile(servicePath, 'utf8');
  assert.match(source, /authorizationToken,/);
  assert.match(source, /tokenHash,/);
  assert.doesNotMatch(source, /authorizationToken:\s*authorizationToken/);
  assert.doesNotMatch(source, /transaction\.(?:set|create)\([^\n]+authorizationToken/);
});

test('authorization rechecks canonical freshness transactionally before granting execution authority', async () => {
  const source = await readFile(servicePath, 'utf8');
  assert.match(source, /canonicalMatchesProposal/);
  assert.match(source, /currentValidation\.validatedAt !== validation\.validatedAt/);
  assert.match(source, /stablePayloadHash\(currentValidation\.providerPayload\) !== payloadHash/);
  assert.match(source, /adminDb\.runTransaction/);
  assert.match(source, /executionStatus: 'authorized'/);
});

test('authorization route remains separate from the real Mercado Livre item creation executor', async () => {
  const router = await readFile(routerPath, 'utf8');
  assert.match(router, /authorize-publication/);
  assert.match(router, /authorizeMercadoLivreOutboundPublication/);
  assert.match(router, /authenticatedOwner/);
  assert.doesNotMatch(router, /createMercadoLivreListing|executeMercadoLivrePublication/);
});

test('authorization service itself never calls Mercado Livre POST items', async () => {
  const source = await readFile(servicePath, 'utf8');
  assert.doesNotMatch(source, /mercadoLivrePostJson|['"`]\/items['"`]/);
});
