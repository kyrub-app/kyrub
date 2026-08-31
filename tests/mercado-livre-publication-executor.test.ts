import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const servicePath = new URL('../server/integrations/mercadoLivreOutboundPublicationExecutionService.ts', import.meta.url);
const routerPath = new URL('../server/integrations/mercadoLivreRouter.ts', import.meta.url);

test('executor consumes owner authorization before the real provider publication call', async () => {
  const source = await readFile(servicePath, 'utf8');
  const reserveIndex = source.indexOf("consumptionStatus: 'executing'");
  const postIndex = source.indexOf("mercadoLivrePostJson<MercadoLivreCreatedItem>(storeId, '/items'");
  assert.ok(reserveIndex >= 0);
  assert.ok(postIndex > reserveIndex);
  assert.match(source, /useCount: 1/);
  assert.match(source, /consumedByExecutionId/);
});

test('executor verifies token hash, expiry, payload and full canonical baseline before publication', async () => {
  const source = await readFile(servicePath, 'utf8');
  assert.match(source, /timingSafeEqual/);
  assert.match(source, /authorization\.expiresAtMillis <= Date\.now\(\)/);
  assert.match(source, /payloadHash\(authorization\.payload\)/);
  assert.match(source, /canonicalHash\(canonicalDoc\.data\(\)\)/);
  assert.match(source, /canonicalBaselineHash/);
});

test('ambiguous provider result never retries and requires reconciliation', async () => {
  const source = await readFile(servicePath, 'utf8');
  assert.match(source, /reconciliation_required/);
  assert.match(source, /ambiguous_provider_result/);
  assert.match(source, /provider_success_without_item_id/);
  assert.doesNotMatch(source, /retry|RETRY|setTimeout/);
});

test('successful publication creates a durable external catalog binding only after external item id exists', async () => {
  const source = await readFile(servicePath, 'utf8');
  const externalIdIndex = source.indexOf('const externalItemId');
  const bindingIndex = source.indexOf('externalCatalogBindings/${bindingId}');
  assert.ok(externalIdIndex >= 0);
  assert.ok(bindingIndex > externalIdIndex);
  assert.match(source, /authority: 'store_owner_outbound_publication'/);
  assert.match(source, /externalItemId/);
  assert.match(source, /canonicalProductId/);
});

test('execution endpoint remains owner authenticated and requires the raw one-time token', async () => {
  const source = await readFile(routerPath, 'utf8');
  assert.match(source, /outbound-publication-authorizations\/:authorizationId\/execute/);
  assert.match(source, /authenticatedOwner/);
  assert.match(source, /authorizationToken:\s*clean\(request\.body\?\.authorizationToken\)/);
  assert.match(source, /executeAuthorizedMercadoLivrePublication/);
});
