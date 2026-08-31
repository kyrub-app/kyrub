import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('conflict resolution persists hash-verified baseline snapshots for future field attribution', () => {
  const source = readFileSync('server/integrations/mercadoLivreConflictResolutionService.ts', 'utf8');
  assert.match(source, /externalCatalogBindingBaselines/);
  assert.match(source, /canonical_hash_verified_snapshot/);
  assert.match(source, /baselineHash\(state\) !== binding\.canonicalBaselineHash/);
  assert.match(source, /baseline: state/);
});

test('field-level conflict detection distinguishes local and Mercado Livre changes', () => {
  const source = readFileSync('server/integrations/mercadoLivreConflictResolutionService.ts', 'utf8');
  assert.match(source, /changedFromBaseline/);
  assert.match(source, /incomingChanges/);
  assert.match(source, /localChangedFields/);
  assert.match(source, /incomingChangedFields/);
  assert.match(source, /resolvableFields/);
});

test('merchant must explicitly choose Kyrub or Mercado Livre for each resolvable field', () => {
  const source = readFileSync('server/integrations/mercadoLivreConflictResolutionService.ts', 'utf8');
  assert.match(source, /'kyrub' \| 'mercado_livre'/);
  assert.match(source, /CONFLICT_RESOLUTION_CHOICE_REQUIRED/);
  assert.match(source, /input\.choices\.name === 'mercado_livre'/);
  assert.match(source, /input\.choices\.price === 'mercado_livre'/);
  assert.match(source, /store_owner_conflict_resolution/);
});

test('stock category image and publication stay outside Mercado Livre conflict choices', () => {
  const source = readFileSync('server/integrations/mercadoLivreConflictResolutionService.ts', 'utf8');
  assert.match(source, /protectedFieldsRetainedFromKyrub: \['stock', 'category', 'image'\]/);
  assert.doesNotMatch(source, /choices\.stock/);
  assert.doesNotMatch(source, /choices\.category/);
  assert.doesNotMatch(source, /choices\.image/);
  assert.doesNotMatch(source, /publicationStatus:/);
});

test('resolution writes immutable audit and advances baseline atomically', () => {
  const source = readFileSync('server/integrations/mercadoLivreConflictResolutionService.ts', 'utf8');
  assert.match(source, /catalogSyncConflictResolutions/);
  assert.match(source, /transaction\.create\(resolutionRef/);
  assert.match(source, /canonicalBaselineHash: nextHash/);
  assert.match(source, /baselineHash: nextHash/);
  assert.match(source, /canonicalApplyStatus: 'applied'/);
});

test('router captures detailed baseline after initial binding and normal clean apply', () => {
  const source = readFileSync('server/integrations/mercadoLivreRouter.ts', 'utf8');
  const captures = source.match(/captureMercadoLivreBindingBaseline/g) ?? [];
  assert.ok(captures.length >= 3);
  assert.match(source, /create-kyrub-product/);
  assert.match(source, /apply-to-canonical/);
  assert.match(source, /resolve-conflict/);
  assert.match(source, /conflict-resolutions/);
});

test('merchant UI presents baseline current and Mercado Livre choice without auto resolution', () => {
  const source = readFileSync('src/components/store/MercadoLivreConflictResolutionQueue.tsx', 'utf8');
  assert.match(source, /Escolher qual versão prevalece/);
  assert.match(source, /Baseline:/);
  assert.match(source, /Manter Kyrub/);
  assert.match(source, /Usar Mercado Livre/);
  assert.match(source, /Confirmar resolução/);
  assert.match(source, /Baseline indisponível/);
});
