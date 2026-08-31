import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const servicePath = new URL('../server/integrations/mercadoLivreBoundListingUpdateReconciliationService.ts', import.meta.url);
const routerPath = new URL('../server/integrations/mercadoLivreRouter.ts', import.meta.url);

test('reconciliation uses authoritative provider refetch and verifies identity', async () => {
  const source = await readFile(servicePath, 'utf8');
  assert.match(source, /mercadoLivreGetJson<unknown>/);
  assert.match(source, /sellerId !== externalAccountId/);
  assert.match(source, /externalId !== execution\.externalItemId/);
  assert.match(source, /authority: 'provider_api_refetch'/);
});

test('ambiguous update is recovered only when provider now matches authorized target', async () => {
  const source = await readFile(servicePath, 'utf8');
  assert.match(source, /providerMatchesAuthorizedTarget/);
  assert.match(source, /provider_target_not_observed/);
  assert.match(source, /status: 'reconciliation_required'/);
  assert.doesNotMatch(source, /mercadoLivrePutJson|method:\s*['"]PUT['"]|retry|RETRY/);
});

test('reconciliation advances only authorized name and price fields in baseline', async () => {
  const source = await readFile(servicePath, 'utf8');
  assert.match(source, /name: 'title' in payload \? target\.name : previous\.name/);
  assert.match(source, /price: 'price' in payload \? target\.price : previous\.price/);
  assert.match(source, /stock: previous\.stock/);
  assert.match(source, /category: previous\.category/);
  assert.match(source, /image: previous\.image/);
  assert.match(source, /protectedBaselineFieldsPreserved: \['stock', 'category', 'image'\]/);
});

test('canonical product must still equal the authorized target before baseline advancement', async () => {
  const source = await readFile(servicePath, 'utf8');
  assert.match(source, /baselineHash\(target\) !== currentExecution\.canonicalTargetHash/);
  assert.match(source, /MERCADO_LIVRE_BOUND_LISTING_UPDATE_RECONCILIATION_STALE/);
});

test('reconciliation writes provider snapshot, detailed baseline and immutable audit', async () => {
  const source = await readFile(servicePath, 'utf8');
  assert.match(source, /externalCatalogSnapshots/);
  assert.match(source, /externalCatalogBindingBaselines/);
  assert.match(source, /catalogOutboundUpdateReconciliations/);
  assert.match(source, /provider_api_refetch_outbound_update/);
  assert.match(source, /canonicalBaselineHash: advancedBaselineHash/);
});

test('reconciliation remains manual-review and never changes inventory or canonical product', async () => {
  const source = await readFile(servicePath, 'utf8');
  assert.match(source, /connection\.syncAuthority !== 'manual_review'/);
  assert.doesNotMatch(source, /transaction\.update\(canonicalRef/);
  assert.doesNotMatch(source, /availableQuantity.*transaction\.update/);
});

test('owner-authenticated route exposes update reconciliation', async () => {
  const source = await readFile(routerPath, 'utf8');
  assert.match(source, /outbound-update-executions\/:executionId\/reconcile/);
  assert.match(source, /reconcileMercadoLivreBoundListingUpdate/);
  assert.match(source, /authenticatedOwner/);
});
