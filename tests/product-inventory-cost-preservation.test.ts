import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { parseInventoryCatalog } from '../src/utils/productInventory.js';

const productInventorySource = readFileSync('src/utils/productInventory.ts', 'utf8');

describe('product inventory edits preserve economic basis', () => {
  test('frontend parser keeps moving-average fields instead of stripping them', () => {
    const [item] = parseInventoryCatalog([{
      id: 'ingredient-1',
      name: 'Ingrediente',
      unit: 'kg',
      currentQuantity: 10,
      minimumQuantity: 2,
      purchaseCost: 20,
      supplier: 'Fornecedor',
      updatedAt: '2026-09-30T18:00:00.000Z',
      costBasisStatus: 'complete',
      averageUnitCostMinor: 1500,
      lastPurchaseUnitCostMinor: 2000,
      inventoryValueMinor: 15000,
      costBasisSource: 'purchase_receipt',
      costBasisUpdatedAt: '2026-09-30T18:00:00.000Z',
    }]);

    assert.equal(item?.costBasisStatus, 'complete');
    assert.equal(item?.averageUnitCostMinor, 1500);
    assert.equal(item?.lastPurchaseUnitCostMinor, 2000);
    assert.equal(item?.inventoryValueMinor, 15000);
    assert.equal(item?.costBasisSource, 'purchase_receipt');
    assert.equal(item?.costBasisUpdatedAt, '2026-09-30T18:00:00.000Z');
  });

  test('composition persistence never writes the catalog or economic fields', () => {
    assert.match(productInventorySource, /costBasisStatus/);
    assert.match(productInventorySource, /averageUnitCostMinor/);
    assert.match(productInventorySource, /lastPurchaseUnitCostMinor/);
    assert.match(productInventorySource, /inventoryValueMinor/);
    assert.match(productInventorySource, /costBasisSource/);
    const persistence = productInventorySource.slice(productInventorySource.indexOf('export const persistProductInventorySettings'));
    assert.match(persistence, /planProductCompositionEdit\(/);
    assert.match(persistence, /productCompositions: settings\.compositions/);
    assert.match(persistence, /compositions: settings\.compositions/);
    assert.doesNotMatch(persistence, /(?:inventoryCatalog|catalog|averageUnitCostMinor|inventoryValueMinor)\s*:\s*(?:settings\.|normalizedCatalog|current\.)/);
    assert.match(persistence, /transaction\.set\(reference, data, \{ mergeFields: Object\.keys\(data\) \}\)/);
  });
});
