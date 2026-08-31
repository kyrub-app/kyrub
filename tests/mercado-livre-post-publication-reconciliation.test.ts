import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const servicePath = new URL('../server/integrations/mercadoLivrePostPublicationReconciliationService.ts', import.meta.url);
const routerPath = new URL('../server/integrations/mercadoLivreRouter.ts', import.meta.url);

test('post-publication reconciliation re-fetches the exact Mercado Livre item and verifies seller identity', async () => {
  const source = await readFile(servicePath, 'utf8');
  assert.match(source, /mercadoLivreGetJson/);
  assert.match(source, /\/items\/\$\{encodeURIComponent\(execution\.externalItemId\)\}/);
  assert.match(source, /sellerId !== externalAccountId/);
  assert.match(source, /MERCADO_LIVRE_POST_PUBLICATION_IDENTITY_MISMATCH/);
});

test('initial provider snapshot uses the same authoritative inbound snapshot collection', async () => {
  const source = await readFile(servicePath, 'utf8');
  assert.match(source, /externalCatalogSnapshots/);
  assert.match(source, /authority: 'provider_api_refetch'/);
  assert.match(source, /sourceExecutionId: executionId/);
  assert.doesNotMatch(source, /catalogSyncProposals\/\$\{snapshotId\}/);
});

test('outbound binding is normalized to the inbound canonical baseline contract', async () => {
  const source = await readFile(servicePath, 'utf8');
  assert.match(source, /syncBaselineHash/);
  assert.match(source, /isService: false/);
  assert.match(source, /canonicalBaselineHash: inboundBaselineHash/);
  assert.match(source, /externalCatalogBindingBaselines/);
  assert.match(source, /authority: 'post_publication_canonical_snapshot'/);
});

test('reconciliation is idempotent and leaves automatic sync disabled', async () => {
  const source = await readFile(servicePath, 'utf8');
  assert.match(source, /catalogOutboundPublicationReconciliations/);
  assert.match(source, /alreadyReconciled: true/);
  assert.match(source, /connection\.syncAuthority !== 'manual_review'/);
  assert.doesNotMatch(source, /kyrub_to_external|bidirectional/);
});

test('owner-authenticated reconciliation route is separate from publication execution', async () => {
  const source = await readFile(routerPath, 'utf8');
  assert.match(source, /outbound-publication-executions\/:executionId\/reconcile/);
  assert.match(source, /reconcileMercadoLivrePublishedItem/);
  assert.match(source, /authenticatedOwner/);
});
