import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import {
  buildInventoryPurchaseList,
  calculateProductAvailableStock,
  getProductInventoryDocumentPath,
  parseInventoryCatalog,
  parseProductComposition,
  type InventoryCatalogItem,
} from '../src/utils/productInventory';

const modalSource = readFileSync(
  'src/components/store/UnifiedProductModal.tsx',
  'utf8'
);
const editorSource = readFileSync(
  'src/components/store/ProductInventoryCompositionEditor.tsx',
  'utf8'
);
const purchaseSource = readFileSync(
  'src/components/store/ProductPurchaseList.tsx',
  'utf8'
);
const inventorySource = readFileSync(
  'src/utils/productInventory.ts',
  'utf8'
);
const publicProductsSource = readFileSync(
  'src/utils/publicProducts.ts',
  'utf8'
);

const catalog: InventoryCatalogItem[] = [
  {
    id: 'flour',
    name: 'Farinha',
    unit: 'g',
    currentQuantity: 5000,
    minimumQuantity: 2000,
    purchaseCost: 0.01,
    supplier: 'Fornecedor A',
    updatedAt: '',
  },
  {
    id: 'cheese',
    name: 'Queijo',
    unit: 'g',
    currentQuantity: 900,
    minimumQuantity: 1200,
    purchaseCost: 0.04,
    supplier: '',
    updatedAt: '',
  },
];

describe('product inventory and composition', () => {
  test('parses a private reusable catalog with supported base units', () => {
    assert.deepEqual(parseInventoryCatalog(catalog), catalog);
    assert.deepEqual(
      parseInventoryCatalog([
        ...catalog,
        { id: 'invalid/id', name: 'Inválido', unit: 'kg' },
      ]),
      catalog
    );
  });

  test('calculates sellable stock from recipe consumption and yield', () => {
    const composition = parseProductComposition({
      kind: 'recipe',
      yieldQuantity: 10,
      lines: [
        { inventoryItemId: 'flour', quantity: 1000 },
        { inventoryItemId: 'cheese', quantity: 300 },
      ],
    });

    assert.equal(calculateProductAvailableStock(catalog, composition), 30);
  });

  test('uses the same composition model for retail bundles', () => {
    const composition = parseProductComposition({
      kind: 'bundle',
      yieldQuantity: 1,
      lines: [
        { inventoryItemId: 'flour', quantity: 500 },
        { inventoryItemId: 'cheese', quantity: 100 },
      ],
    });

    assert.equal(composition.kind, 'bundle');
    assert.equal(calculateProductAvailableStock(catalog, composition), 9);
  });

  test('builds the purchase list from current and minimum quantities', () => {
    const list = buildInventoryPurchaseList(catalog);
    assert.equal(list.length, 1);
    assert.equal(list[0]?.name, 'Queijo');
    assert.equal(list[0]?.suggestedQuantity, 300);
    assert.equal(list[0]?.estimatedCost, 12);
  });

  test('modal exposes compact showcase, inventory and purchase tabs', () => {
    assert.match(modalSource, /Itens da vitrine/);
    assert.match(modalSource, /label: 'Estoque'/);
    assert.match(modalSource, /Lista de compras/);
    assert.match(modalSource, /overflow-x-auto/);
    assert.match(modalSource, /min-w-\[9rem\]/);
    assert.match(modalSource, /ProductInventoryCompositionEditor/);
    assert.match(modalSource, /ProductPurchaseList/);
    assert.match(modalSource, /calculateProductAvailableStock/);
    assert.match(modalSource, /persistProductInventorySettings/);
    assert.doesNotMatch(modalSource, /Estoque inicial/);
  });

  test('inventory fields remain editable after a sync error without silent loss', () => {
    assert.match(modalSource, /Os campos continuam editáveis/);
    assert.match(modalSource, /Tentar novamente/);
    assert.match(modalSource, /inventoryDirty && inventoryLoadError/);
    assert.match(modalSource, /disabled=\{isSaving \|\| !inventoryLoaded\}/);
    assert.doesNotMatch(
      modalSource,
      /disabled=\{isSaving \|\| !inventoryLoaded \|\| Boolean\(inventoryLoadError\)\}/
    );
  });

  test('selection options support create, edit and removal', () => {
    assert.match(editorSource, /Caixa de seleção/);
    assert.match(editorSource, /Criar, editar ou remover componentes/);
    assert.match(editorSource, /saveCatalogItem/);
    assert.match(editorSource, /editCatalogItem/);
    assert.match(editorSource, /removeCatalogItem/);
    assert.match(editorSource, /Ficha técnica/);
    assert.match(editorSource, /Kit \/ combinação/);
  });

  test('inventory stays owner-only instead of entering public product payloads', () => {
    assert.equal(
      getProductInventoryDocumentPath('owner-a'),
      'users/owner-a/private_store/inventory'
    );
    assert.match(inventorySource, /users\/\$\{uid\.trim\(\)\}\/private_store\/inventory/);
    assert.match(inventorySource, /inventoryCatalog/);
    assert.match(inventorySource, /productCompositions/);
    assert.doesNotMatch(inventorySource, /doc\(db, 'tenants'/);
    assert.doesNotMatch(publicProductsSource, /inventoryCatalog/);
    assert.doesNotMatch(publicProductsSource, /productCompositions/);
    assert.match(purchaseSource, /Reposição sugerida pelo estoque mínimo/);
  });
});
