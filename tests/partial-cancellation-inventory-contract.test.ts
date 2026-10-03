import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  applyInventoryConsumptionLines,
  type InventoryCatalogRecord,
  type InventoryCompositionRecord,
} from '../shared/inventoryConsumption.js';
import {
  buildOrderInventoryConsumptionWithOptions,
  type OptionAwareInventoryOrderItem,
  type OptionInventoryImpactRecord,
} from '../shared/optionInventoryImpact.js';

const read = (path: string): string =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const cancellationService = read('server/payments/orderItemCancellationService.ts');
const inventoryService = read('server/inventory/orderInventoryService.ts');

const catalog = (): InventoryCatalogRecord[] => [
  {
    id: 'bread',
    name: 'Pão',
    unit: 'un',
    currentQuantity: 10,
    minimumQuantity: 0,
    purchaseCost: 0,
    supplier: '',
    updatedAt: '',
  },
  {
    id: 'patty',
    name: 'Hambúrguer',
    unit: 'un',
    currentQuantity: 10,
    minimumQuantity: 0,
    purchaseCost: 0,
    supplier: '',
    updatedAt: '',
  },
  {
    id: 'bacon',
    name: 'Bacon',
    unit: 'porção',
    currentQuantity: 10,
    minimumQuantity: 0,
    purchaseCost: 0,
    supplier: '',
    updatedAt: '',
  },
  {
    id: 'squeeze-unit',
    name: 'Squeeze',
    unit: 'un',
    currentQuantity: 10,
    minimumQuantity: 0,
    purchaseCost: 0,
    supplier: '',
    updatedAt: '',
  },
];

const compositions: Record<string, InventoryCompositionRecord> = {
  burger: {
    kind: 'recipe',
    yieldQuantity: 1,
    lines: [
      { inventoryItemId: 'bread', quantity: 1 },
      { inventoryItemId: 'patty', quantity: 1 },
    ],
    updatedAt: '',
  },
  squeeze: {
    kind: 'bundle',
    yieldQuantity: 1,
    lines: [{ inventoryItemId: 'squeeze-unit', quantity: 1 }],
    updatedAt: '',
  },
};

const optionImpacts: OptionInventoryImpactRecord[] = [
  {
    scopeType: 'product',
    scopeId: 'burger',
    groupId: 'extra',
    choiceId: 'bacon',
    lines: [{ inventoryItemId: 'bacon', quantity: 1 }],
  },
];

const remainingItems: OptionAwareInventoryOrderItem[] = [
  {
    productId: 'burger',
    name: 'X-Burger',
    quantity: 1,
    selectedOptions: [{ groupId: 'extra', choiceId: 'bacon' }],
  },
  {
    productId: 'squeeze',
    name: 'Squeeze',
    quantity: 1,
  },
];

test('partial cancellation is restricted to pending and rewrites the canonical order before inventory consumption', () => {
  assert.match(cancellationService, /clean\(order\.status\) !== 'pending'/);
  assert.match(cancellationService, /const remainingQuantity = currentQuantity - cancelQuantity/);
  assert.match(cancellationService, /items: nextItems/);
  assert.match(cancellationService, /transaction\.set\(orderRef, orderPatch, \{ merge: true \}\)/);
  assert.match(cancellationService, /stores\/\$\{canonicalStoreId\}\/orders\/\$\{input\.orderId\}/);
});

test('inventory consumption reads the current order items after partial cancellation', () => {
  const parseOrderIndex = inventoryService.indexOf('const order = parseOrder(orderSnapshot.data())');
  const consumeIndex = inventoryService.indexOf('buildOrderInventoryConsumptionWithOptions(');
  assert.ok(parseOrderIndex >= 0, 'inventory transition must parse the current canonical order');
  assert.ok(consumeIndex >= 0, 'inventory transition must build consumption from order items');
  assert.match(inventoryService, /buildOrderInventoryConsumptionWithOptions\(\s*order\.items,/);
});

test('accepting the remaining order consumes only the remaining recipe, option impact, and physical product', () => {
  const lines = buildOrderInventoryConsumptionWithOptions(
    remainingItems,
    catalog(),
    compositions,
    { burger: 'Lanches > Hambúrgueres', squeeze: 'Produtos > Acessórios' },
    optionImpacts
  );

  assert.deepEqual(
    Object.fromEntries(lines.map(line => [line.inventoryItemId, line.quantity])),
    {
      bacon: 1,
      patty: 1,
      bread: 1,
      'squeeze-unit': 1,
    }
  );

  const after = applyInventoryConsumptionLines(catalog(), lines, 'consume');
  assert.deepEqual(
    Object.fromEntries(after.map(item => [item.id, item.currentQuantity])),
    {
      bread: 9,
      patty: 9,
      bacon: 9,
      'squeeze-unit': 9,
    }
  );
});

test('the pre-cancellation quantity would consume two burgers, proving the scoped cancellation changes the stock result', () => {
  const beforeCancellation: OptionAwareInventoryOrderItem[] = [
    { ...remainingItems[0], quantity: 2 },
    remainingItems[1],
  ];
  const lines = buildOrderInventoryConsumptionWithOptions(
    beforeCancellation,
    catalog(),
    compositions,
    { burger: 'Lanches > Hambúrgueres', squeeze: 'Produtos > Acessórios' },
    optionImpacts
  );
  assert.deepEqual(
    Object.fromEntries(lines.map(line => [line.inventoryItemId, line.quantity])),
    {
      bacon: 2,
      patty: 2,
      bread: 2,
      'squeeze-unit': 1,
    }
  );
});

test('inventory ledger makes repeated status processing idempotent and restores only a real prior consumption', () => {
  assert.match(inventoryService, /ledgerStatus === 'consumed' \|\| ledgerStatus === 'reversed' \|\| ledgerStatus === 'skipped'/);
  assert.match(inventoryService, /if \(ledgerStatus !== 'consumed'\)/);
  assert.match(inventoryService, /status: 'reversed'/);
  assert.match(inventoryService, /transaction\.create\(ledgerReference,/);
});
