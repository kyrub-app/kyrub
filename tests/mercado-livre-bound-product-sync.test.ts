import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('bound sync resolves deterministic external binding instead of matching title or sku', () => {
  const source = readFileSync('server/integrations/mercadoLivreBoundProductSyncService.ts', 'utf8');
  assert.match(source, /bindingIdFor/);
  assert.match(source, /\[storeId, 'mercado_livre', connectionId, externalItemId\]/);
  assert.match(source, /externalCatalogBindings/);
  assert.doesNotMatch(source, /where\('name'/);
  assert.doesNotMatch(source, /where\('sellerSku'/);
});

test('bound sync checks canonical baseline before any canonical mutation', () => {
  const source = readFileSync('server/integrations/mercadoLivreBoundProductSyncService.ts', 'utf8');
  const conflict = source.indexOf("throw new Error('MERCADO_LIVRE_BOUND_SYNC_BASELINE_CONFLICT')");
  const canonicalUpdate = source.indexOf('transaction.update(canonicalReference');
  assert.ok(conflict >= 0);
  assert.ok(canonicalUpdate > conflict);
  assert.match(source, /canonicalBaselineHash/);
  assert.match(source, /baselineStatus: currentHash\(product\) === binding\.canonicalBaselineHash \? 'clean' : 'conflict'/);
});

test('bound sync permits only name and price while preserving inventory category image and publication', () => {
  const source = readFileSync('server/integrations/mercadoLivreBoundProductSyncService.ts', 'utf8');
  const start = source.indexOf('transaction.update(canonicalReference');
  const end = source.indexOf('transaction.update(bindingReference', start);
  assert.ok(start >= 0 && end > start);
  const canonicalMutation = source.slice(start, end);
  assert.match(source, /Array<'name' \| 'price'>/);
  assert.match(canonicalMutation, /changedFields\.includes\('name'\)/);
  assert.match(canonicalMutation, /changedFields\.includes\('price'\)/);
  assert.doesNotMatch(canonicalMutation, /stock:/);
  assert.doesNotMatch(canonicalMutation, /category:/);
  assert.doesNotMatch(canonicalMutation, /publicationStatus:/);
  assert.doesNotMatch(canonicalMutation, /image:/);
  assert.match(source, /availableQuantity: snapshot\.item\.availableQuantity/);
  assert.match(source, /categoryId: snapshot\.item\.categoryId/);
});

test('successful bound sync records immutable before after audit and advances baseline atomically', () => {
  const source = readFileSync('server/integrations/mercadoLivreBoundProductSyncService.ts', 'utf8');
  assert.match(source, /catalogSyncApplications/);
  assert.match(source, /transaction\.create\(applicationReference/);
  assert.match(source, /before:/);
  assert.match(source, /after:/);
  assert.match(source, /sourceSnapshotId: snapshot\.id/);
  assert.match(source, /canonicalBaselineHash: nextBaselineHash/);
  assert.match(source, /canonicalApplyStatus: 'applied'/);
  assert.match(source, /store_owner_external_sync_review/);
});

test('bound sync routes are owner authenticated and explicit', () => {
  const source = readFileSync('server/integrations/mercadoLivreRouter.ts', 'utf8');
  assert.match(source, /\/:storeId\/bound-product-sync/);
  assert.match(source, /\/:storeId\/sync-proposals\/:proposalId\/apply-to-canonical/);
  assert.match(source, /listMercadoLivreBoundProductSyncQueue/);
  assert.match(source, /applyMercadoLivreSnapshotToBoundCanonicalProduct/);
  assert.match(source, /authenticatedOwner/);
});

test('merchant UI exposes conflict gate and states that stock category and publication are untouched', () => {
  const source = readFileSync('src/components/store/MercadoLivreSyncReviewQueue.tsx', 'utf8');
  assert.match(source, /Produto já vinculado/);
  assert.match(source, /baselineStatus === 'conflict'/);
  assert.match(source, /Conflito detectado/);
  assert.match(source, /somente nome e preço podem ser atualizados/);
  assert.match(source, /Estoque, categoria e publicação ficam fora da sincronização/);
  assert.match(source, /Aplicar nome\/preço/);
});
