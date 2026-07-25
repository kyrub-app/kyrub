import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const styles = readFileSync('src/styles/responsive-product-cards.css', 'utf8');
const main = readFileSync('src/main.tsx', 'utf8');
const retailerPanel = readFileSync('src/components/RetailerPanel.tsx', 'utf8');
const inventoryWorkspace = readFileSync(
  'src/components/store/ProductInventoryWorkspace.tsx',
  'utf8'
);
const productModal = readFileSync(
  'src/components/modals/NewProductModal.tsx',
  'utf8'
);

test('public storefront starts with two product columns on mobile', () => {
  assert.match(
    styles,
    /#storefront-panel-container[\s\S]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/
  );
});

test('product grids progressively expand to three and four columns', () => {
  assert.match(styles, /@media \(min-width: 640px\)[\s\S]*repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(styles, /@media \(min-width: 1024px\)[\s\S]*repeat\(4, minmax\(0, 1fr\)\)/);
});

test('seller cardápio and customer catálogo share the responsive contract', () => {
  assert.match(styles, /\.z-\\\[120\\\] main > \.grid\.grid-cols-2/);
  assert.match(styles, /article\[id\^='storefront-prod-'\]/);
});

test('responsive product styles load after the Tailwind entry stylesheet', () => {
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

test('retailer inventory starts with two mobile columns and expands responsively', () => {
  assert.match(inventoryWorkspace, /id="erp-product-inventory-grid"/);
  assert.match(
    inventoryWorkspace,
    /grid grid-cols-2[\s\S]*sm:grid-cols-3[\s\S]*lg:grid-cols-4[\s\S]*2xl:grid-cols-5/
  );
  assert.match(inventoryWorkspace, /id="erp-product-keyword-filters"/);
  assert.match(inventoryWorkspace, /categoryRoot\(product\.category\)/);
});

test('new product categories come from store keywords and support visual hierarchical levels', () => {
  assert.match(productModal, /snapshot\.data\(\)\?\.keywords/);
  assert.match(productModal, /Categoria da loja/);
  assert.match(productModal, /product-subcategory-control/);
  assert.match(productModal, /Subcategorias e coleções/);
  assert.match(productModal, /join\(' > '\)/);
  assert.match(productModal, /category: categoryPath/);
  assert.match(productModal, /categoryCollections/);
  assert.match(productModal, /product-subcategory-media-list/);
});
