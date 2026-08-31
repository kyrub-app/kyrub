import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const servicePath = new URL('../server/integrations/mercadoLivreBoundListingUpdateProposalService.ts', import.meta.url);
const routerPath = new URL('../server/integrations/mercadoLivreRouter.ts', import.meta.url);

test('bound update proposal re-fetches provider item and verifies seller identity', async () => {
  const source = await readFile(servicePath, 'utf8');
  assert.match(source, /mercadoLivreGetJson<unknown>/);
  assert.match(source, /sellerId !== externalAccountId/);
  assert.match(source, /id !== binding\.externalItemId/);
  assert.match(source, /canonical_kyrub_and_provider_api_refetch/);
});

test('bound update proposal only proposes name and price', async () => {
  const source = await readFile(servicePath, 'utf8');
  assert.match(source, /type UpdatableField = 'name' \| 'price'/);
  assert.match(source, /proposedChanges\.name = canonical\.name/);
  assert.match(source, /proposedChanges\.price = canonical\.price/);
  assert.match(source, /protectedFields: \['stock', 'category', 'image', 'publicationStatus'\]/);
  assert.doesNotMatch(source, /proposedChanges\.stock|proposedChanges\.category|proposedChanges\.image/);
});

test('bound update proposal refuses local baseline divergence', async () => {
  const source = await readFile(servicePath, 'utf8');
  assert.match(source, /currentCanonicalHash !== binding\.canonicalBaselineHash/);
  assert.match(source, /MERCADO_LIVRE_BOUND_LISTING_UPDATE_BASELINE_CONFLICT/);
});

test('bound update proposal is deterministic over canonical and provider observations', async () => {
  const source = await readFile(servicePath, 'utf8');
  assert.match(source, /providerObservedHash/);
  assert.match(source, /currentCanonicalHash/);
  assert.match(source, /mlupd_/);
  assert.match(source, /executionStatus: 'not_authorized'/);
});

test('owner-authenticated routes expose creation and review queue without provider write', async () => {
  const service = await readFile(servicePath, 'utf8');
  const router = await readFile(routerPath, 'utf8');
  assert.match(router, /outbound-update-proposals/);
  assert.match(router, /external-catalog-bindings\/:bindingId\/update-proposals/);
  assert.match(router, /proposeMercadoLivreBoundListingUpdate/);
  assert.match(router, /authenticatedOwner/);
  assert.doesNotMatch(service, /mercadoLivrePutJson|method:\s*'PUT'|\/items\/.+PUT/);
});
