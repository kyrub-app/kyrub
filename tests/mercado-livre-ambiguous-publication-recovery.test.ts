import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const validationPath = new URL('../server/integrations/mercadoLivreOutboundListingValidationService.ts', import.meta.url);
const payloadAdapterPath = new URL('../server/integrations/mercadoLivreInitialPublicationPayloadAdapter.ts', import.meta.url);
const recoveryPath = new URL('../server/integrations/mercadoLivreAmbiguousPublicationRecoveryService.ts', import.meta.url);
const reconciliationPath = new URL('../server/integrations/mercadoLivrePostPublicationReconciliationService.ts', import.meta.url);

test('validated outbound payload carries a deterministic searchable provider correlation marker through the shared adapter', async () => {
  const source = await readFile(validationPath, 'utf8');
  const adapter = await readFile(payloadAdapterPath, 'utf8');
  assert.match(source, /mercadoLivrePublicationCorrelationMarker\(storeId, proposalId\)/);
  assert.match(source, /sellerCustomField: publicationCorrelationMarker/);
  assert.match(adapter, /seller_custom_field: clean\(input\.sellerCustomField, 120\)/);
  const markerIndex = source.indexOf('sellerCustomField: publicationCorrelationMarker');
  const validateIndex = source.indexOf("mercadoLivreValidateJson(storeId, '/items/validate', itemPayload)");
  assert.ok(markerIndex >= 0 && validateIndex > markerIndex);
});

test('ambiguous recovery searches seller items by exact seller_custom_field and never republishes', async () => {
  const source = await readFile(recoveryPath, 'utf8');
  assert.match(source, /items\/search\?sku=/);
  assert.match(source, /seller_custom_field/);
  assert.match(source, /seller_id/);
  assert.match(source, /candidates\.length === 0/);
  assert.match(source, /candidates\.length !== 1/);
  assert.doesNotMatch(source, /mercadoLivrePostJson/);
  assert.doesNotMatch(source, /'\/items'/);
});

test('only one identity-verified candidate can restore published state and durable binding', async () => {
  const source = await readFile(recoveryPath, 'utf8');
  assert.match(source, /sellerCustomField !== marker/);
  assert.match(source, /sellerId !== externalAccountId/);
  assert.match(source, /externalCatalogBindings\/\$\{bindingId\}/);
  assert.match(source, /authority: 'provider_search_recovered_owner_publication'/);
  assert.match(source, /status: 'published'/);
  assert.match(source, /recovered_from_provider_search/);
  assert.match(source, /catalogOutboundPublicationRecoveries/);
});

test('post-publication reconciliation recovers ambiguous execution first and then uses normal baseline flow', async () => {
  const source = await readFile(reconciliationPath, 'utf8');
  const recoveryIndex = source.indexOf('recoverAmbiguousMercadoLivrePublication({');
  const assertPublishedIndex = source.indexOf('const execution = assertExecution');
  assert.ok(recoveryIndex >= 0 && assertPublishedIndex > recoveryIndex);
  assert.match(source, /recoveredFromAmbiguousExecution/);
  assert.match(source, /externalCatalogBindingBaselines/);
  assert.match(source, /externalCatalogSnapshots/);
});
