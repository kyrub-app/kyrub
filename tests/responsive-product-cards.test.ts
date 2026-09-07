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

test('mobile ERP menu removes Gerencial and exposes every management module directly', () => {
  assert.doesNotMatch(mobileErpMenu, /id: 'gerencial', label: 'Gerencial'/);
  assert.doesNotMatch(mobileErpMenu, /label: 'Gerencial'/);

  for (const id of [
    'produtos',
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
    'Produtos & Estoque',
    'Vendas & Analytics',
    'Financeiro Interno',
    'Recursos Humanos',
    'CRM',
    'Marketing',
    'Integrações & Sandbox',
    'Cupons & Vouchers',
  ]) {
    assert.match(mobileErpMenu, new RegExp(label));
  }
});

test('management menu selections use a direct navigation authority instead of activeSubTab gerencial', () => {
  assert.match(
    managementNavigation,
    /kyrub:erp-management-navigation/
  );
  assert.match(managementNavigation, /ErpManagementModule/);
  assert.match(mobileErpMenu, /requestErpManagementNavigation/);
  assert.match(mobileErpMenu, /isManagementModule\(itemId\)/);
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
