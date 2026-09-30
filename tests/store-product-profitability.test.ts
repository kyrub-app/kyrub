import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import {
  applyInventoryConsumptionLines,
  buildOrderInventoryConsumption,
  type InventoryCatalogRecord,
  type InventoryCompositionRecord,
} from '../shared/inventoryConsumption';
import { buildOrderInventoryConsumptionWithOptions } from '../shared/optionInventoryImpact';
import {
  buildOrderProductCommercialSnapshots,
  buildOrderProductMarginTargetSnapshots,
  deriveStoreProductProfitabilityRows,
} from '../shared/orderProductProfitability';

const now = '2026-09-30T12:00:00.000Z';

const catalog = (): InventoryCatalogRecord[] => [{
  id: 'base',
  name: 'Base compartilhada',
  unit: 'kg',
  currentQuantity: 10,
  minimumQuantity: 0,
  purchaseCost: 10,
  supplier: 'Fornecedor',
  updatedAt: now,
  costBasisStatus: 'complete',
  averageUnitCostMinor: 1000,
  lastPurchaseUnitCostMinor: 1000,
  inventoryValueMinor: 10000,
  costBasisSource: 'purchase_receipt',
  costBasisUpdatedAt: now,
}];

const compositions: Record<string, InventoryCompositionRecord> = {
  produto_a: {
    kind: 'recipe',
    yieldQuantity: 1,
    lines: [{ inventoryItemId: 'base', quantity: 1 }],
    updatedAt: now,
  },
  produto_b: {
    kind: 'recipe',
    yieldQuantity: 1,
    lines: [{ inventoryItemId: 'base', quantity: 2 }],
    updatedAt: now,
  },
};

describe('product profitability allocation', () => {
  test('shared ingredient freezes exact consumed quantity and CMV per product', () => {
    const lines = buildOrderInventoryConsumption(
      [
        { productId: 'produto_a', name: 'Produto A', quantity: 1 },
        { productId: 'produto_b', name: 'Produto B', quantity: 1 },
      ],
      catalog(),
      compositions
    );

    assert.equal(lines.length, 1);
    assert.deepEqual(lines[0].productQuantityAllocations, [
      { productId: 'produto_a', quantity: 1 },
      { productId: 'produto_b', quantity: 2 },
    ]);

    applyInventoryConsumptionLines(catalog(), lines, 'consume');
    assert.equal(lines[0].totalCostMinor, 3000);
    assert.deepEqual(lines[0].productCostAllocations, [
      {
        productId: 'produto_a',
        quantity: 1,
        costBasisStatus: 'complete',
        totalCostMinor: 1000,
      },
      {
        productId: 'produto_b',
        quantity: 2,
        costBasisStatus: 'complete',
        totalCostMinor: 2000,
      },
    ]);
    assert.equal(
      lines[0].productCostAllocations?.reduce(
        (sum, allocation) => sum + (allocation.totalCostMinor ?? 0),
        0
      ),
      lines[0].totalCostMinor
    );
  });

  test('option inventory impact remains attributed to the product that selected it', () => {
    const inventory = [
      ...catalog(),
      {
        id: 'extra',
        name: 'Extra',
        unit: 'kg',
        currentQuantity: 10,
        minimumQuantity: 0,
        purchaseCost: 4,
        supplier: 'Fornecedor',
        updatedAt: now,
        costBasisStatus: 'complete' as const,
        averageUnitCostMinor: 400,
        lastPurchaseUnitCostMinor: 400,
        inventoryValueMinor: 4000,
        costBasisSource: 'purchase_receipt' as const,
        costBasisUpdatedAt: now,
      },
    ];
    const lines = buildOrderInventoryConsumptionWithOptions(
      [{
        productId: 'produto_a',
        name: 'Produto A',
        quantity: 2,
        selectedOptions: [{ groupId: 'adicional', choiceId: 'extra' }],
      }],
      inventory,
      compositions,
      { produto_a: 'Lanches > Hambúrgueres' },
      [{
        scopeType: 'product',
        scopeId: 'produto_a',
        groupId: 'adicional',
        choiceId: 'extra',
        lines: [{ inventoryItemId: 'extra', quantity: 0.5 }],
      }]
    );
    const extra = lines.find(line => line.inventoryItemId === 'extra');
    assert.ok(extra);
    assert.deepEqual(extra.productQuantityAllocations, [
      { productId: 'produto_a', quantity: 1 },
    ]);
  });

  test('commercial line, CMV and historical target produce realized product margin', () => {
    const commercial = buildOrderProductCommercialSnapshots([{
      productId: 'produto_a',
      name: 'Produto A',
      quantity: 1,
      transferredQuantity: 0,
      lineId: 'line-a',
      price: 30,
      discountAmount: 5,
    }]);
    const targets = buildOrderProductMarginTargetSnapshots(
      {
        produto_a: {
          targetMarginPercent: 40,
          updatedAt: '2026-09-30T10:00:00.000Z',
        },
      },
      ['produto_a']
    );
    const rows = deriveStoreProductProfitabilityRows({
      inventoryState: 'consumed',
      commercialLines: commercial,
      inventoryLines: [{
        inventoryItemId: 'base',
        inventoryItemName: 'Base',
        unit: 'kg',
        quantity: 1,
        beforeQuantity: 10,
        afterQuantity: 9,
        productIds: ['produto_a'],
        costBasisStatus: 'complete',
        unitCostMinor: 1000,
        totalCostMinor: 1000,
        productCostAllocations: [{
          productId: 'produto_a',
          quantity: 1,
          costBasisStatus: 'complete',
          totalCostMinor: 1000,
        }],
      }],
      marginTargets: targets,
    });

    assert.equal(rows.length, 1);
    assert.equal(rows[0].merchandiseGrossMinor, 3000);
    assert.equal(rows[0].storeDiscountMinor, 500);
    assert.equal(rows[0].merchandiseRevenueMinor, 2500);
    assert.equal(rows[0].saleCmvMinor, 1000);
    assert.equal(rows[0].grossContributionMinor, 1500);
    assert.equal(rows[0].realizedMarginPercent, 60);
    assert.equal(rows[0].targetMarginPercent, 40);
    assert.equal(rows[0].marginGapPercentagePoints, 20);
    assert.equal(rows[0].dataStatus, 'complete');
  });

  test('missing per-product CMV fails closed instead of dividing aggregate CMV heuristically', () => {
    const rows = deriveStoreProductProfitabilityRows({
      inventoryState: 'consumed',
      commercialLines: buildOrderProductCommercialSnapshots([{
        productId: 'produto_a',
        name: 'Produto A',
        quantity: 1,
        price: 30,
        discountAmount: 0,
      }]),
      inventoryLines: [],
      marginTargets: [],
    });
    assert.equal(rows[0].saleCmvMinor, null);
    assert.equal(rows[0].realizedMarginPercent, null);
    assert.equal(rows[0].dataStatus, 'partial');
    assert.ok(rows[0].issues.includes('cmv_evidence_missing'));
  });

  test('product profitability does not allocate order-level provider costs by arbitrary rule', () => {
    const source = readFileSync('shared/orderProductProfitability.ts', 'utf8');
    assert.doesNotMatch(source, /observedCosts|provider_processing|payment fee|mercado_pago/i);
    assert.match(source, /grossContributionMinor/);
    assert.match(source, /realizedMarginPercent/);
  });

  test('server reconciles product evidence only when revenue and CMV close against canonical order totals', () => {
    const service = readFileSync('server/payments/storeProductProfitabilityService.ts', 'utf8');
    const router = readFileSync('server/payments/storeOrderProfitabilityRouter.ts', 'utf8');
    assert.match(service, /inventoryOrderConsumptions/);
    assert.match(service, /commercialReconciles/);
    assert.match(service, /cmvReconciles/);
    assert.match(service, /productPricingSettings/);
    assert.match(service, /orderProductProfitability/);
    assert.match(service, /Date\.parse\(target\.updatedAt\).*Date\.parse\(occurredAt\)/s);
    assert.match(router, /router\.get\('\/products'/);
    assert.match(router, /reconcileStoreProductProfitability/);
  });
});
