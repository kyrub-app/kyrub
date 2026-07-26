import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const inventorySource = readFileSync(
  'src/components/store/ProductInventoryWorkspace.tsx',
  'utf8'
);
const retailerSource = readFileSync('src/components/RetailerPanel.tsx', 'utf8');
const editorAdapterSource = readFileSync(
  'src/components/store/ProductEditorModal.tsx',
  'utf8'
);
const unifiedModalSource = readFileSync(
  'src/components/store/UnifiedProductModal.tsx',
  'utf8'
);
const createBridgeSource = readFileSync(
  'src/components/store/UnifiedProductCreateModalBridge.tsx',
  'utf8'
);
const hierarchySource = readFileSync(
  'src/components/store/CatalogHierarchySelector.tsx',
  'utf8'
);
const quickNotesSource = readFileSync(
  'src/components/store/ProductQuickNotesEditor.tsx',
  'utf8'
);
const optionGroupsSource = readFileSync(
  'src/components/store/ProductOptionGroupsEditor.tsx',
  'utf8'
);
const mutationSource = readFileSync(
  'src/utils/publicProductMutations.ts',
  'utf8'
);
const appSource = readFileSync('src/App.tsx', 'utf8');

test('product cards expose edit and delete actions', () => {
  assert.match(inventorySource, /onEditProduct/);
  assert.match(inventorySource, /onDeleteProduct/);
  assert.match(inventorySource, /Editar \$\{product\.name\}/);
  assert.match(inventorySource, /Excluir \$\{product\.name\}/);
  assert.match(inventorySource, /<Pencil/);
  assert.match(inventorySource, /<Trash2/);
});

test('new and edited items open the same unified product modal', () => {
  assert.match(inventorySource, /requestProductCreateModal\(products, keywords\)/);
  assert.match(inventorySource, /open-unified-product-create-modal/);
  assert.match(createBridgeSource, /<ProductEditorModal/);
  assert.match(createBridgeSource, /mode="create"/);
  assert.match(editorAdapterSource, /<UnifiedProductModal/);
  assert.match(retailerSource, /<ProductEditorModal/);
  assert.match(appSource, /<UnifiedProductCreateModalBridge/);
  assert.doesNotMatch(appSource, /<ProductCreationEnhancementBridge/);
});

test('retailer catalog persists edits and confirms deletion', () => {
  assert.match(retailerSource, /handleSaveProduct/);
  assert.match(retailerSource, /persistPublicProduct\(user, updatedProduct\)/);
  assert.match(retailerSource, /handleConfirmDeleteProduct/);
  assert.match(retailerSource, /removePublicProduct\(user, product\.id\)/);
  assert.match(retailerSource, /confirm-delete-product-button/);
  assert.match(retailerSource, /Pedidos antigos continuarão preservando/);
});

test('the unified modal keeps media, hierarchy, quick notes and personalization', () => {
  assert.match(unifiedModalSource, /CatalogHierarchySelector/);
  assert.match(unifiedModalSource, /ProductQuickNotesEditor/);
  assert.match(unifiedModalSource, /ProductOptionGroupsEditor/);
  assert.match(unifiedModalSource, /GooglePhotosImagePickerButton/);
  assert.match(unifiedModalSource, /GoogleDriveImagePickerButton/);
  assert.match(unifiedModalSource, /id="unified-product-modal"/);
  assert.match(hierarchySource, /Categorias e grupos/);
  assert.match(quickNotesSource, /Botões rápidos de observação/);
  assert.match(optionGroupsSource, /Personalização, etapas e múltiplas escolhas/);
});

test('product deletion removes only the authenticated store item', () => {
  assert.match(mutationSource, /product\.storeId !== user\.uid/);
  assert.match(mutationSource, /product\.supplierId !== user\.uid/);
  assert.match(mutationSource, /currentProducts\.filter/);
  assert.match(mutationSource, /updatedAt: serverTimestamp\(\)/);
});
