import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('canonical Mercado Livre product binding is deterministic and tenant scoped', () => {
  const source = readFileSync('server/integrations/mercadoLivreCatalogDraftPromotionService.ts', 'utf8');
  assert.match(source, /externalIdentityHash/);
  assert.match(source, /draft\.provenance\.connectionId/);
  assert.match(source, /draft\.provenance\.externalId/);
  assert.match(source, /externalCatalogBindings/);
  assert.match(source, /canonicalProductId/);
  assert.match(source, /MERCADO_LIVRE_EXTERNAL_BINDING_CONFLICT/);
});

test('canonical product and external binding are written in the same Firestore transaction', () => {
  const source = readFileSync('server/integrations/mercadoLivreCatalogDraftPromotionService.ts', 'utf8');
  assert.match(source, /adminDb\.runTransaction/);
  assert.match(source, /transaction\.set\(canonicalReference/);
  assert.match(source, /transaction\.set\(bindingReference/);
  assert.match(source, /promotionAuthority: 'store_owner_import_confirmation'/);
  assert.match(source, /authority: 'store_owner_import_confirmation'/);
});

test('new canonical product remains unpublished and uses merchant Kyrub stock and category', () => {
  const source = readFileSync('server/integrations/mercadoLivreCatalogDraftPromotionService.ts', 'utf8');
  assert.match(source, /publicationStatus: 'draft'/);
  assert.match(source, /const category = clean\(input\.kyrubCategory/);
  assert.match(source, /const stock = integerNonNegative\(input\.kyrubStock\)/);
  assert.match(source, /category,/);
  assert.match(source, /stock,/);
  assert.doesNotMatch(source, /stock:\s*draft\.sourceAvailableQuantity/);
  assert.doesNotMatch(source, /category:\s*draft\.categoryId/);
});

test('prepared import must still match the current Mercado Livre draft before canonical creation', () => {
  const source = readFileSync('server/integrations/mercadoLivreCatalogDraftPromotionService.ts', 'utf8');
  assert.match(source, /externalSource\.importDraftUpdatedAt/);
  assert.match(source, /importDraft\.updatedAt/);
  assert.match(source, /MERCADO_LIVRE_IMPORT_PREPARATION_STALE/);
});

test('owner route requires explicit category and stock payload and does not publish', () => {
  const router = readFileSync('server/integrations/mercadoLivreRouter.ts', 'utf8');
  assert.match(router, /create-kyrub-product/);
  assert.match(router, /authenticatedOwner/);
  assert.match(router, /kyrubCategory:\s*request\.body\?\.category/);
  assert.match(router, /kyrubStock:\s*request\.body\?\.stock/);
  assert.doesNotMatch(router, /setAuthorizedKyrubCatalogProductPublication/);
});

test('merchant UI asks for Kyrub category and initial stock before product creation', () => {
  const source = readFileSync('src/components/store/MercadoLivreImportDraftQueue.tsx', 'utf8');
  assert.match(source, /Categoria Kyrub/);
  assert.match(source, /Estoque inicial Kyrub/);
  assert.match(source, /Criar produto Kyrub em rascunho/);
  assert.match(source, /Nada foi publicado automaticamente/);
});
