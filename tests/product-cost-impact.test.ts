import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  calculateProductCostImpact,
  roundCurrency,
} from '../shared/productPricing';

const catalog = [
  { id: 'pao', purchaseCost: 1.2 },
  { id: 'carne', purchaseCost: 30 },
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

test('X-Burger cost impact projects margin and suggested price without mutating source catalog', () => {
  const before = structuredClone(catalog);
  const impact = calculateProductCostImpact(
    catalog,
    composition,
    'carne',
    40,
    29.5,
    40
  );

  assert.ok(impact);
  assert.equal(roundCurrency(impact.currentUnitCost), 7.7);
  assert.equal(roundCurrency(impact.projectedUnitCost), 9.1);
  assert.equal(roundCurrency(impact.unitCostDelta), 1.4);
  assert.equal(roundCurrency(impact.unitCostDeltaPercent ?? -1), 18.18);
  assert.equal(roundCurrency(impact.currentMarginPercent ?? -1), 73.9);
  assert.equal(roundCurrency(impact.projectedMarginPercent ?? -1), 69.15);
  assert.equal(roundCurrency(impact.currentSuggestedPrice ?? -1), 12.83);
  assert.equal(roundCurrency(impact.projectedSuggestedPrice ?? -1), 15.17);
  assert.deepEqual(catalog, before);
});

test('cost impact refuses invalid hypothetical cost or ingredient outside the composition', () => {
  assert.equal(
    calculateProductCostImpact(catalog, composition, 'carne', 0, 29.5, 40),
    null
  );
  assert.equal(
    calculateProductCostImpact(catalog, composition, 'molho', 10, 29.5, 40),
    null
  );
});

test('pricing panel labels impact simulation as non-persistent', () => {
  const source = readFileSync(
    new URL('../src/components/store/ProductPricingPanel.tsx', import.meta.url),
    'utf8'
  );
  assert.match(source, /Simular impacto de custo/);
  assert.match(source, /não salva o custo/i);
  assert.match(source, /não altera estoque/i);
  assert.match(source, /não muda o preço de venda/i);
  assert.match(source, /calculateProductCostImpact/);
});
