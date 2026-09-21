import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  getBrazilFiscalTaxIdentifierKind,
  isValidBrazilCnpj,
  isValidBrazilCpf,
  validateBrazilFiscalIssuerIdentity,
} from '../src/utils/brazilFiscalIdentifier';
import './fiscal-homologation-policy.test';
import './store-location-settings.test';

const appSource = readFileSync('src/App.tsx', 'utf8');
const mainSource = readFileSync('src/main.tsx', 'utf8');
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
const fiscalHomologationBridgeSource = readFileSync(
  'src/components/store/FiscalHomologationTabBridge.tsx',
  'utf8'
);
const fiscalPreflightWorkspaceSource = readFileSync(
  'src/components/store/FiscalPreflightWorkspace.tsx',
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

test('fiscal issuer onboarding validates CPF, numeric CNPJ and alphanumeric CNPJ', () => {
  assert.equal(getBrazilFiscalTaxIdentifierKind('529.982.247-25'), 'cpf');
  assert.equal(isValidBrazilCpf('529.982.247-25'), true);

  assert.equal(getBrazilFiscalTaxIdentifierKind('04.252.011/0001-10'), 'cnpj');
  assert.equal(isValidBrazilCnpj('04.252.011/0001-10'), true);

  assert.equal(getBrazilFiscalTaxIdentifierKind('00.000.000/E08G-12'), 'cnpj');
  assert.equal(isValidBrazilCnpj('00.000.000/E08G-12'), true);

  assert.doesNotThrow(() =>
    validateBrazilFiscalIssuerIdentity('João da Silva', '529.982.247-25')
  );
  assert.doesNotThrow(() =>
    validateBrazilFiscalIssuerIdentity('Unidade Fiscal', '00.000.000/E08G-12')
  );
  assert.throws(
    () => validateBrazilFiscalIssuerIdentity('', '529.982.247-25'),
    /nome ou a razão social/i
  );
  assert.throws(
    () => validateBrazilFiscalIssuerIdentity('Unidade Fiscal', '00.000.000/E08G-99'),
    /CPF ou CNPJ válido/i
  );
});

test('SEFAZ runtime is explicit fiscal issuer onboarding and keeps new production activation blocked', () => {
  assert.match(integrationsSource, /Identificação fiscal do emissor/);
  assert.match(integrationsSource, /CPF \/ CNPJ do emissor/);
  assert.match(integrationsSource, /CNPJ alfanumérico/);
  assert.match(integrationsSource, /Cadastrar emissor fiscal/);
  assert.match(integrationsSource, /Salvar cadastro fiscal/);
  assert.match(integrationsSource, /plan\.environment !== 'production'/);
  assert.match(integrationsSource, /Produção permanece bloqueada neste primeiro cadastro/);
  assert.match(gerencialIntegrationsSource, /saveSefazDraft/);
  assert.match(gerencialIntegrationsSource, /validateBrazilFiscalIssuerIdentity/);
  assert.match(gerencialIntegrationsSource, /Salvar cadastro fiscal/);
  assert.match(gerencialIntegrationsSource, /A emissão continua bloqueada/);
});

test('fiscal homologation is mounted as a fourth read-only tab in the accounting hub', () => {
  assert.match(mainSource, /FiscalHomologationTabBridge/);
  assert.match(fiscalHomologationBridgeSource, /accounting-fiscal-integrations-hub/);
  assert.match(fiscalHomologationBridgeSource, /accounting-fiscal-tab-homologation/);
  assert.match(fiscalHomologationBridgeSource, /Homologação/);
  assert.match(fiscalHomologationBridgeSource, /FiscalPreflightWorkspace/);
  assert.match(fiscalHomologationBridgeSource, /repeat\(4, minmax\(0, 1fr\)\)/);
});

test('fiscal homologation only performs an authenticated canonical GET and never offers emission', () => {
  assert.match(fiscalPreflightWorkspaceSource, /user\.getIdToken\(\)/);
  assert.match(
    fiscalPreflightWorkspaceSource,
    /\/api\/store-connections\/\$\{encodeURIComponent\(storeId\)\}\/fiscal-preflight\//
  );
  assert.match(fiscalPreflightWorkspaceSource, /method: 'GET'/);
  assert.match(fiscalPreflightWorkspaceSource, /cache: 'no-store'/);
  assert.match(fiscalPreflightWorkspaceSource, /Sem autoridade de emissão/);
  assert.match(fiscalPreflightWorkspaceSource, /Bloqueado para emissão/);
  assert.match(fiscalPreflightWorkspaceSource, /não chama SEFAZ\/provedor/);
  assert.doesNotMatch(fiscalPreflightWorkspaceSource, /method: '(POST|PUT|PATCH|DELETE)'/);
  assert.doesNotMatch(fiscalPreflightWorkspaceSource, />\s*Emitir nota\s*</i);
});

test('fiscal homologation translates every current preflight blocker for the merchant', () => {
  assert.match(fiscalPreflightWorkspaceSource, /accounting_decision_required/);
  assert.match(fiscalPreflightWorkspaceSource, /accounting_policy_resolution_required/);
  assert.match(fiscalPreflightWorkspaceSource, /fiscal_issuer_identity_required/);
  assert.match(fiscalPreflightWorkspaceSource, /product_fiscal_preparation_incomplete/);
  assert.match(fiscalPreflightWorkspaceSource, /commercial_confirmation_required/);
  assert.match(fiscalPreflightWorkspaceSource, /Completar nome fiscal e CPF\/CNPJ do emissor/);
});

test('canonical integrations runtime owns store channel planning', () => {
  assert.match(gerencialIntegrationsSource, /<StoreIntegrationsPanel/);
  assert.match(gerencialIntegrationsSource, /subscribeToStoreOperationalSettings/);
  assert.match(gerencialIntegrationsSource, /persistStoreIntegrationPlans/);
  assert.match(gerencialIntegrationsSource, /save-consolidated-store-integrations/);
  assert.match(gerencialIntegrationsSource, /Configurações dos canais salvas na loja/);
});

test('Mercado Livre remains on the canonical OAuth and E2E authority inside one modal', () => {
  assert.match(gerencialIntegrationsSource, /<StoreConnectionsWorkspace/);
  assert.match(gerencialIntegrationsSource, /<MercadoLivreE2ETestBridge/);
  assert.match(gerencialIntegrationsSource, /consolidated-store-channel-plans/);
  assert.match(gerencialIntegrationsSource, /data-integration-id=\"mercado-livre\"/);
  assert.match(gerencialIntegrationsSource, /mercado-livre-integration-card/);
  assert.match(gerencialIntegrationsSource, /open-mercado-livre-integration/);
  assert.match(gerencialIntegrationsSource, /mercado-livre-integration-modal/);
  assert.match(gerencialIntegrationsSource, /close-mercado-livre-integration/);
  assert.match(gerencialIntegrationsSource, /params\.get\('integration'\) === 'mercado_livre'/);
  assert.match(gerencialIntegrationsSource, /aria-modal="true"/);
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
