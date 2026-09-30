import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  calculateProductCostImpact,
  roundCurrency,
} from '../shared/productPricing';

const catalog = [
  { id: 'pao', purchaseCost: 1.2 },
  { id: 'carne', purchaseCost: 30, currentQuantity: 1.4 },
  { id: 'queijo', purchaseCost: 1.5 },
  { id: 'batata', purchaseCost: 8 },
];

const composition = {
  yieldQuantity: 1,
  lines: [
    { inventoryItemId: 'pao', quantity: 1 },
    { inventoryItemId: 'carne', quantity: 0.14 },
    { inventoryItemId: 'queijo', quantity: 1 },
    { inventoryItemId: 'batata', quantity: 0.1 },
  ],
};

test('X-Burger replenishment impact projects moving-average margin and suggested price without mutating source catalog', () => {
  const before = structuredClone(catalog);
  const impact = calculateProductCostImpact(
    catalog,
    composition,
    'carne',
    40,
    1.4,
    29.5,
    40
  );

  assert.ok(impact);
  assert.equal(roundCurrency(impact.currentUnitCost), 7.7);
  assert.equal(roundCurrency(impact.currentInventoryUnitCost), 30);
  assert.equal(roundCurrency(impact.projectedInventoryUnitCost), 35);
  assert.equal(roundCurrency(impact.projectedUnitCost), 8.4);
  assert.equal(roundCurrency(impact.unitCostDelta), 0.7);
  assert.equal(roundCurrency(impact.unitCostDeltaPercent ?? -1), 9.09);
  assert.equal(roundCurrency(impact.currentMarginPercent ?? -1), 73.9);
  assert.equal(roundCurrency(impact.projectedMarginPercent ?? -1), 71.53);
  assert.equal(roundCurrency(impact.currentSuggestedPrice ?? -1), 12.83);
  assert.equal(roundCurrency(impact.projectedSuggestedPrice ?? -1), 14);
  assert.deepEqual(catalog, before);
});

test('cost impact refuses invalid hypothetical cost, quantity or ingredient outside the composition', () => {
  assert.equal(
    calculateProductCostImpact(catalog, composition, 'carne', 0, 1.4, 29.5, 40),
    null
  );
  assert.equal(
    calculateProductCostImpact(catalog, composition, 'carne', 40, 0, 29.5, 40),
    null
  );
  assert.equal(
    calculateProductCostImpact(catalog, composition, 'molho', 10, 1, 29.5, 40),
    null
  );
});

test('pricing panel labels replenishment simulation as non-persistent', () => {
  const source = readFileSync(
    new URL('../src/components/store/ProductPricingPanel.tsx', import.meta.url),
    'utf8'
  );
  assert.match(source, /Simular próxima reposição/);
  assert.match(source, /quantidade e custo hipotéticos/i);
  assert.match(source, /não salva compra, estoque ou preço de venda/i);
  assert.match(source, /projectedPurchaseQuantity/);
  assert.match(source, /calculateProductCostImpact/);
});
