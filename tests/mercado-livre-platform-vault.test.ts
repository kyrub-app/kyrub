import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { assertMercadoLivrePlatformCredentialInput } from '../shared/mercadoLivrePlatformCredential.js';

test('Mercado Livre platform credential contract requires the canonical HTTPS callback path', () => {
  assert.deepEqual(
    assertMercadoLivrePlatformCredentialInput({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      redirectUri: 'https://kyrub.com/api/store-connections/mercado-livre/oauth/callback',
    }),
    {
      clientId: 'client-id',
      clientSecret: 'client-secret',
      redirectUri: 'https://kyrub.com/api/store-connections/mercado-livre/oauth/callback',
    }
  );
  assert.throws(() => assertMercadoLivrePlatformCredentialInput({
    clientId: 'client-id',
    clientSecret: 'client-secret',
    redirectUri: 'http://kyrub.com/api/store-connections/mercado-livre/oauth/callback',
  }), /HTTPS_REQUIRED/);
});

test('OAuth runtime resolves application credentials only from the server-side platform vault', () => {
  const source = readFileSync('server/integrations/mercadoLivreOauthService.ts', 'utf8');
  assert.match(source, /resolvePlatformCredentials/);
  assert.match(source, /MERCADO_LIVRE_PLATFORM_PROVIDER_ID/);
  assert.doesNotMatch(source, /process\.env\[['"]MERCADO_LIVRE_CLIENT_SECRET/);
  assert.doesNotMatch(source, /requiredEnv\(['"]MERCADO_LIVRE_CLIENT_SECRET/);
});

test('admin Mercado Livre credential surface never returns the complete Client Secret', () => {
  const service = readFileSync('server/admin/mercadoLivrePlatformCredentialService.ts', 'utf8');
  const card = readFileSync('src/components/admin/AdminMercadoLivrePlatformCard.tsx', 'utf8');
  assert.match(service, /savePlatformCredentials/);
  assert.match(service, /clientSecretLast4/);
  assert.doesNotMatch(service, /clientSecret:\s*stored\?\.client_secret/);
  assert.match(card, /type="password"/);
  assert.match(card, /Salvar no cofre/);
  assert.match(card, /Estas credenciais identificam o Kyrub perante o Mercado Livre/);
});

test('platform credentials and seller tokens remain separate authorities', () => {
  const platformService = readFileSync('server/admin/mercadoLivrePlatformCredentialService.ts', 'utf8');
  const sellerStore = readFileSync('server/integrations/storeConnectionSecretStore.ts', 'utf8');
  assert.match(platformService, /providerId: MERCADO_LIVRE_PLATFORM_PROVIDER_ID/);
  assert.match(sellerStore, /storeId/);
  assert.match(sellerStore, /MercadoLivreTokenSecret/);
  assert.doesNotMatch(platformService, /saveMercadoLivreTokenSecret/);
});
