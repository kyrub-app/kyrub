import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const hierarchySelector = readFileSync(
  'src/components/store/CatalogHierarchySelector.tsx',
  'utf8'
);
const hierarchyUtility = readFileSync(
  'src/utils/catalogHierarchy.ts',
  'utf8'
);
const treeUtility = readFileSync(
  'src/utils/catalogCategoryTree.ts',
  'utf8'
);
const unifiedModal = readFileSync(
  'src/components/store/UnifiedProductModal.tsx',
  'utf8'
);

test('product creation and editing share the semantic hierarchy selector', () => {
  assert.match(unifiedModal, /<CatalogHierarchySelector/);
  assert.match(hierarchySelector, /Categorias e grupos/);
  assert.match(hierarchySelector, /Categoria da loja/);
  assert.match(hierarchySelector, /CATALOG_HIERARCHY_TIERS\.map/);
  assert.match(hierarchySelector, /Editar \$\{tierLabel\.toLowerCase\(\)\}/);
  assert.match(hierarchySelector, /Excluir \$\{tierLabel\.toLowerCase\(\)\}/);
});

test('category roots remain controlled by profile keywords', () => {
  assert.match(
    hierarchySelector,
    /A categoria principal vem das palavras-chave do perfil/
  );
  assert.match(
    treeUtility,
    /A categoria principal é editada nas palavras-chave da loja/
  );
});

test('folder removal promotes products instead of deleting them', () => {
  assert.match(
    hierarchySelector,
    /Os produtos não serão apagados; itens e níveis internos serão promovidos/
  );
  assert.match(treeUtility, /deleteProductCategoryPath/);
  assert.match(treeUtility, /publicProducts: result\.products/);
});

test('commercial hierarchy has group and subgroup with five children per parent', () => {
  assert.match(
    hierarchyUtility,
    /'Grupo',[\s\S]*'Subgrupo'/
  );
  assert.doesNotMatch(hierarchyUtility, /'Pasta'/);
  assert.match(hierarchyUtility, /MAX_CATALOG_HIERARCHY_CHILDREN = 5/);
  assert.match(hierarchySelector, /children\.length >= MAX_CATALOG_HIERARCHY_CHILDREN/);
  assert.match(hierarchySelector, /getDirectCatalogHierarchyChildren/);
});
