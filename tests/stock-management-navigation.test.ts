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

  test('Stock exposes replenishment, purchases, receipts and suppliers as operational tabs', () => {
    const stockRuntime = readFileSync(
      'src/components/store/StockDirectRuntime.tsx',
      'utf8'
    );

    for (const section of ['replenishment', 'purchases', 'receipts', 'suppliers']) {
      assert.match(stockRuntime, new RegExp(`id: '${section}'`));
    }
    assert.match(stockRuntime, /onPreparePurchaseDraft=\{preparePurchase\}/);
    assert.match(stockRuntime, /StoreProcurementWorkspace/);
    assert.match(stockRuntime, /Somente um recebimento confirmado altera o saldo do estoque/);
  });

  test('replenishment selection prepares a purchase instead of mutating stock', () => {
    const purchaseList = readFileSync(
      'src/components/store/ProductPurchaseList.tsx',
      'utf8'
    );
    const purchaseWorkspace = readFileSync(
      'src/components/store/StorePurchaseWorkspace.tsx',
      'utf8'
    );

    assert.match(purchaseList, /onPreparePurchaseDraft/);
    assert.match(purchaseList, /type="checkbox"/);
    assert.match(purchaseList, /Preparar compra/);
    assert.match(purchaseWorkspace, /onPreparePurchaseDraft=\{onPreparePurchaseDraft\}/);
  });

  test('procurement UI uses the authorized API and keeps physical confirmation explicit', () => {
    const workspace = readFileSync(
      'src/components/store/StoreProcurementWorkspace.tsx',
      'utf8'
    );

    assert.match(workspace, /\/api\/store-procurement/);
    assert.match(workspace, /create_supplier/);
    assert.match(workspace, /create_purchase_draft/);
    assert.match(workspace, /order_purchase/);
    assert.match(workspace, /create_receipt_draft/);
    assert.match(workspace, /confirm_receipt/);
    assert.match(workspace, /Confirmar entrada no estoque/);
    assert.match(workspace, /quotedUnitCostMinor: null/);
    assert.doesNotMatch(workspace, /firebase\/firestore|\bdb\b|setDoc|addDoc/);
  });

  test('procurement API reuses canonical receipt intake and serverless function budget', () => {
    const service = readFileSync(
      'server/inventory/storeProcurementService.ts',
      'utf8'
    );
    const router = readFileSync(
      'server/inventory/storeProcurementRouter.ts',
      'utf8'
    );
    const multiplexer = readFileSync(
      'server/payments/storePromotionServerlessTransport.ts',
      'utf8'
    );
    const vercel = readFileSync('vercel.json', 'utf8');
    const server = readFileSync('server.ts', 'utf8');

    assert.match(service, /stores\/\$\{storeId\}\/members\/\$\{identity\.uid\}/);
    assert.match(service, /role !== 'owner'/);
    assert.match(service, /applyConfirmedPurchaseReceiptToInventory/);
    assert.match(service, /documentedUnitCostMinor/);
    assert.doesNotMatch(service, /financePayables|moving.?average|\bCMV\b/i);
    assert.doesNotMatch(service, /purchaseCost\s*:/);
    assert.match(router, /listAuthorizedStoreProcurement/);
    assert.match(router, /executeAuthorizedStoreProcurementAction/);
    assert.match(multiplexer, /surface === 'procurement'/);
    assert.match(vercel, /"source": "\/api\/store-procurement"/);
    assert.match(vercel, /transport=store-promotions&surface=procurement/);
    assert.match(server, /createStoreProcurementRouter/);
    assert.match(server, /"\/api\/store-procurement"/);
  });
});
