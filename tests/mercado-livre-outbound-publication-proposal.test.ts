import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const servicePath = new URL('../server/integrations/mercadoLivreOutboundPublicationService.ts', import.meta.url);
const capabilityPath = new URL('../server/integrations/mercadoLivrePublicationCapabilityService.ts', import.meta.url);
const routerPath = new URL('../server/integrations/mercadoLivreRouter.ts', import.meta.url);

test('outbound publication starts as a non-executable owner-reviewed proposal', async () => {
  const source = await readFile(servicePath, 'utf8');
  assert.match(source, /status: 'review_required'/);
  assert.match(source, /authority: 'canonical_kyrub_snapshot'/);
  assert.match(source, /action: 'create_external_listing'/);
  assert.match(source, /executionStatus: 'not_authorized'/);
  assert.match(source, /syncAuthority !== 'manual_review'/);
  assert.match(source, /canonicalBaselineHash/);
  assert.match(source, /mercado_livre_category_id/);
  assert.match(source, /listing_type_id/);
  assert.match(source, /required_attributes/);
  assert.doesNotMatch(source, /mercadoLivrePostJson|\/items['"`]/);
});

test('outbound proposal resolves the canonical store instead of assuming owner store identity', async () => {
  const source = await readFile(servicePath, 'utf8');
  assert.match(source, /users\/\$\{storeId\}\/stores\/\$\{storeId\}/);
  assert.match(source, /canonicalStoreId/);
  assert.match(source, /stores\/\$\{canonicalStoreId\}\/products\/\$\{canonicalProductId\}/);
  assert.doesNotMatch(source, /stores\/\$\{storeId\}\/products\/\$\{canonicalProductId\}/);
  assert.match(source, /proposalIdFor\(/);
  assert.match(source, /baselineHash,/);
  assert.match(source, /providerCapabilitySnapshot\.fingerprint/);
});

test('proposal freezes the provider-owned publication model before any external write can be authorized', async () => {
  const source = await readFile(servicePath, 'utf8');
  assert.match(source, /inspectMercadoLivrePublicationCapability/);
  assert.match(source, /freezeMercadoLivrePublicationCapability/);
  assert.match(source, /readiness !== 'ready_current_adapter'/);
  assert.match(source, /MERCADO_LIVRE_OUTBOUND_PUBLICATION_ADAPTER_MIGRATION_REQUIRED/);
  assert.match(source, /publicationModel !== 'legacy_items'/);
  assert.match(source, /stockAuthority !== 'item_available_quantity'/);
  assert.match(source, /schemaVersion: 2/);
  assert.match(source, /providerCapabilityFingerprint/);
  assert.match(source, /providerPublicationModel/);
  assert.match(source, /providerStockAuthority/);
  assert.match(source, /providerCapability: providerCapabilitySnapshot/);
});

test('capability fingerprint is based only on material seller publication and stock authority', async () => {
  const source = await readFile(capabilityPath, 'utf8');
  assert.match(source, /materialCapabilityState/);
  assert.match(source, /mercadoLivrePublicationCapabilityFingerprint/);
  assert.match(source, /freezeMercadoLivrePublicationCapability/);
  assert.match(source, /externalAccountId: capability\.externalAccountId/);
  assert.match(source, /publicationModel: capability\.publicationModel/);
  assert.match(source, /stockAuthority: capability\.stockAuthority/);
  assert.match(source, /warehouseMode: capability\.warehouseMode/);
  const materialState = source.slice(
    source.indexOf('const materialCapabilityState'),
    source.indexOf('export const mercadoLivrePublicationCapabilityFingerprint')
  );
  assert.doesNotMatch(materialState, /observedAt|nickname|observedTags/);
});

test('outbound proposal routes remain owner authenticated and do not publish', async () => {
  const source = await readFile(routerPath, 'utf8');
  assert.match(source, /outbound-publication-proposals/);
  assert.match(source, /authenticatedOwner/);
  assert.match(source, /proposeMercadoLivreExternalPublication/);
  assert.doesNotMatch(source, /publishMercadoLivre|createMercadoLivreListing/);
});
