import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const main = readFileSync('src/main.tsx', 'utf8');
const app = readFileSync('src/App.tsx', 'utf8');
const retailerPanel = readFileSync('src/components/RetailerPanel.tsx', 'utf8');
const inventoryWorkspace = readFileSync(
  'src/components/store/ProductInventoryWorkspace.tsx',
  'utf8'
);
const productWorkspaceLayout = readFileSync(
  'src/components/store/ProductWorkspaceLayoutBridge.tsx',
  'utf8'
);
const sharedPdv = readFileSync(
  'src/components/pdv/SharedPdvCatalog.tsx',
  'utf8'
);
const productModal = readFileSync(
  'src/components/modals/NewProductModal.tsx',
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

test('product module keeps navigation above the cards and hides both legacy blocks', () => {
  assert.match(app, /<ProductWorkspaceLayoutBridge \/>/);
  assert.match(productWorkspaceLayout, /id="erp-product-navigation"/);
  assert.match(productWorkspaceLayout, /id="erp-product-back-to-management"/);
  assert.match(
    productWorkspaceLayout,
    /portalHost\.parentElement\.insertBefore\(host, portalHost\)/
  );
  assert.match(productWorkspaceLayout, /APARÊNCIA DA VITRINE/);
  assert.match(productWorkspaceLayout, /ITENS ATIVOS NO ESTOQUE/);
  assert.match(productWorkspaceLayout, /legacyGrid[\s\S]*hideElement/);
  assert.match(productWorkspaceLayout, /originalBreadcrumb[\s\S]*hideElement/);
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

test('new product categories support hierarchy, complimentary items and choice groups', () => {
  assert.match(productModal, /snapshot\.data\(\)\?\.keywords/);
  assert.match(productModal, /Categoria da loja/);
  assert.match(productModal, /product-subcategory-control/);
  assert.match(productModal, /Subcategorias e coleções/);
  assert.match(productModal, /join\(' > '\)/);
  assert.match(productModal, /category: categoryPath/);
  assert.match(productModal, /categoryCollections/);
  assert.match(productModal, /product-subcategory-media-list/);
  assert.match(productModal, /id="product-complimentary-control"/);
  assert.match(productModal, /Item sem custo/);
  assert.match(productModal, /id="product-option-groups-control"/);
  assert.match(productModal, /Personalização, etapas e múltiplas escolhas/);
  assert.match(productModal, /minSelections/);
  assert.match(productModal, /maxSelections/);
});
