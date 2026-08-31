import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('Mercado Livre imports prepare existing Kyrub catalog drafts without inventing stock or category', () => {
  const source = readFileSync('server/integrations/mercadoLivreCatalogDraftPromotionService.ts', 'utf8');
  assert.match(source, /kyrub_catalog_drafts\/\$\{storeId\}\/drafts/);
  assert.match(source, /kind: 'mercado_livre'/);
  assert.match(source, /field: 'category'/);
  assert.match(source, /field: 'stock'/);
  assert.match(source, /sourceAvailableQuantity/);
  assert.doesNotMatch(source, /product\.stock\s*=/);
  assert.doesNotMatch(source, /category:\s*draft\.categoryId/);
  assert.doesNotMatch(source, /publicProducts/);
  assert.doesNotMatch(source, /publicationStatus:\s*'published'/);
});

test('preparation preserves provider identity and version provenance', () => {
  const source = readFileSync('server/integrations/mercadoLivreCatalogDraftPromotionService.ts', 'utf8');
  assert.match(source, /connectionId: draft\.provenance\.connectionId/);
  assert.match(source, /externalItemId: draft\.provenance\.externalId/);
  assert.match(source, /importDraftUpdatedAt: draft\.updatedAt/);
  assert.match(source, /lastSyncedAt: draft\.provenance\.lastSyncedAt/);
  assert.match(source, /preparationAuthority: 'store_owner_import_review'/);
  assert.match(source, /deterministicPreparationDraftId/);
});

test('preparation routes are owner authenticated and explicit', () => {
  const source = readFileSync('server/integrations/mercadoLivreRouter.ts', 'utf8');
  assert.match(source, /\/:storeId\/catalog-import-drafts'/);
  assert.match(source, /\/:storeId\/catalog-import-drafts\/:draftId\/prepare-kyrub-draft/);
  assert.match(source, /authenticatedOwner/);
  assert.match(source, /prepareMercadoLivreImportAsKyrubCatalogDraft/);
});

test('merchant workspace explains category and stock authority boundary', () => {
  const workspace = readFileSync('src/components/store/StoreConnectionsWorkspace.tsx', 'utf8');
  const queue = readFileSync('src/components/store/MercadoLivreImportDraftQueue.tsx', 'utf8');
  assert.match(workspace, /MercadoLivreImportDraftQueue/);
  assert.match(queue, /Rascunhos importados do Mercado Livre/);
  assert.match(queue, /não viram categoria ou estoque Kyrub automaticamente/);
  assert.match(queue, /Preparar rascunho Kyrub/);
  assert.match(queue, /nenhum produto foi publicado/);
});

test('shared draft source contract records Mercado Livre explicitly', () => {
  const source = readFileSync('shared/kyrubCatalogDrafts.ts', 'utf8');
  assert.match(source, /\| 'mercado_livre'/);
});
