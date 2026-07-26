import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const inventorySource = readFileSync(
  'src/components/store/ProductInventoryWorkspace.tsx',
  'utf8'
);
const retailerSource = readFileSync('src/components/RetailerPanel.tsx', 'utf8');
const editorSource = readFileSync(
  'src/components/store/ProductEditorModal.tsx',
  'utf8'
);
const creationBridgeSource = readFileSync(
  'src/components/store/ProductCreationEnhancementBridge.tsx',
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
  assert.match(inventorySource, /aria-label={`Editar/);
  assert.match(inventorySource, /aria-label={`Excluir/);
  assert.match(inventorySource, /<Pencil/);
  assert.match(inventorySource, /<Trash2/);
});

test('retailer catalog persists edits and confirms deletion', () => {
  assert.match(retailerSource, /handleSaveProduct/);
  assert.match(retailerSource, /persistPublicProduct\(user, updatedProduct\)/);
  assert.match(retailerSource, /handleConfirmDeleteProduct/);
  assert.match(retailerSource, /removePublicProduct\(user, product\.id\)/);
  assert.match(retailerSource, /confirm-delete-product-button/);
  assert.match(retailerSource, /Pedidos antigos continuarão preservando/);
});

test('product editor supports category reuse and media replacement', () => {
  assert.match(editorSource, /Reutilizar caminho existente/);
  assert.match(editorSource, /reusableCategoryPaths/);
  assert.match(editorSource, /collectionsForPath/);
  assert.match(editorSource, /GooglePhotosImagePickerButton/);
  assert.match(editorSource, /GoogleDriveImagePickerButton/);
});

test('new item modal receives reusable categories and a paperclip attachment control', () => {
  assert.match(creationBridgeSource, /reusable-product-category-select/);
  assert.match(creationBridgeSource, /product-image-paperclip-button/);
  assert.match(creationBridgeSource, /Google Fotos \/ Galeria/);
  assert.match(creationBridgeSource, /Google Drive/);
  assert.match(appSource, /<ProductCreationEnhancementBridge/);
});

test('product deletion removes only the authenticated store item', () => {
  assert.match(mutationSource, /product\.storeId !== user\.uid/);
  assert.match(mutationSource, /product\.supplierId !== user\.uid/);
  assert.match(mutationSource, /currentProducts\.filter/);
  assert.match(mutationSource, /updatedAt: serverTimestamp\(\)/);
});
