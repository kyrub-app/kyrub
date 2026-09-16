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
const gerencialPanelSource = readFileSync(
  'src/components/GerencialPanel.tsx',
  'utf8'
);
const administrativeAuditServiceSource = readFileSync(
  'server/integrations/storeAdministrativeAuditService.ts',
  'utf8'
);
const ninetyNineFoodBlockResolutionSource = readFileSync(
  'server/integrations/ninetyNineFoodOrderBlockResolutionService.ts',
  'utf8'
);
const onboardingRouterSource = readFileSync(
  'server/integrations/storeConnectionOnboardingRouter.ts',
  'utf8'
);
const administrativeAuditWorkspaceSource = readFileSync(
  'src/components/store/StoreAdministrativeAuditWorkspace.tsx',
  'utf8'
);
const administrativeAuditClientSource = readFileSync(
  'src/utils/storeAdministrativeAudit.ts',
  'utf8'
);
const teamAccessServiceSource = readFileSync(
  'server/integrations/storeTeamAccessService.ts',
  'utf8'
);
const teamAccessWorkspaceSource = readFileSync(
  'src/components/store/StoreTeamAccessWorkspace.tsx',
  'utf8'
);
const teamAccessClientSource = readFileSync(
  'src/utils/storeTeamAccess.ts',
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

test('store Gerencial exposes an independent read-only Actions and Audit module', () => {
  assert.match(gerencialPanelSource, /\| 'auditoria'/);
  assert.match(gerencialPanelSource, /auditoria: 'Ações & Auditoria'/);
  assert.match(gerencialPanelSource, /title="Ações & Auditoria"/);
  assert.match(gerencialPanelSource, /<StoreAdministrativeAuditWorkspace user=\{user\} storeId=\{user\.uid\}/);
  assert.match(administrativeAuditWorkspaceSource, /ADM do lojista · somente leitura/);
  assert.match(administrativeAuditWorkspaceSource, /O Kyrub não cria registros fictícios/);
  assert.doesNotMatch(administrativeAuditWorkspaceSource, /method:\s*'POST'|method:\s*'PUT'|method:\s*'PATCH'|method:\s*'DELETE'/);
});

test('administrative audit API is owner-only and exposes a GET projection without browser write authority', () => {
  assert.match(onboardingRouterSource, /router\.get\('\/:storeId\/administrative-audit'/);
  assert.match(onboardingRouterSource, /authenticatedOwner\(request\.get\('authorization'\)/);
  assert.match(onboardingRouterSource, /loadStoreAdministrativeAudit\(/);
  assert.match(onboardingRouterSource, /requestedByUserId: identity\.uid/);
  assert.doesNotMatch(onboardingRouterSource, /router\.(?:post|put|patch|delete)\('\/:storeId\/administrative-audit'/);
  assert.match(administrativeAuditClientSource, /method:\s*'POST'|fetch\(/);
  assert.doesNotMatch(administrativeAuditClientSource, /method:\s*'(?:POST|PUT|PATCH|DELETE)'/);
});

test('administrative audit projects real domain evidence and degrades individual unavailable sources safely', () => {
  assert.match(administrativeAuditServiceSource, /ownerGovernanceDecisions/);
  assert.match(administrativeAuditServiceSource, /inventoryAuthorityRepairs/);
  assert.match(administrativeAuditServiceSource, /integrationManualReviewAudit/);
  assert.match(administrativeAuditServiceSource, /administrativeAudit/);
  assert.match(administrativeAuditServiceSource, /Promise\.allSettled/);
  assert.match(administrativeAuditServiceSource, /sourceWarnings/);
  assert.match(administrativeAuditServiceSource, /merged\.has\(event\.sourceRef\)/);
  assert.match(administrativeAuditServiceSource, /readAuthority: 'store_owner'/);
});

test('99Food contributes only persisted binding and blocked-order resolution evidence to the store audit', () => {
  assert.match(administrativeAuditServiceSource, /externalProductBindingAudits/);
  assert.match(administrativeAuditServiceSource, /integrationOrderBlockResolutions/);
  assert.match(administrativeAuditServiceSource, /99food_product_binding_audit/);
  assert.match(administrativeAuditServiceSource, /99food_order_block_resolution/);
  assert.match(administrativeAuditServiceSource, /provider: '99food'/);
  assert.match(administrativeAuditWorkspaceSource, /Canal: 99Food/);
  assert.match(administrativeAuditWorkspaceSource, /Binding 99Food criado/);
  assert.match(administrativeAuditWorkspaceSource, /Pedido 99Food rejeitado/);
  assert.doesNotMatch(administrativeAuditServiceSource, /sendNinetyNineFoodOrderStatus|reconcileNinetyNineFoodOrderReservation/);
});

test('99Food blocked-order reservation retry emits append-only requested and outcome evidence', () => {
  const retryStart = ninetyNineFoodBlockResolutionSource.indexOf(
    'export const retryNinetyNineFoodBlockedOrderReservation'
  );
  const rejectStart = ninetyNineFoodBlockResolutionSource.indexOf(
    'export const rejectNinetyNineFoodBlockedOrder',
    retryStart
  );
  assert.ok(retryStart >= 0 && rejectStart > retryStart);
  const retrySection = ninetyNineFoodBlockResolutionSource.slice(retryStart, rejectStart);
  const requestedAudit = retrySection.indexOf("phase: 'requested'");
  const reconcileCall = retrySection.indexOf('reconcileNinetyNineFoodOrderReservation');
  const completedAudit = retrySection.indexOf("phase: 'completed'");
  assert.ok(requestedAudit >= 0 && reconcileCall > requestedAudit && completedAudit > reconcileCall);
  assert.match(ninetyNineFoodBlockResolutionSource, /appendStoreAdministrativeAuditEvent/);
  assert.match(ninetyNineFoodBlockResolutionSource, /sourceKind: '99food_reservation_retry'/);
  assert.match(ninetyNineFoodBlockResolutionSource, /authority: 'store_owner_inventory_reservation_retry'/);
  assert.match(ninetyNineFoodBlockResolutionSource, /randomUUID\(\)/);
  assert.match(retrySection, /phase: 'failed'/);
  assert.match(retrySection, /auditAttemptId: retryAttemptId/);
  assert.doesNotMatch(retrySection, /sendNinetyNineFoodOrderStatus/);
  assert.match(administrativeAuditWorkspaceSource, /Retry de reserva 99Food solicitado/);
  assert.match(administrativeAuditWorkspaceSource, /Retry de reserva 99Food concluído/);
  assert.match(administrativeAuditWorkspaceSource, /Retry de reserva 99Food falhou/);
});

test('future canonical store audit events are append-only server evidence, not browser claims', () => {
  const appendStart = administrativeAuditServiceSource.indexOf('export const appendStoreAdministrativeAuditEvent');
  const readStart = administrativeAuditServiceSource.indexOf('const resolveCanonicalStoreId', appendStart);
  assert.ok(appendStart >= 0 && readStart > appendStart);
  const appendSection = administrativeAuditServiceSource.slice(appendStart, readStart);
  assert.match(appendSection, /transaction\.create\(auditRef/);
  assert.match(appendSection, /FieldValue\.serverTimestamp\(\)/);
  assert.match(appendSection, /sourceKind/);
  assert.match(appendSection, /sourceRef/);
  assert.doesNotMatch(appendSection, /transaction\.(?:update|set)\(auditRef/);
  assert.doesNotMatch(administrativeAuditClientSource, /appendStoreAdministrativeAuditEvent|administrativeAudit\/.*(?:post|write)/i);
});

test('Gerencial team module reads only canonical memberships and does not invent mutation authority', () => {
  assert.match(gerencialPanelSource, /rh: 'Equipe & Permissões'/);
  assert.match(gerencialPanelSource, /title="Equipe & Permissões"/);
  assert.match(gerencialPanelSource, /<StoreTeamAccessWorkspace user=\{user\} storeId=\{user\.uid\}/);
  assert.match(teamAccessWorkspaceSource, /Somente leitura/);
  assert.match(teamAccessWorkspaceSource, /Nenhum papel adicional é criado/);
  assert.match(teamAccessWorkspaceSource, /Nenhuma membership canônica real foi encontrada/);
  assert.doesNotMatch(teamAccessWorkspaceSource, /method:\s*'(?:POST|PUT|PATCH|DELETE)'/);
});

test('team access API is owner-only GET and projects only the canonical membership vocabulary', () => {
  assert.match(onboardingRouterSource, /router\.get\('\/:storeId\/team-access'/);
  assert.match(onboardingRouterSource, /loadStoreTeamAccess\(/);
  assert.doesNotMatch(onboardingRouterSource, /router\.(?:post|put|patch|delete)\('\/:storeId\/team-access'/);
  assert.match(teamAccessServiceSource, /'owner'/);
  assert.match(teamAccessServiceSource, /'manager'/);
  assert.match(teamAccessServiceSource, /'cashier'/);
  assert.match(teamAccessServiceSource, /'seller'/);
  assert.match(teamAccessServiceSource, /'production'/);
  assert.doesNotMatch(teamAccessServiceSource, /'attendant'/);
  assert.match(teamAccessServiceSource, /'invited'/);
  assert.match(teamAccessServiceSource, /'active'/);
  assert.match(teamAccessServiceSource, /'suspended'/);
  assert.match(teamAccessServiceSource, /'removed'/);
  assert.match(teamAccessServiceSource, /collection\(`stores\/\$\{canonicalStoreId\}\/members`\)/);
  assert.match(teamAccessServiceSource, /userId !== document\.id/);
  assert.match(teamAccessServiceSource, /maskEmail/);
  assert.match(teamAccessServiceSource, /opaqueMemberRef/);
  assert.match(teamAccessServiceSource, /readAuthority: 'store_owner'/);
  assert.match(teamAccessServiceSource, /canonical_owner_membership_missing/);
  assert.doesNotMatch(teamAccessServiceSource, /\.set\(|\.update\(|\.delete\(|runTransaction/);
  assert.doesNotMatch(teamAccessClientSource, /method:\s*'(?:POST|PUT|PATCH|DELETE)'/);
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