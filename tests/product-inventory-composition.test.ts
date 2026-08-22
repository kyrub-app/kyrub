import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { normalizeKyrubInventoryTransformationProposal } from '../shared/kyrubInventoryTransformation';
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
const reconciliationSource = readFileSync(
  'server/inventory/productStockReconciliationService.ts',
  'utf8'
);
const transformationSource = readFileSync(
  'server/inventory/inventoryTransformationExecutionService.ts',
  'utf8'
);
const actionExecuteSource = readFileSync('api/action-execute.ts', 'utf8');

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

  test('authoritative inventory adjustments reconcile sellable stock without publishing recipes', () => {
    assert.match(reconciliationSource, /calculateCompositionAvailableStock/);
    assert.match(reconciliationSource, /available === null\s*\? \[\]/);
    assert.match(reconciliationSource, /tenants\/\$\{tenantId\}/);
    assert.match(
      reconciliationSource,
      /stores\/\$\{canonicalStoreId\}\/products\/\$\{patch\.productId\}/
    );
    assert.match(reconciliationSource, /\{ \.\.\.product, stock \}/);
    assert.doesNotMatch(reconciliationSource, /productCompositions\s*:/);
    assert.doesNotMatch(reconciliationSource, /inventoryCatalog\s*:/);
    assert.match(
      actionExecuteSource,
      /executeAuthorizedKyrubInventoryAdjustment[\s\S]*reconcileDerivedProductStockForTenant/
    );
  });

  test('universal transformation contract supports raw material, intermediates, byproducts and audited losses', () => {
    const proposal = normalizeKyrubInventoryTransformationProposal({
      id: 'batch-beef-001',
      type: 'transform_inventory',
      inputs: [{ name: 'Carne bovina', quantity: 5, unit: 'kg' }],
      outputs: [
        { name: 'Hambúrguer 100g', quantity: 45, unit: 'un', kind: 'intermediate' },
        { name: 'Aparas aproveitáveis', quantity: 0.2, unit: 'kg', kind: 'byproduct' },
      ],
      losses: [
        { name: 'Gordura e limpeza', quantity: 300, unit: 'g', reason: 'descarte' },
      ],
      source: { kind: 'processing', label: 'Porcionamento de carne' },
      requiresConfirmation: true,
    });

    assert.ok(proposal);
    assert.equal(proposal.inputs[0]?.quantity, 5);
    assert.equal(proposal.outputs[0]?.kind, 'intermediate');
    assert.equal(proposal.outputs[1]?.kind, 'byproduct');
    assert.equal(proposal.losses[0]?.quantity, 300);

    assert.equal(
      normalizeKyrubInventoryTransformationProposal({
        id: 'impossible-loss',
        type: 'transform_inventory',
        inputs: [{ name: 'Carne bovina', quantity: 5, unit: 'kg' }],
        outputs: [{ name: 'Hambúrguer', quantity: 1, unit: 'un', kind: 'intermediate' }],
        losses: [{ name: 'Perda', quantity: 6, unit: 'kg' }],
        source: { kind: 'processing' },
        requiresConfirmation: true,
      }),
      null
    );
  });

  test('transformation executor consumes inputs once, produces outputs atomically and never double-decrements losses', () => {
    assert.match(transformationSource, /runTransaction/);
    assert.match(transformationSource, /INSUFFICIENT_INVENTORY/);
    assert.match(transformationSource, /receiptSnapshot\.exists/);
    assert.match(transformationSource, /currentQuantity - requiredQuantity/);
    assert.match(transformationSource, /currentQuantity \+ aggregated\.quantity/);
    assert.match(transformationSource, /losses: proposal\.losses/);
    assert.doesNotMatch(transformationSource, /loss.*currentQuantity\s*-/i);
    assert.match(transformationSource, /totalConsumedCost/);
    assert.match(transformationSource, /collection\('transformations'\)/);
  });

  test('transformations share the existing action runtime and reconcile sellable stock', () => {
    assert.match(actionExecuteSource, /rawProposal\?\.type === 'transform_inventory'/);
    assert.match(actionExecuteSource, /executeAuthorizedInventoryTransformation/);
    assert.match(
      actionExecuteSource,
      /reconcileDerivedProductStockForTenant\(result\.entityId\)/
    );
    assert.doesNotMatch(actionExecuteSource, /inventory-transform\.ts/);
  });
});
