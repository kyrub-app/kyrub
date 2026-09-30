import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

describe('stock management navigation', () => {
  test('Products and Stock are sibling direct management destinations', () => {
    const navigation = readFileSync('src/utils/erpManagementNavigation.ts', 'utf8');
    const menu = readFileSync('src/components/MobileErpMenu.tsx', 'utf8');
    const router = readFileSync('src/components/RetailerPanelRuntimeRouter.tsx', 'utf8');

    assert.match(navigation, /\| 'produtos'[\s\S]*\| 'estoque'/);
    assert.match(menu, /id: 'produtos', label: 'Produtos'/);
    assert.match(menu, /id: 'estoque', label: 'Estoque'/);
    assert.doesNotMatch(menu, /Produtos & Estoque/);
    assert.match(router, /produtos: \{ title: 'Produtos'/);
    assert.match(router, /estoque: \{ title: 'Estoque'/);
    assert.match(router, /moduleId === 'estoque'/);
  });

  test('Products keeps catalog editing while Stock reuses canonical replenishment workspace', () => {
    const productsRuntime = readFileSync(
      'src/components/store/ProductInventoryDirectRuntime.tsx',
      'utf8'
    );
    const stockRuntime = readFileSync(
      'src/components/store/StockDirectRuntime.tsx',
      'utf8'
    );
    const purchaseWorkspace = readFileSync(
      'src/components/store/StorePurchaseWorkspace.tsx',
      'utf8'
    );

    assert.match(productsRuntime, /ProductInventoryWorkspace/);
    assert.match(productsRuntime, /ProductEditorModal/);
    assert.match(stockRuntime, /StorePurchaseWorkspace/);
    assert.match(purchaseWorkspace, /getProductInventoryDocumentPath/);
    assert.match(purchaseWorkspace, /ProductPurchaseList/);
  });
});
