import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const servicePath = new URL('../server/integrations/mercadoLivrePostPublicationSyncInspectionService.ts', import.meta.url);
const commandPath = new URL('../server/ai/kyrubiaMercadoLivrePublicationExecutionCommand.ts', import.meta.url);

test('post-publication sync inspection is read-only against Mercado Livre and persists manual-review evidence', async () => {
  const source = await readFile(servicePath, 'utf8');
  assert.match(source, /mercadoLivreGetJson/);
  assert.doesNotMatch(source, /mercadoLivrePostJson|mercadoLivrePutJson|mercadoLivreDeleteJson/);
  assert.match(source, /catalogOutboundSyncInspections/);
  assert.match(source, /syncAuthority: 'manual_review'/);
  assert.match(source, /authority: 'canonical_baseline_plus_provider_api_readback'/);
});

test('sync inspection compares the canonical reconciliation baseline and exact provider baseline', async () => {
  const source = await readFile(servicePath, 'utf8');
  assert.match(source, /externalCatalogBindingBaselines/);
  assert.match(source, /externalCatalogSnapshots/);
  assert.match(source, /__initial_snapshot/);
  assert.match(source, /post_publication_canonical_snapshot/);
  assert.match(source, /provider_api_refetch/);
  assert.match(source, /seller_id/);
  assert.match(source, /externalAccountId/);
  assert.match(source, /user_product_id/);
});

test('sync inspection classifies one-sided change, clean state and bilateral conflict without choosing a winner', async () => {
  const source = await readFile(servicePath, 'utf8');
  assert.match(source, /'in_sync'/);
  assert.match(source, /'canonical_changed'/);
  assert.match(source, /'provider_changed'/);
  assert.match(source, /'conflict'/);
  assert.match(source, /canonicalFields\.has\('price'\)/);
  assert.match(source, /canonicalFields\.has\('stock'\)/);
  assert.match(source, /providerFields\.has\('available_quantity'\)/);
  assert.match(source, /canonicalFields\.has\('name'\)/);
  assert.match(source, /providerFields\.has\('title'\)/);
});

test('provider lifecycle status is observed but excluded from sync drift decisions', async () => {
  const source = await readFile(servicePath, 'utf8');
  assert.match(source, /status: clean\(source\.status, 80\)/);
  assert.match(source, /providerStatus: currentProvider\.status/);
  assert.doesNotMatch(source, /changes\.push\(\{ field: 'status'/);
});

test('Cairubia exposes explicit sync inspection and never presents inspection as automatic synchronization', async () => {
  const source = await readFile(commandPath, 'utf8');
  assert.match(source, /isExplicitPostPublicationSyncInspectionCommand/);
  assert.match(source, /Verificar sincronização/);
  assert.match(source, /inspectMercadoLivrePostPublicationSync/);
  assert.match(source, /autoridade de sincronização permanece manual_review/i);
  assert.match(source, /não escolheu vencedor/i);
  assert.match(source, /nenhuma escrita foi enviada ao Mercado Livre/i);
});
