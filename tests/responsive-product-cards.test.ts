import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const main = readFileSync('src/main.tsx', 'utf8');
const app = readFileSync('src/App.tsx', 'utf8');
const viteConfig = readFileSync('vite.config.ts', 'utf8');
const retailerPanel = readFileSync('src/components/RetailerPanel.tsx', 'utf8');
const gerencialPanel = readFileSync(
  'src/components/GerencialPanelRuntime.tsx',
  'utf8'
);
const runtimeRouter = readFileSync(
  'src/components/RetailerPanelRuntimeRouter.tsx',
  'utf8'
);
const inventoryWorkspace = readFileSync(
  'src/components/store/ProductInventoryWorkspace.tsx',
  'utf8'
);
const sharedPdv = readFileSync(
  'src/components/pdv/SharedPdvCatalog.tsx',
  'utf8'
);
const unifiedProductModal = readFileSync(
  'src/components/store/UnifiedProductModal.tsx',
  'utf8'
);
const hierarchySelector = readFileSync(
  'src/components/store/CatalogHierarchySelector.tsx',
  'utf8'
);

test('shared customer and staff PDV starts with two product columns on mobile', () => {
  assert.match(sharedPdv, /id=\{`\$\{idPrefix\}-pdv-products-grid`\}/);
  assert.match(
    sharedPdv,
    /grid grid-cols-2[\s\S]*sm:grid-cols-3[\s\S]*lg:grid-cols-4[\s\S]*2xl:grid-cols-5/
  );
});

test('shared PDV keeps compact cards and actions usable in two mobile columns', () => {
  assert.match(sharedPdv, /rounded-2xl[\s\S]*sm:rounded-3xl/);
  assert.match(sharedPdv, /min-h-9 w-full[\s\S]*sm:min-h-11 sm:w-auto/);
  assert.match(sharedPdv, /text-\[8px\][\s\S]*sm:text-\[10px\]/);
});

test('responsive product styles still load after the Tailwind entry stylesheet', () => {
  const tailwindImport = main.indexOf("import './index.css';");
  const responsiveImport = main.indexOf("import './styles/responsive-product-cards.css';");

  assert.ok(tailwindImport >= 0);
  assert.ok(responsiveImport > tailwindImport);
});

test('retailer inventory removes admin workspaces and replaces the appearance card', () => {
  assert.doesNotMatch(retailerPanel, /MigrationReconciliationWorkspace/);
  assert.doesNotMatch(retailerPanel, /StoreTeamWorkspace/);
  assert.match(retailerPanel, /ProductInventoryWorkspace/);
  assert.match(retailerPanel, /APARÊNCIA DA VITRINE/);
  assert.match(retailerPanel, /candidateGrid\.style\.display = 'none'/);
});

test('native Gerencial is the browser runtime and enters without hidden modal work', () => {
  assert.match(viteConfig, /RetailerPanelRuntimeRouter\.tsx/);
  assert.match(runtimeRouter, /from '\.\/GerencialPanelRuntime'/);
  assert.match(runtimeRouter, /<GerencialPanel/);
  assert.match(gerencialPanel, /id="kyrub-gerencial-native-runtime"/);
  assert.match(gerencialPanel, /data-kyrub-gerencial-runtime="inert-entry"/);
  assert.match(gerencialPanel, /activeModule === 'integracoes'/);
  assert.match(gerencialPanel, /editingProduct &&/);
  assert.doesNotMatch(gerencialPanel, /erp-gerencial-tab/);
});

test('native Gerencial owns product navigation without the legacy layout bridge', () => {
  assert.doesNotMatch(app, /<ProductWorkspaceLayoutBridge \/>/);
  assert.doesNotMatch(app, /GerencialMercadoLivreIntegrationBridge/);
  assert.match(gerencialPanel, /<ProductInventoryWorkspace/);
  assert.match(gerencialPanel, /Menu Gerencial/);
});

test('retailer inventory starts with two mobile columns and expands responsively', () => {
  assert.match(inventoryWorkspace, /id="erp-product-inventory-grid"/);
  assert.match(
    inventoryWorkspace,
    /grid grid-cols-2[\s\S]*sm:grid-cols-3[\s\S]*lg:grid-cols-4[\s\S]*2xl:grid-cols-5/
  );
  assert.match(inventoryWorkspace, /id="erp-product-keyword-filters"/);
  assert.match(inventoryWorkspace, /categoryRoot\(product\.category\)/);
});

test('the unified product modal supports hierarchy, complimentary items and choices', () => {
  assert.match(unifiedProductModal, /id="unified-product-modal"/);
  assert.match(unifiedProductModal, /<CatalogHierarchySelector/);
  assert.match(hierarchySelector, /Categoria da loja/);
  assert.match(hierarchySelector, /Subcategoria/);
  assert.match(hierarchySelector, /Subgrupo/);
  assert.match(hierarchySelector, /Pasta/);
  assert.match(unifiedProductModal, /id="product-complimentary-control"/);
  assert.match(unifiedProductModal, /ProductQuickNotesEditor/);
  assert.match(unifiedProductModal, /ProductOptionGroupsEditor/);
});
