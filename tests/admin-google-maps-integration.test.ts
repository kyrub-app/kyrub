import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workspace = readFileSync('src/components/admin/AdminIntegrationsWorkspace.tsx', 'utf8');
const client = readFileSync('src/utils/adminIntegrationReadiness.ts', 'utf8');
const credentialService = readFileSync('server/admin/integrationCredentialService.ts', 'utf8');
const readiness = readFileSync('server/admin/integrationReadinessService.ts', 'utf8');
const router = readFileSync('server/admin/operationsHealthRouter.ts', 'utf8');

test('admin integrations exposes Google Maps API key controls without rendering raw saved credentials', () => {
  assert.match(workspace, /Google Maps API Key/);
  assert.match(workspace, /type="password"/);
  assert.match(workspace, /Salvar no cofre/);
  assert.match(workspace, /Testar Geocoding/);
  assert.doesNotMatch(workspace, /credentials\.api_key\.secretRef/);
});

test('client uses authenticated admin backend transports for Google Maps credentials', () => {
  assert.match(client, /google-maps-credentials/);
  assert.match(client, /google-maps-test/);
  assert.match(client, /authorization: `Bearer \$\{token\}`/);
});

test('server stores Google Maps key in platform credential vault and only returns public metadata', () => {
  assert.match(credentialService, /providerId: 'google_maps'/);
  assert.match(credentialService, /api_key: apiKey/);
  assert.match(credentialService, /publicIntegrationCredentialView/);
  assert.match(credentialService, /resolvePlatformCredentials\('google_maps', 'production'\)/);
});

test('Google Maps readiness is a first-class maps provider', () => {
  assert.match(readiness, /id: 'google_maps'/);
  assert.match(readiness, /category: 'maps'/);
  assert.match(readiness, /apiKeyConfigured/);
  assert.match(readiness, /geocodingConfigured/);
});

test('admin operations router exposes explicit Google Maps credential save and test transports', () => {
  assert.match(router, /google-maps-credentials/);
  assert.match(router, /google-maps-test/);
  assert.match(router, /saveAuthorizedGoogleMapsCredentials/);
  assert.match(router, /testAuthorizedGoogleMapsConnection/);
});
