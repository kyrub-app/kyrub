import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  buildStoreCommerceChannelDeclarationFromAnswer,
} from '../shared/storeConnectionOnboarding.js';
import { parseStoreConnectionSyncAuthority } from '../server/integrations/storeConnectionRegistry.js';

test('merchant answer deterministically declares existing commerce channels without connecting them', () => {
  const declaration = buildStoreCommerceChannelDeclarationFromAnswer({
    storeId: 'store-a',
    declaredByUserId: 'store-a',
    answer: 'Já vendo no Mercado Livre, Shopee, iFood e Instagram.',
    declaredAt: '2026-08-30T23:30:00.000Z',
  });
  assert.deepEqual(declaration.channels, [
    'mercado_livre',
    'shopee',
    'ifood',
    'instagram',
  ]);
  assert.equal(declaration.authority, 'store_owner');
  assert.equal(declaration.source, 'merchant_onboarding');
});

test('merchant channel declaration is owner scoped', () => {
  assert.throws(
    () => buildStoreCommerceChannelDeclarationFromAnswer({
      storeId: 'store-a',
      declaredByUserId: 'store-b',
      answer: 'Mercado Livre',
      declaredAt: '2026-08-30T23:30:00.000Z',
    }),
    /STORE_CHANNEL_DECLARATION_SCOPE_INVALID/
  );
});

test('store connection onboarding API rejects cross-tenant identity before loading registry', () => {
  const source = readFileSync('server/integrations/storeConnectionOnboardingRouter.ts', 'utf8');
  assert.match(source, /identity\.uid !== storeId/);
  assert.match(source, /STORE_CONNECTION_FORBIDDEN/);
  assert.match(source, /\/api\/store-connections|createStoreConnectionOnboardingRouter/);
});

test('public store connection registry projection never exposes vault references or raw credentials', () => {
  const source = readFileSync('server/integrations/storeConnectionRegistry.ts', 'utf8');
  const projection = source.match(/const publicProjection[\s\S]*?\n};/)?.[0] ?? '';
  assert.match(projection, /credentialAuthority: 'vault'/);
  assert.doesNotMatch(projection, /credentialReference/);
  assert.doesNotMatch(projection, /accessToken|refreshToken|clientSecret/);
});

test('onboarding reads only the tenant-scoped registry and does not create external connections', () => {
  const source = readFileSync('server/integrations/storeConnectionOnboardingService.ts', 'utf8');
  assert.match(source, /listPublicStoreConnectionRegistry\(storeId\)/);
  assert.match(source, /loadOwnerStoreInstitutionalRepresentation/);
  assert.doesNotMatch(source, /saveStoreConnectionRegistryRecord/);
  assert.doesNotMatch(source, /accessToken|refreshToken|clientSecret/);
});

test('sync authority accepts only the explicit shared authority modes', () => {
  assert.equal(parseStoreConnectionSyncAuthority('external_to_kyrub'), 'external_to_kyrub');
  assert.equal(parseStoreConnectionSyncAuthority('manual_review'), 'manual_review');
  assert.throws(
    () => parseStoreConnectionSyncAuthority('automatic'),
    /STORE_CONNECTION_SYNC_AUTHORITY_INVALID/
  );
});

test('sync authority route is owner scoped and changes no credentials', () => {
  const router = readFileSync('server/integrations/storeConnectionOnboardingRouter.ts', 'utf8');
  const registry = readFileSync('server/integrations/storeConnectionRegistry.ts', 'utf8');
  assert.match(router, /\/:storeId\/:connectionId\/sync-authority/);
  assert.match(router, /authenticatedOwner/);
  const updater = registry.match(/export const updateStoreConnectionSyncAuthority[\s\S]*$/)?.[0] ?? '';
  assert.match(updater, /syncAuthority/);
  assert.doesNotMatch(updater, /credentialReference\s*:/);
  assert.doesNotMatch(updater, /accessToken|refreshToken|clientSecret/);
});
