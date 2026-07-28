import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import {
  applyInventoryConsumptionLines,
  buildOrderInventoryConsumption,
  parseInventoryConsumptionTrigger,
  shouldConsumeInventory,
  type InventoryCatalogRecord,
  type InventoryCompositionRecord,
} from '../shared/inventoryConsumption';

const catalog: InventoryCatalogRecord[] = [
  {
    id: 'flour',
    name: 'Farinha',
    unit: 'g',
    currentQuantity: 5000,
    minimumQuantity: 1000,
    purchaseCost: 0.01,
    supplier: '',
    updatedAt: '',
  },
  {
    id: 'cheese',
    name: 'Queijo',
    unit: 'g',
    currentQuantity: 1800,
    minimumQuantity: 500,
    purchaseCost: 0.04,
    supplier: '',
    updatedAt: '',
  },
];

const compositions: Record<string, InventoryCompositionRecord> = {
  pizza: {
    kind: 'recipe',
    yieldQuantity: 2,
    lines: [
      { inventoryItemId: 'flour', quantity: 600 },
      { inventoryItemId: 'cheese', quantity: 300 },
    ],
    updatedAt: '',
  },
  combo: {
    kind: 'bundle',
    yieldQuantity: 1,
    lines: [{ inventoryItemId: 'cheese', quantity: 100 }],
    updatedAt: '',
  },
};

const domainSource = readFileSync(
  'shared/inventoryConsumption.ts',
  'utf8'
);
const serviceSource = readFileSync(
  'server/inventory/orderInventoryService.ts',
  'utf8'
);
const routerSource = readFileSync(
  'server/inventory/orderInventoryRouter.ts',
  'utf8'
);
const workflowSource = readFileSync('src/utils/orderWorkflow.ts', 'utf8');
const ingressSource = readFileSync(
  'server/integrations/ninetyNineFoodIngressQueue.ts',
  'utf8'
);
const pollingSource = readFileSync(
  'server/integrations/ninetyNineFoodRouter.ts',
  'utf8'
);
const sweepSource = readFileSync(
  'server/inventory/recentOrderInventorySweep.ts',
  'utf8'
);
const serverSource = readFileSync('server.ts', 'utf8');

describe('order inventory consumption', () => {
  test('defaults to production start and supports alternate private triggers', () => {
    assert.equal(parseInventoryConsumptionTrigger(undefined), 'preparing');
    assert.equal(parseInventoryConsumptionTrigger('accepted'), 'accepted');
    assert.equal(parseInventoryConsumptionTrigger('completed'), 'completed');
    assert.equal(shouldConsumeInventory('preparing', 'accepted'), false);
    assert.equal(shouldConsumeInventory('preparing', 'preparing'), true);
    assert.equal(shouldConsumeInventory('preparing', 'completed'), true);
  });

  test('aggregates recipe and bundle consumption using yield', () => {
    const lines = buildOrderInventoryConsumption(
      [
        { productId: 'pizza', name: 'Pizza', quantity: 3, transferredQuantity: 0 },
        { productId: 'combo', name: 'Combo', quantity: 2, transferredQuantity: 0 },
      ],
      catalog,
      compositions
    );
    assert.deepEqual(
      lines.map(line => [line.inventoryItemId, line.quantity]),
      [
        ['flour', 900],
        ['cheese', 650],
      ]
    );
  });

  test('ignores transferred quantities to avoid double consumption', () => {
    const lines = buildOrderInventoryConsumption(
      [
        { productId: 'pizza', name: 'Pizza', quantity: 4, transferredQuantity: 2 },
      ],
      catalog,
      compositions
    );
    assert.deepEqual(
      lines.map(line => [line.inventoryItemId, line.quantity]),
      [
        ['flour', 600],
        ['cheese', 300],
      ]
    );
  });

  test('blocks production when any required component is insufficient', () => {
    assert.throws(
      () => buildOrderInventoryConsumption(
        [{ productId: 'pizza', name: 'Pizza', quantity: 20 }],
        catalog,
        compositions
      ),
      /Estoque insuficiente de “(?:Farinha|Queijo)”/
    );
  });

  test('consumes and restores the exact ledger snapshot', () => {
    const lines = buildOrderInventoryConsumption(
      [{ productId: 'pizza', name: 'Pizza', quantity: 2 }],
      catalog,
      compositions
    );
    const consumed = applyInventoryConsumptionLines(catalog, lines, 'consume');
    assert.equal(consumed.find(item => item.id === 'flour')?.currentQuantity, 4400);
    assert.equal(consumed.find(item => item.id === 'cheese')?.currentQuantity, 1500);
    const restored = applyInventoryConsumptionLines(consumed, lines, 'restore');
    assert.equal(restored.find(item => item.id === 'flour')?.currentQuantity, 5000);
    assert.equal(restored.find(item => item.id === 'cheese')?.currentQuantity, 1800);
  });

  test('status and stock update share one server transaction and one ledger', () => {
    assert.match(serviceSource, /runTransaction/);
    assert.match(serviceSource, /inventoryOrderConsumptions/);
    assert.match(serviceSource, /ledgerStatus === 'consumed'/);
    assert.match(serviceSource, /status: 'reversed'/);
    assert.match(serviceSource, /transaction\.create\(ledgerReference/);
    assert.match(serviceSource, /users\/\$\{tenantId\}\/private_store\/inventory/);
    assert.match(serviceSource, /publicProductsWithCalculatedStock/);
    assert.match(domainSource, /Estoque insuficiente/);
  });

  test('KDS changes use the authenticated backend instead of direct status writes', () => {
    assert.match(workflowSource, /\/api\/orders\/\$\{encodeURIComponent/);
    assert.match(workflowSource, /authorization: `Bearer/);
    assert.doesNotMatch(
      workflowSource.slice(
        workflowSource.indexOf('export const updateOrderStatusWithDecision'),
        workflowSource.indexOf('export const reviewAttendanceOrder')
      ),
      /runTransaction/
    );
    assert.match(routerSource, /transitionOrderStatusWithInventory/);
    assert.match(routerSource, /sendNinetyNineFoodOrderStatus/);
    assert.match(serverSource, /createOrderInventoryRouter/);
  });

  test('webhook and polling paths reconcile external orders without a browser', () => {
    assert.match(ingressSource, /reconcilePersistedOrderInventory/);
    assert.match(ingressSource, /internalOrderId\(externalOrderId\)/);
    assert.match(pollingSource, /reconcileTenantOrdersUpdatedSince/);
    assert.match(
      pollingSource,
      /reconcileConnectedNinetyNineFoodOrdersUpdatedSince/
    );
    assert.match(sweepSource, /inventoryReconciliationQueue/);
    assert.match(sweepSource, /drainInventoryReconciliationQueue/);
  });
});
