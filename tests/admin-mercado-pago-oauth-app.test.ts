import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Mercado Pago OAuth platform configuration requires Kyrub callback', async () => {
  const contract = await source('shared/mercadoPagoPlatformOAuth.ts');
  assert.match(contract, /MERCADO_PAGO_CLIENT_ID_REQUIRED/);
  assert.match(contract, /MERCADO_PAGO_CLIENT_SECRET_REQUIRED/);
  assert.match(contract, /api\/store-connections\/mercado-pago\/callback/);
});

test('saving OAuth application preserves existing Mercado Pago platform credentials', async () => {
  const service = await source('server/admin/integrationCredentialService.ts');
  assert.match(service, /existingMercadoPagoCredentials/);
  assert.match(service, /client_id: oauth\.clientId/);
  assert.match(service, /client_secret: oauth\.clientSecret/);
  assert.match(service, /redirect_uri: oauth\.redirectUri/);
  assert.match(service, /access_token: accessToken/);
});

test('ADM exposes masked OAuth metadata through the existing operations function', async () => {
  const endpoint = await source('api/admin/operations/health.ts');
  const card = await source('src/components/admin/AdminMercadoPagoOAuthCard.tsx');
  assert.match(endpoint, /mercado-pago-oauth-application/);
  assert.match(endpoint, /clientIdLast4/);
  assert.match(endpoint, /clientSecretLast4/);
  assert.match(card, /Salvar aplicação OAuth/);
  assert.match(card, /transport=mercado-pago-oauth-application/);
  assert.match(card, /https:\/\/kyrub\.com\/api\/store-connections\/mercado-pago\/callback/);
});


test('admin mounts OAuth seller application in its native integration workspace, not a missing portal target', async () => {
  const app = await source('src/main.tsx');
  const workspace = await source('src/components/admin/AdminIntegrationsWorkspace.tsx');
  const card = await source('src/components/admin/AdminMercadoPagoOAuthCard.tsx');
  assert.match(workspace, /import AdminMercadoPagoOAuthCard from '.\/AdminMercadoPagoOAuthCard'/);
  assert.match(workspace, /<AdminMercadoPagoProviderCard /);
  assert.match(workspace, /<AdminMercadoPagoOAuthCard user=\{authenticatedUser\} \/>/);
  assert.doesNotMatch(app, /AdminMercadoPagoOAuthBridge/);
  assert.doesNotMatch(card, /createPortal|admin-integrations-title|setTimeout|document\.getElementById/);
  assert.match(card, /status\?\.configured \? 'Configurada' : 'Não configurada'/);
  assert.match(card, /clientIdLast4/);
  assert.match(card, /clientSecretLast4/);
});
