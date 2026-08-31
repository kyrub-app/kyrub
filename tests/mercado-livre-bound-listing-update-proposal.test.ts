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

test('bound update proposal only proposes local name and price changes', async () => {
  const source = await readFile(servicePath, 'utf8');
  assert.match(source, /type UpdatableField = 'name' \| 'price'/);
  assert.match(source, /for \(const field of \['name', 'price'\] as UpdatableField\[\]\)/);
  assert.match(source, /proposedChanges\[field\] = current\[field\]/);
  assert.match(source, /protectedFields: \['stock', 'category', 'image', 'publicationStatus'\]/);
  assert.doesNotMatch(source, /proposedChanges\.stock|proposedChanges\.category|proposedChanges\.image/);
});

test('bound update proposal uses detailed binding baseline and permits local divergence', async () => {
  const source = await readFile(servicePath, 'utf8');
  assert.match(source, /externalCatalogBindingBaselines/);
  assert.match(source, /canonicalTargetHash/);
  assert.match(source, /localChanged = current\[field\] !== baseline\[field\]/);
  assert.doesNotMatch(source, /currentCanonicalHash !== binding\.canonicalBaselineHash/);
});

test('bound update proposal blocks same-field concurrent provider divergence', async () => {
  const source = await readFile(servicePath, 'utf8');
  assert.match(source, /providerChanged = observed\[field\] !== baseline\[field\]/);
  assert.match(source, /localChanged && providerChanged && current\[field\] !== observed\[field\]/);
  assert.match(source, /MERCADO_LIVRE_BOUND_LISTING_UPDATE_FIELD_CONFLICT/);
});

test('bound update proposal is deterministic over baseline, canonical target and provider observations', async () => {
  const source = await readFile(servicePath, 'utf8');
  assert.match(source, /providerObservedHash/);
  assert.match(source, /canonicalTargetHash/);
  assert.match(source, /binding\.canonicalBaselineHash/);
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
