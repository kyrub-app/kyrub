import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import {
  applyInventoryConsumptionLines,
  type InventoryCatalogRecord,
  type InventoryConsumptionLine,
} from '../shared/inventoryConsumption.js';
import { applyMovingAverageInventoryIntake } from '../shared/inventoryCostBasis.js';

const orderService = readFileSync('server/inventory/orderInventoryService.ts', 'utf8');
const adjustmentService = readFileSync('server/inventory/orderInventoryAdjustment.ts', 'utf8');
const movementLedger = readFileSync('server/inventory/orderInventoryMovementLedger.ts', 'utf8');
const movementReadService = readFileSync('server/inventory/storeInventoryMovementService.ts', 'utf8');
const movementUi = readFileSync('src/components/store/StoreInventoryMovementTimeline.tsx', 'utf8');

describe('order inventory economic snapshots', () => {
  test('sale line freezes its moving-average CMV and cancellation restores that exact historical cost', () => {
    const catalog: InventoryCatalogRecord[] = [{
      id: 'ingredient-1',
      name: 'Ingrediente',
      unit: 'un',
      currentQuantity: 20,
      minimumQuantity: 2,
      purchaseCost: 15,
      supplier: '',
      updatedAt: '',
    }];
    const lines: InventoryConsumptionLine[] = [{
      inventoryItemId: 'ingredient-1',
      inventoryItemName: 'Ingrediente',
      unit: 'un',
      quantity: 2,
      beforeQuantity: 20,
      afterQuantity: 18,
      productIds: ['product-1'],
    }];

    const consumed = applyInventoryConsumptionLines(catalog, lines, 'consume');
    assert.equal(lines[0]?.costBasisStatus, 'complete');
    assert.equal(lines[0]?.unitCostMinor, 1500);
    assert.equal(lines[0]?.totalCostMinor, 3000);
    assert.equal(consumed[0]?.inventoryValueMinor, 27000);

    const laterReceipt = applyMovingAverageInventoryIntake(consumed[0]!, {
      quantity: 10,
      resultingQuantity: 28,
      unitCostMinor: 2100,
      source: 'purchase_receipt',
      now: '2026-09-30T18:00:00.000Z',
    });
    const afterReceipt: InventoryCatalogRecord[] = [{
      ...laterReceipt.item,
      currentQuantity: 28,
      updatedAt: '',
    }];
    assert.equal(afterReceipt[0]?.averageUnitCostMinor, 1714.285714);

    const restored = applyInventoryConsumptionLines(afterReceipt, lines, 'restore');
    assert.equal(restored[0]?.currentQuantity, 30);
    assert.equal(restored[0]?.inventoryValueMinor, 51000);
    assert.equal(restored[0]?.averageUnitCostMinor, 1700);
    assert.equal(restored[0]?.lastPurchaseUnitCostMinor, 2100);
  });

  test('order ledgers persist and reread cost snapshots before historical restoration', () => {
    assert.match(orderService, /unitCostMinor/);
    assert.match(orderService, /totalCostMinor/);
    assert.match(orderService, /lines,/);
    assert.match(orderService, /applyInventoryConsumptionLines\(catalog, lines, 'restore'\)/);
    assert.match(adjustmentService, /unitCostMinor/);
    assert.match(adjustmentService, /totalCostMinor/);
    assert.match(adjustmentService, /applyInventoryConsumptionLines\([\s\S]*'restore'/);
  });

  test('generic order movements carry CMV and before-after valuation without becoming a second stock mutator', () => {
    assert.match(movementLedger, /costBasisStatus/);
    assert.match(movementLedger, /unitCostMinor/);
    assert.match(movementLedger, /totalCostMinor/);
    assert.match(movementLedger, /inventoryValueBeforeMinor/);
    assert.match(movementLedger, /inventoryValueAfterMinor/);
    assert.doesNotMatch(movementLedger, /currentQuantity\s*:/);
  });

  test('authorized Stock timeline exposes total and per-item moving-average valuation', () => {
    assert.match(movementReadService, /knownInventoryValueMinor/);
    assert.match(movementReadService, /completeItemCount/);
    assert.match(movementReadService, /incompleteItemCount/);
    assert.match(movementReadService, /items: valuationItems/);
    assert.match(movementUi, /Razão físico \+ econômico/);
    assert.match(movementUi, /Valor conhecido do estoque/);
    assert.match(movementUi, /Posição econômica atual/);
    assert.match(movementUi, /Custo médio/);
    assert.match(movementUi, /Última compra/);
    assert.match(movementUi, /CMV/);
    assert.match(movementUi, /não atribui custo zero automaticamente/);
  });
});
