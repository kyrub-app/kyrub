import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const main = readFileSync('src/main.tsx', 'utf8');
const app = readFileSync('src/App.tsx', 'utf8');
const viteConfig = readFileSync('vite.config.ts', 'utf8');
const retailerPanel = readFileSync('src/components/RetailerPanel.tsx', 'utf8');
const runtimeRouter = readFileSync(
  'src/components/RetailerPanelRuntimeRouter.tsx',
  'utf8'
);
const mobileErpMenu = readFileSync(
  'src/components/MobileErpMenu.tsx',
  'utf8'
);
const managementNavigation = readFileSync(
  'src/utils/erpManagementNavigation.ts',
  'utf8'
);
const gerencialIntegrations = readFileSync(
  'src/components/GerencialIntegrationsRuntime.tsx',
  'utf8'
);
const inventoryWorkspace = readFileSync(
  'src/components/store/ProductInventoryWorkspace.tsx',
  'utf8'
);
const directInventoryRuntime = readFileSync(
  'src/components/store/ProductInventoryDirectRuntime.tsx',
  'utf8'
);
const sharedPdv = readFileSync(
  'src/components/pdv/SharedPdvCatalog.tsx',
  'utf8'
);
const responsiveProductCards = readFileSync('src/styles/responsive-product-cards.css', 'utf8');
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

test('shared PDV keeps action labels readable in every two-column product card', () => {
  assert.match(sharedPdv, /rounded-2xl[\s\S]*sm:rounded-3xl/);
  assert.match(sharedPdv, /mt-auto flex flex-col gap-2 border-t border-slate-800/);
  assert.doesNotMatch(sharedPdv, /sm:flex-row sm:items-end sm:justify-between/);
  assert.match(sharedPdv, /flex min-h-11 min-w-0 w-full items-center justify-center/);
  assert.match(sharedPdv, /<span className="min-w-0 text-center leading-tight whitespace-normal break-words">\{actionLabel\}<\/span>/);
  assert.match(sharedPdv, /shrink-0 sm:h-4 sm:w-4/);
  assert.match(sharedPdv, /text-\[10px\] font-black uppercase tracking-wide/);
});

test('responsive product styles still load after the Tailwind entry stylesheet', () => {
  const tailwindImport = main.indexOf("import './index.css';");
  const responsiveImport = main.indexOf("import './styles/responsive-product-cards.css';");

  assert.ok(tailwindImport >= 0);
  assert.ok(responsiveImport > tailwindImport);
});

test('retailer inventory is owned by the direct products runtime, not the retired Gerencial bridge', () => {
  assert.doesNotMatch(retailerPanel, /MigrationReconciliationWorkspace/);
  assert.doesNotMatch(retailerPanel, /StoreTeamWorkspace/);
  assert.doesNotMatch(retailerPanel, /ProductInventoryWorkspace/);
  assert.doesNotMatch(retailerPanel, /candidateGrid\.style\.display = 'none'/);
  assert.match(runtimeRouter, /LazyProductInventoryRuntime/);
  assert.match(directInventoryRuntime, /ProductInventoryWorkspace/);
});

test('mobile ERP menu removes Gerencial and exposes every management module directly', () => {
  assert.doesNotMatch(mobileErpMenu, /id: 'gerencial', label: 'Gerencial'/);
  assert.doesNotMatch(mobileErpMenu, /label: 'Gerencial'/);

  for (const id of [
    'produtos',
    'estoque',
    'vendas',
    'financeiro',
    'rh',
    'crm',
    'marketing',
    'integracoes',
    'vouchers',
  ]) {
    assert.match(mobileErpMenu, new RegExp(`id: '${id}'`));
  }

  for (const label of [
    'Produtos',
    'Estoque',
    'Vendas & Analytics',
    'Financeiro Interno',
    'Equipe & Permissões',
    'CRM',
    'Marketing',
    'Integrações',
    'Promocionais',
  ]) {
    assert.match(mobileErpMenu, new RegExp(label));
  }

  assert.doesNotMatch(mobileErpMenu, /Produtos & Estoque/);
});

test('management menu selections use a direct navigation authority instead of activeSubTab gerencial', () => {
  assert.match(
    managementNavigation,
    /kyrub:erp-management-navigation/
  );
  assert.match(managementNavigation, /ErpManagementModule/);
  assert.match(mobileErpMenu, /requestErpManagementNavigation/);
  assert.match(mobileErpMenu, /isMobileErpManagementModule\(itemId\)/);
  assert.match(mobileErpMenu, /selectManagement\(itemId\)/);
  assert.doesNotMatch(
    mobileErpMenu,
    /onSelectTab\('gerencial'\)/
  );
});

test('runtime router owns flattened management destinations and keeps the retired Gerencial route inert', () => {
  assert.match(viteConfig, /RetailerPanelRuntimeRouter\.tsx/);
  assert.match(runtimeRouter, /KYRUB_ERP_MANAGEMENT_NAVIGATION_EVENT/);
  assert.match(runtimeRouter, /useState<ErpManagementModule \| null>/);
  assert.match(runtimeRouter, /data-kyrub-management-module=\{moduleId\}/);
  assert.match(runtimeRouter, /Gerencial foi removido\./);
  assert.doesNotMatch(runtimeRouter, /<LegacyRetailerPanel/);
});

test('Integrations and Sandbox loads directly and owns Mercado Livre without the old Gerencial bridge', () => {
  assert.doesNotMatch(app, /<ProductWorkspaceLayoutBridge \/>/);
  assert.doesNotMatch(app, /GerencialMercadoLivreIntegrationBridge/);
  assert.match(runtimeRouter, /import\('\.\/GerencialIntegrationsRuntime'\)/);
  assert.match(runtimeRouter, /moduleId === 'integracoes'/);
  assert.match(runtimeRouter, /<LazyIntegrationsRuntime/);
  assert.match(gerencialIntegrations, /data-kyrub-gerencial-module="integrations-lazy"/);
  assert.match(gerencialIntegrations, /onAuthStateChanged\(auth, setUser\)/);
  assert.match(gerencialIntegrations, /<StoreConnectionsWorkspace/);
  assert.match(gerencialIntegrations, /<MercadoLivreE2ETestBridge/);
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


test('desktop storefront CSS never overrides stacked price and Adicionar actions', () => {
  const media640 = responsiveProductCards.split('@media (min-width: 640px)')[1]?.split('@media (min-width: 1024px)')[0];
  assert.ok(media640, 'The storefront should have a 640px responsive block');
  assert.doesNotMatch(media640, /flex-direction:\s*row\s*;/,
    'No desktop override may put price beside the add action');
  assert.match(media640, /align-items:\s*stretch\s*;\s*flex-direction:\s*column\s*;/);
  assert.match(media640, /min-height:\s*2\.75rem\s*;\s*width:\s*100%\s*;\s*min-width:\s*0\s*;/);
  assert.match(responsiveProductCards, /button\[id\^='storefront-add-'\]/,
    'Product button selectors must match SharedPdvCatalog idPrefix=storefront');
  assert.doesNotMatch(responsiveProductCards, /button\[id\^='add-to'\]/,
    'Remove obsolete selectors that never matched canonical storefront buttons');
  assert.match(sharedPdv, /className="mt-auto flex flex-col gap-2 border-t border-slate-800/);
  assert.match(sharedPdv, /className="flex min-h-11 min-w-0 w-full items-center/);
  assert.match(sharedPdv, /<span className="min-w-0 text-center leading-tight whitespace-normal break-words">\{actionLabel\}<\/span>/);
});


test('337px official storefront keeps Adicionar on one line without hiding longer actions', () => {
  const narrow = responsiveProductCards.match(/@media \(max-width: 379px\) \{([\s\S]*?)\n\}\n\n\/\* The seller workspace/);
  assert.ok(narrow, 'The narrow mobile action override must be scoped under 380px');
  const styles = narrow[1];
  assert.match(sharedPdv, /data-compact-add-action=\{actionLabel === 'Adicionar' \? 'true' : undefined\}/);
  assert.match(styles, /button\[id\^='storefront-add-'\]\[data-compact-add-action='true'\]/);
  assert.match(styles, /gap:\s*0;\s*padding-inline:\s*0\.375rem;\s*letter-spacing:\s*normal;/);
  assert.match(styles, /> svg \{\s*display:\s*none;/, 'Hide decorative icon to reserve label width');
  assert.match(styles, /> span \{\s*white-space:\s*nowrap;\s*overflow-wrap:\s*normal;/);
  assert.match(responsiveProductCards, /repeat\(2, minmax\(0, 1fr\)\)/,
    'Do not remove the two-column catalog for a single action');
  assert.match(sharedPdv, /text-\[10px\] font-black uppercase tracking-wide/,
    'Preserve the Catu-aligned accessible source size');
  assert.doesNotMatch(styles, /font-size:/, 'Do not shrink the font to make text fit');
});
