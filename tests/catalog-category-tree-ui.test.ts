import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const bridge = readFileSync(
  'src/components/store/ProductCreationEnhancementBridge.tsx',
  'utf8'
);
const treeUtility = readFileSync(
  'src/utils/catalogCategoryTree.ts',
  'utf8'
);

test('product creation and editing share an editable folder tree', () => {
  assert.match(bridge, /Pastas e subpastas da categoria/);
  assert.match(bridge, /catalog-category-tree-manager/);
  assert.match(bridge, /findEditorCategorySection/);
  assert.match(bridge, /product-subcategory-control/);
  assert.match(bridge, /Renomear pasta/);
  assert.match(bridge, /Excluir pasta/);
  assert.match(bridge, /applyPathToForm/);
});

test('category roots remain controlled by profile keywords', () => {
  assert.match(
    bridge,
    /A palavra-chave é a pasta principal/
  );
  assert.match(
    treeUtility,
    /A categoria principal é editada nas palavras-chave da loja/
  );
});

test('folder removal promotes products instead of deleting them', () => {
  assert.match(
    bridge,
    /Itens e subpastas serão movidos para o nível anterior/
  );
  assert.match(treeUtility, /deleteProductCategoryPath/);
  assert.match(treeUtility, /publicProducts: result\.products/);
});

test('the hierarchy is limited to six total levels', () => {
  assert.match(treeUtility, /MAX_CATALOG_CATEGORY_LEVELS = 6/);
  assert.match(bridge, /Máx\. \{MAX_CATALOG_CATEGORY_LEVELS\} níveis/);
  assert.match(bridge, /MAX_CATALOG_CATEGORY_LEVELS - 1/);
});
