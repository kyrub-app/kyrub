import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const servicePath = new URL('../server/integrations/mercadoLivreOutboundPublicationService.ts', import.meta.url);
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
  assert.match(source, /proposalIdFor\(storeId, connectionId, canonicalStoreId, canonicalProductId, baselineHash\)/);
});

test('outbound proposal routes remain owner authenticated and do not publish', async () => {
  const source = await readFile(routerPath, 'utf8');
  assert.match(source, /outbound-publication-proposals/);
  assert.match(source, /authenticatedOwner/);
  assert.match(source, /proposeMercadoLivreExternalPublication/);
  assert.doesNotMatch(source, /publishMercadoLivre|createMercadoLivreListing/);
});
