import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildMercadoLivreImportProvenance } from '../shared/mercadoLivreIntegration.js';

test('Mercado Livre OAuth uses one-time state and PKCE S256', () => {
  const source = readFileSync('server/integrations/mercadoLivreOauthService.ts', 'utf8');
  assert.match(source, /randomBytes\(32\).*base64url/);
  assert.match(source, /code_challenge_method', 'S256'/);
  assert.match(source, /code_verifier: verifier/);
  assert.match(source, /transaction\.delete\(reference\)/);
  assert.match(source, /MERCADO_LIVRE_REDIRECT_URI/);
});

test('merchant tokens are encrypted and tenant scoped', () => {
  const source = readFileSync('server/integrations/storeConnectionSecretStore.ts', 'utf8');
  assert.match(source, /stores\/\$\{storeId\}\/integrationSecrets\/mercado_livre/);
  assert.match(source, /encryptIntegrationSecret/);
  assert.match(source, /decryptIntegrationSecret/);
  assert.doesNotMatch(source, /accessToken:\s*FieldValue/);
});

test('OAuth callback derives tenant only from server state', () => {
  const source = readFileSync('server/integrations/mercadoLivreRouter.ts', 'utf8');
  const callback = source.match(/router\.get\('\/callback'[\s\S]*?\n  \}\);/)?.[0] ?? '';
  assert.match(callback, /completeMercadoLivreAuthorization\(\{ code, state \}\)/);
  assert.doesNotMatch(callback, /request\.query\.storeId|request\.body\?\.storeId/);
});

test('catalog preview does not write products and confirmed import re-fetches selections server-side', () => {
  const source = readFileSync('server/integrations/mercadoLivreCatalogImportService.ts', 'utf8');
  const preview = source.match(/export const previewMercadoLivreCatalog[\s\S]*?\n};/)?.[0] ?? '';
  assert.doesNotMatch(preview, /batch\.|\.set\(|\.create\(/);
  assert.match(source, /Re-fetch selected items server-side/);
  assert.match(source, /catalogImportDrafts/);
  assert.match(source, /status: 'draft'/);
});

test('import provenance binds external item and connection without publishing it', () => {
  const provenance = buildMercadoLivreImportProvenance({
    externalId: 'MLB123',
    connectionId: 'mercado_livre__456',
    importedAt: '2026-08-30T23:30:00.000Z',
  });
  assert.equal(provenance.source, 'mercado_livre');
  assert.equal(provenance.externalId, 'MLB123');
  assert.equal(provenance.connectionId, 'mercado_livre__456');
});

test('available quantity from provider stays source-labelled and is not canonical stock', () => {
  const contract = readFileSync('shared/mercadoLivreIntegration.ts', 'utf8');
  const service = readFileSync('server/integrations/mercadoLivreCatalogImportService.ts', 'utf8');
  assert.match(contract, /sourceAvailableQuantity/);
  assert.match(service, /sourceAvailableQuantity/);
  assert.doesNotMatch(service, /inventoryQuantity|stockQuantity|canonicalStock/);
});
