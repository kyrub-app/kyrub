import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const legacyModalSource = readFileSync(
  'src/components/modals/LegacyStoreConfigModal.tsx',
  'utf8'
);
const modalSource = readFileSync(
  'src/components/modals/StoreConfigModal.tsx',
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
const settingsSource = readFileSync(
  'src/utils/storeOperationalSettings.ts',
  'utf8'
);
const resetSource = readFileSync('src/utils/storeReset.ts', 'utf8');

test('store settings places integrations after environments', () => {
  const profileIndex = legacyModalSource.indexOf('Perfil');
  const environmentsIndex = legacyModalSource.indexOf('Ambientes');
  const integrationsIndex = legacyModalSource.indexOf('Integrações');

  assert.ok(profileIndex >= 0);
  assert.ok(environmentsIndex > profileIndex);
  assert.ok(integrationsIndex > environmentsIndex);
  assert.match(legacyModalSource, /store-config-integrations-tab/);
  assert.match(legacyModalSource, /integrationsControls/);
});

test('profile receives an editable seven-day opening schedule', () => {
  assert.match(legacyModalSource, /profileOperationalControls/);
  assert.match(hoursSource, /Horário de funcionamento/);
  assert.match(hoursSource, /STORE_WEEKDAYS\.map/);
  assert.match(hoursSource, /type="time"/);
  assert.match(hoursSource, /copy-monday-store-hours/);
  assert.match(hoursSource, /Nenhum horário é preenchido automaticamente/);
});

test('integration planning includes the requested fiscal and marketplace channels', () => {
  assert.match(integrationsSource, /Open Delivery — Abrasel/);
  assert.match(integrationsSource, /SEFAZ — NF-e \/ NFC-e/);
  assert.match(integrationsSource, /iFood/);
  assert.match(integrationsSource, /99Food/);
  assert.match(integrationsSource, /Mercado Livre/);
  assert.match(integrationsSource, /Shopee/);
  assert.match(integrationsSource, /Central de integrações omnichannel/);
  assert.match(integrationsSource, /Nunca informe senha, token, chave privada ou certificado/);
  assert.match(integrationsSource, /Adicionar ao plano/);
});

test('hours and plans are cached, synchronized and saved with the profile action', () => {
  assert.match(modalSource, /subscribeToStoreOperationalSettings/);
  assert.match(modalSource, /persistStoreOperationalSettings/);
  assert.match(modalSource, /saveCachedStoreOperationalSettings/);
  assert.match(modalSource, /validateStoreOpeningHours/);
  assert.match(modalSource, /<StoreOpeningHoursEditor/);
  assert.match(modalSource, /<StoreIntegrationsPanel/);
  assert.match(settingsSource, /doc\(db, 'tenants', user\.uid\)/);
  assert.match(settingsSource, /operationalSettings: normalized/);
});

test('store restart clears schedules and integration planning', () => {
  assert.match(resetSource, /operationalSettings: createEmptyStoreOperationalSettings\(\)/);
  assert.match(resetSource, /getStoreOperationalSettingsCacheKey\(userId\)/);
});
