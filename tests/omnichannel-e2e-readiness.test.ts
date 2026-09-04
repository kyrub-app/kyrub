import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const readinessSource = readFileSync(
  'src/utils/omnichannelE2EReadiness.ts',
  'utf8'
);
const panelSource = readFileSync(
  'src/components/store/OmnichannelE2EReadinessPanel.tsx',
  'utf8'
);
const portalSource = readFileSync(
  'src/components/store/StoreConnectionsPortalBridge.tsx',
  'utf8'
);

test('omnichannel E2E readiness aggregates existing authoritative read models only', () => {
  assert.match(readinessSource, /Promise\.allSettled\(\[/);
  assert.match(readinessSource, /loadStoreConnectionOnboarding\(user, storeId\)/);
  assert.match(readinessSource, /loadStoreInventoryAuthorityHealth\(user, storeId\)/);
  assert.match(readinessSource, /getNinetyNineFoodConnectionStatus\(\)/);
  assert.match(readinessSource, /loadStoreChannelOperationalQueue\(user, storeId\)/);
  assert.match(readinessSource, /loadNinetyNineFoodPendingStatusSyncs\(user\)/);
  assert.match(readinessSource, /loadNinetyNineFoodStatusSyncReconciliationItems\(user\)/);
});

test('E2E readiness is owner-scoped and never turns missing data into a ready conclusion', () => {
  assert.match(readinessSource, /user\.uid !== storeId/);
  assert.match(readinessSource, /sourceErrors/);
  assert.match(readinessSource, /hasUnknown \|\| normalizedSourceErrors\.length > 0/);
  assert.match(readinessSource, /\? 'partial'/);
  assert.match(readinessSource, /A fila está parcial/);
  assert.match(readinessSource, /ausência de itens não pode ser interpretada como ausência de pendências/);
});

test('full-cycle readiness checks inventory authority and both provider connections explicitly', () => {
  assert.match(readinessSource, /authority\.state === 'resolved'/);
  assert.match(readinessSource, /connection\.channel === 'mercado_livre'/);
  assert.match(readinessSource, /connection\.channel === '99food'/);
  assert.match(readinessSource, /ninetyNineFoodStatus\?\.status === 'connected'/);
  assert.match(readinessSource, /ninetyNineFoodAdapterConnected && ninetyNineFoodRegistryConnected/);
  assert.match(readinessSource, /Há divergência entre adapter/);
});

test('pre-existing operational, manual-sync and reconciliation evidence becomes attention instead of being hidden', () => {
  assert.match(readinessSource, /operationalItems\.length > 0/);
  assert.match(readinessSource, /pendingStatusSyncs\.length > 0/);
  assert.match(readinessSource, /reconciliations\.length > 0/);
  assert.match(readinessSource, /podem contaminar a leitura de um novo teste/);
  assert.match(readinessSource, /aguardam decisão explícita/);
  assert.match(readinessSource, /exigem leitura\/reconciliação/);
});

test('readiness projection contains no write, retry, authorization or provider execution path', () => {
  assert.doesNotMatch(
    readinessSource,
    /authorizeMercadoLivre|executeMercadoLivre|proposeMercadoLivre|retryNinetyNineFood|sendNinetyNineFood|reconcileNinetyNineFoodStatusSyncExecution|adjust_inventory|setDoc|updateDoc|\.post\(|method:\s*'POST'/i
  );
  assert.doesNotMatch(
    readinessSource,
    /setInterval|setTimeout|schedule|enqueue.*retry/i
  );
});

test('readiness panel refreshes the snapshot and navigation buttons only scroll to existing provider benches', () => {
  assert.match(panelSource, /loadOmnichannelE2EReadiness\(user, storeId\)/);
  assert.match(panelSource, /id="kyrub-refresh-omnichannel-e2e-readiness"/);
  assert.match(panelSource, /id="kyrub-open-mercado-livre-e2e-bench"/);
  assert.match(panelSource, /scrollTo\('kyrub-mercado-livre-channel-detail'\)/);
  assert.match(panelSource, /id="kyrub-open-99food-e2e-bench"/);
  assert.match(panelSource, /scrollTo\('kyrub-99food-channel-detail'\)/);
  assert.match(panelSource, /não cria anúncio, não altera estoque, não reserva pedido, não muda status e não envia nada/);
  assert.doesNotMatch(
    panelSource,
    /executeMercadoLivre|authorizeMercadoLivre|retryNinetyNineFood|sendNinetyNineFood|reconcileNinetyNineFoodStatusSyncExecution|\bfetch\(|setInterval|setTimeout/i
  );
});

test('store portal mounts readiness before the provider-specific E2E benches without replacing them', () => {
  const readinessIndex = portalSource.indexOf('<OmnichannelE2EReadinessPanel');
  const mercadoLivreIndex = portalSource.indexOf('<MercadoLivreE2ETestBridge');
  const ninetyNineFoodIndex = portalSource.indexOf('<NinetyNineFoodE2ETestBridge');
  assert.match(portalSource, /import OmnichannelE2EReadinessPanel/);
  assert.ok(readinessIndex >= 0);
  assert.ok(mercadoLivreIndex > readinessIndex);
  assert.ok(ninetyNineFoodIndex > readinessIndex);
  assert.doesNotMatch(
    portalSource.slice(readinessIndex, portalSource.indexOf('<StoreInventoryAuthorityRepairPanel', readinessIndex)),
    /execute|authorize|retry|provider write/i
  );
});
