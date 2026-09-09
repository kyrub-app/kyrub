import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import './store-location-settings.test';

const appSource = readFileSync('src/App.tsx', 'utf8');
const legacyModalSource = readFileSync(
  'src/components/modals/LegacyStoreConfigModal.tsx',
  'utf8'
);
const modalSource = readFileSync(
  'src/components/modals/StoreConfigModal.tsx',
  'utf8'
);
const gerencialIntegrationsSource = readFileSync(
  'src/components/GerencialIntegrationsRuntime.tsx',
  'utf8'
);
const hoursSource = readFileSync(
  'src/components/store/StoreOpeningHoursEditor.tsx',
  'utf8'
);
const integrationsSource = readFileSync(
  'src/components/store/StoreIntegrationsPanel.tsx',
  'utf8'
);
const integrationBridgeSource = readFileSync(
  'src/components/store/IntegrationTestOrderBridge.tsx',
  'utf8'
);
const settingsSource = readFileSync(
  'src/utils/storeOperationalSettings.ts',
  'utf8'
);
const resetSource = readFileSync('src/utils/storeReset.ts', 'utf8');

test('store settings retires the duplicated integrations tab', () => {
  const profileIndex = legacyModalSource.indexOf('Perfil');
  const environmentsIndex = legacyModalSource.indexOf('Ambientes');

  assert.ok(profileIndex >= 0);
  assert.ok(environmentsIndex > profileIndex);
  assert.doesNotMatch(legacyModalSource, /store-config-integrations-tab/);
  assert.doesNotMatch(legacyModalSource, /configActiveTab === 'integracoes'/);
  assert.match(legacyModalSource, /grid-cols-2/);
});

test('profile receives an editable seven-day opening schedule', () => {
  assert.match(legacyModalSource, /profileOperationalControls/);
  assert.match(hoursSource, /Horário de funcionamento/);
  assert.match(hoursSource, /STORE_WEEKDAYS\.map/);
  assert.match(hoursSource, /type="time"/);
  assert.match(hoursSource, /copy-monday-store-hours/);
  assert.match(hoursSource, /Nenhum horário é preenchido automaticamente/);
});

test('integration onboarding includes the requested fiscal and marketplace channels', () => {
  assert.match(integrationsSource, /Open Delivery — Abrasel/);
  assert.match(integrationsSource, /SEFAZ — NF-e \/ NFC-e/);
  assert.match(integrationsSource, /iFood/);
  assert.match(integrationsSource, /99Food/);
  assert.match(integrationsSource, /Mercado Livre/);
  assert.match(integrationsSource, /Shopee/);
  assert.match(integrationsSource, /Central de integrações omnichannel/);
  assert.match(integrationsSource, /Configurar integração/);
  assert.match(integrationsSource, /Nome da loja no iFood/);
  assert.match(integrationsSource, /Destino dos pedidos no Kyrub/);
  assert.match(integrationsSource, /Receber pedidos/);
  assert.match(integrationsSource, /Sincronizar catálogo/);
  assert.match(integrationsSource, /Sincronizar estoque/);
});

test('canonical integrations runtime owns store channel planning', () => {
  assert.match(gerencialIntegrationsSource, /<StoreIntegrationsPanel/);
  assert.match(gerencialIntegrationsSource, /subscribeToStoreOperationalSettings/);
  assert.match(gerencialIntegrationsSource, /persistStoreIntegrationPlans/);
  assert.match(gerencialIntegrationsSource, /save-consolidated-store-integrations/);
  assert.match(gerencialIntegrationsSource, /Configurações dos canais salvas na loja/);
});

test('Mercado Livre remains on the canonical OAuth and E2E authority', () => {
  assert.match(gerencialIntegrationsSource, /<StoreConnectionsWorkspace/);
  assert.match(gerencialIntegrationsSource, /<MercadoLivreE2ETestBridge/);
  assert.match(gerencialIntegrationsSource, /consolidated-store-channel-plans/);
  assert.match(gerencialIntegrationsSource, /data-integration-id=\"mercado-livre\"/);
  assert.match(gerencialIntegrationsSource, /planejamento genérico antigo do Mercado Livre foi aposentado/);
});

test('browser cannot claim an external integration is active', () => {
  assert.doesNotMatch(settingsSource, /'active'/);
  assert.match(settingsSource, /awaiting-authorization/);
  assert.match(settingsSource, /sandbox-ready/);
  assert.match(integrationsSource, /não comprova conexão com o parceiro/i);
  assert.match(integrationsSource, /nunca devem ser informados aqui/i);
  assert.match(integrationsSource, /Solicitar conexão/);
});

test('orders can be tested against the current operational queue', () => {
  assert.match(integrationsSource, /Enviar pedido de teste/);
  assert.match(integrationsSource, /INTEGRATION_TEST_ORDER_EVENT/);
  assert.match(integrationBridgeSource, /appendIntegrationTestOrder/);
  assert.match(integrationBridgeSource, /onTestOrderCreated/);
  assert.match(appSource, /IntegrationTestOrderBridge/);
  assert.match(appSource, /legacy-cache-/);
});

test('hours and integration plans stay on the same operational settings document', () => {
  assert.match(modalSource, /subscribeToStoreOperationalSettings/);
  assert.match(modalSource, /persistStoreOperationalSettings/);
  assert.match(modalSource, /saveCachedStoreOperationalSettings/);
  assert.match(modalSource, /validateStoreOpeningHours/);
  assert.match(modalSource, /<StoreOpeningHoursEditor/);
  assert.match(settingsSource, /persistStoreIntegrationPlans/);
  assert.match(settingsSource, /doc\(db, 'tenants', user\.uid\)/);
  assert.match(settingsSource, /operationalSettings: normalized/);
});

test('store restart clears schedules and integration onboarding', () => {
  assert.match(resetSource, /operationalSettings: createEmptyStoreOperationalSettings\(\)/);
  assert.match(resetSource, /getStoreOperationalSettingsCacheKey\(userId\)/);
});
