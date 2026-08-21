import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateIngredientDemand,
  findInventoryIngredients,
  inventoryIngredientViews,
} from '../shared/inventoryIngredientIntelligence';
import type {
  InventoryCatalogRecord,
  InventoryCompositionRecord,
} from '../shared/inventoryConsumption';

const catalog: InventoryCatalogRecord[] = [
  { id: 'bun', name: 'Pão para hambúrguer', unit: 'un', currentQuantity: 20, minimumQuantity: 5, purchaseCost: 1, supplier: '', updatedAt: '' },
  { id: 'beef', name: 'Carne bovina Premium', unit: 'g', currentQuantity: 1400, minimumQuantity: 500, purchaseCost: 0.04, supplier: '', updatedAt: '' },
  { id: 'cheese', name: 'Queijo para hambúrguer', unit: 'g', currentQuantity: 300, minimumQuantity: 200, purchaseCost: 0.03, supplier: '', updatedAt: '' },
  { id: 'fries', name: 'Batata frita', unit: 'g', currentQuantity: 900, minimumQuantity: 1000, purchaseCost: 0.01, supplier: '', updatedAt: '' },
];

const compositions: Record<string, InventoryCompositionRecord> = {
  '002': {
    kind: 'recipe',
    yieldQuantity: 1,
    updatedAt: '',
    lines: [
      { inventoryItemId: 'bun', quantity: 1 },
      { inventoryItemId: 'beef', quantity: 140 },
      { inventoryItemId: 'cheese', quantity: 30 },
      { inventoryItemId: 'fries', quantity: 120 },
    ],
  },
};

test('ingredient lookup searches inventory rather than product catalog', () => {
  const result = findInventoryIngredients('Carne bovina Premium', catalog, compositions);
  assert.equal(result.length, 1);
  assert.equal(result[0]?.id, 'beef');
  assert.equal(result[0]?.currentQuantity, 1400);
  assert.deepEqual(result[0]?.usedByProductIds, ['002']);
});

test('ingredient views expose low stock and reservations', () => {
  const views = inventoryIngredientViews(catalog, compositions, { cheese: 150 });
  const cheese = views.find(item => item.id === 'cheese');
  const fries = views.find(item => item.id === 'fries');
  assert.equal(cheese?.availableQuantity, 150);
  assert.equal(cheese?.status, 'low');
  assert.equal(fries?.status, 'low');
});

test('recipe demand calculates shortages without confusing product stock', () => {
  const demand = calculateIngredientDemand([{ productId: '002', quantity: 10 }], catalog, compositions);
  assert.equal(demand.find(item => item.inventoryItemId === 'bun')?.requiredQuantity, 10);
  assert.equal(demand.find(item => item.inventoryItemId === 'beef')?.requiredQuantity, 1400);
  assert.equal(demand.find(item => item.inventoryItemId === 'cheese')?.requiredQuantity, 300);
  assert.equal(demand.find(item => item.inventoryItemId === 'fries')?.requiredQuantity, 1200);
  assert.equal(demand.find(item => item.inventoryItemId === 'fries')?.shortageQuantity, 300);
});