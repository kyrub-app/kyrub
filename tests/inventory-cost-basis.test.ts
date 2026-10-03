import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  applyMovingAverageInventoryIntake,
  applyMovingAverageInventoryOutflow,
  normalizeInventoryCostBasis,
  restoreInventoryAtHistoricalCost,
} from '../shared/inventoryCostBasis.js';

const now = '2026-09-30T18:00:00.000Z';

const inventoryItem = (overrides: Record<string, unknown> = {}) => ({
  currentQuantity: 10,
  purchaseCost: 10,
  ...overrides,
});

describe('moving weighted average inventory cost basis', () => {
  test('legacy purchaseCost seeds existing stock without inventing another value', () => {
    const basis = normalizeInventoryCostBasis(inventoryItem());

    assert.equal(basis.costBasisStatus, 'complete');
    assert.equal(basis.averageUnitCostMinor, 1000);
    assert.equal(basis.lastPurchaseUnitCostMinor, 1000);
    assert.equal(basis.inventoryValueMinor, 10000);
    assert.equal(basis.costBasisSource, 'legacy_purchase_cost_seed');
  });

  test('priced receipt recalculates moving average and preserves last purchase cost separately', () => {
    const result = applyMovingAverageInventoryIntake(inventoryItem(), {
      quantity: 10,
      resultingQuantity: 20,
      unitCostMinor: 2000,
      now,
      source: 'purchase_receipt',
    });

    assert.equal(result.item.currentQuantity, 10);
    assert.equal(result.item.purchaseCost, 20);
    assert.equal(result.item.costBasisStatus, 'complete');
    assert.equal(result.item.inventoryValueMinor, 30000);
    assert.equal(result.item.averageUnitCostMinor, 1500);
    assert.equal(result.item.lastPurchaseUnitCostMinor, 2000);
    assert.equal(result.snapshot.inventoryValueBeforeMinor, 10000);
    assert.equal(result.snapshot.inventoryValueAfterMinor, 30000);
    assert.equal(result.snapshot.totalCostMinor, 20000);
  });

  test('outflow freezes CMV and later cancellation restores the historical sale cost', () => {
    const firstIntake = applyMovingAverageInventoryIntake(inventoryItem(), {
      quantity: 10,
      resultingQuantity: 20,
      unitCostMinor: 2000,
      now,
      source: 'purchase_receipt',
    });
    const stocked = { ...firstIntake.item, currentQuantity: 20 };

    const sale = applyMovingAverageInventoryOutflow(stocked, {
      quantity: 2,
      resultingQuantity: 18,
      now,
    });
    assert.equal(sale.snapshot.unitCostMinor, 1500);
    assert.equal(sale.snapshot.totalCostMinor, 3000);
    assert.equal(sale.item.inventoryValueMinor, 27000);

    const secondIntake = applyMovingAverageInventoryIntake(
      { ...sale.item, currentQuantity: 18 },
      {
        quantity: 10,
        resultingQuantity: 28,
        unitCostMinor: 2100,
        now,
        source: 'purchase_receipt',
      }
    );
    assert.equal(secondIntake.item.inventoryValueMinor, 48000);
    assert.equal(secondIntake.item.averageUnitCostMinor, 1714.285714);
    assert.equal(secondIntake.item.lastPurchaseUnitCostMinor, 2100);

    const cancellation = restoreInventoryAtHistoricalCost(
      { ...secondIntake.item, currentQuantity: 28 },
      {
        quantity: 2,
        resultingQuantity: 30,
        historicalUnitCostMinor: sale.snapshot.unitCostMinor,
        historicalTotalCostMinor: sale.snapshot.totalCostMinor,
        now,
      }
    );

    assert.equal(cancellation.item.inventoryValueMinor, 51000);
    assert.equal(cancellation.item.averageUnitCostMinor, 1700);
    assert.equal(cancellation.item.lastPurchaseUnitCostMinor, 2100);
    assert.equal(cancellation.snapshot.totalCostMinor, 3000);
  });

  test('unknown-cost positive intake marks valuation incomplete instead of treating it as zero', () => {
    const result = applyMovingAverageInventoryIntake(inventoryItem(), {
      quantity: 5,
      resultingQuantity: 15,
      unitCostMinor: null,
      now,
      source: 'purchase_receipt',
    });

    assert.equal(result.item.costBasisStatus, 'incomplete');
    assert.equal(result.item.averageUnitCostMinor, null);
    assert.equal(result.item.inventoryValueMinor, null);
    assert.equal(result.snapshot.totalCostMinor, null);
    assert.equal(result.item.purchaseCost, 10);
  });

  test('priced intake into an empty stock establishes a fresh complete basis', () => {
    const result = applyMovingAverageInventoryIntake(
      inventoryItem({ currentQuantity: 0, purchaseCost: 0 }),
      {
        quantity: 4,
        resultingQuantity: 4,
        unitCostMinor: 1250,
        now,
        source: 'purchase_receipt',
      }
    );

    assert.equal(result.item.costBasisStatus, 'complete');
    assert.equal(result.item.inventoryValueMinor, 5000);
    assert.equal(result.item.averageUnitCostMinor, 1250);
    assert.equal(result.item.lastPurchaseUnitCostMinor, 1250);
    assert.equal(result.item.purchaseCost, 12.5);
  });

  test('fractional physical quantities keep total value in integer cents', () => {
    const result = applyMovingAverageInventoryIntake(
      inventoryItem({ currentQuantity: 0, purchaseCost: 0 }),
      {
        quantity: 1.5,
        resultingQuantity: 1.5,
        unitCostMinor: 1250,
        now,
        source: 'purchase_receipt',
      }
    );

    assert.equal(result.item.inventoryValueMinor, 1875);
    assert.equal(result.item.averageUnitCostMinor, 1250);
  });

  test('an already incomplete positive balance remains incomplete after a later priced receipt', () => {
    const result = applyMovingAverageInventoryIntake(
      inventoryItem({
        currentQuantity: 5,
        purchaseCost: 0,
        costBasisStatus: 'incomplete',
        averageUnitCostMinor: null,
        inventoryValueMinor: null,
      }),
      {
        quantity: 5,
        resultingQuantity: 10,
        unitCostMinor: 1500,
        now,
        source: 'purchase_receipt',
      }
    );

    assert.equal(result.item.costBasisStatus, 'incomplete');
    assert.equal(result.item.inventoryValueMinor, null);
    assert.equal(result.item.averageUnitCostMinor, null);
    assert.equal(result.item.lastPurchaseUnitCostMinor, 1500);
    assert.equal(result.item.purchaseCost, 15);
  });
});
