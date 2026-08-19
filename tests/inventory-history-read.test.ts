import assert from 'node:assert/strict';
import test from 'node:test';
import type { KyrubErpContextSnapshot } from '../shared/kyrubErpContext';
import {
  isKyrubInventoryHistoryReadIntent,
  resolveKyrubInventoryHistoryRead,
} from '../shared/kyrubiaInventoryHistory';

const context: KyrubErpContextSnapshot = {
  source: 'authenticated_client_snapshot',
  generatedAt: '2026-08-19T15:00:00.000Z',
  store: null,
  products: [],
  productCount: 0,
  productsTruncated: false,
  inventory: [],
  inventoryCount: 0,
  inventoryTruncated: false,
  inventoryMovements: [
    {
      id: 'movement-loss-1',
      kind: 'loss',
      mode: 'decrement',
      sourceKind: 'loss_report',
      sourceLabel: '',
      entryCount: 1,
      createdAt: '2026-08-19T14:00:00.000Z',
      lines: [{
        itemId: 'carne',
        name: 'Carne bovina Premium',
        unit: 'kg',
        quantityDelta: -0.3,
        previousQuantity: 1.4,
        resultingQuantity: 1.1,
      }],
      linesTruncated: false,
    },
    {
      id: 'movement-intake-1',
      kind: 'intake',
      mode: 'increment',
      sourceKind: 'inventory_intake_text',
      sourceLabel: '',
      entryCount: 1,
      createdAt: '2026-08-19T13:00:00.000Z',
      lines: [{
        itemId: 'pao',
        name: 'Pão para hambúrguer',
        unit: 'un',
        quantityDelta: 10,
        previousQuantity: 0,
        resultingQuantity: 10,
      }],
      linesTruncated: false,
    },
  ],
  inventoryMovementCount: 2,
  inventoryMovementsTruncated: true,
  pendingOrders: [],
  pendingOrderCount: 0,
  ordersTruncated: false,
  lowStockThreshold: 5,
  availability: {
    store: true,
    products: true,
    inventory: true,
    inventoryMovements: true,
    orders: true,
  },
  warnings: [],
};

test('history intent is distinct from a current stock read', () => {
  assert.equal(
    isKyrubInventoryHistoryReadIntent('Quais foram as últimas perdas do estoque?'),
    true
  );
  assert.equal(
    isKyrubInventoryHistoryReadIntent('Quanto tenho de carne no estoque?'),
    false
  );
});

test('history read filters semantic movement kind without Gemini', () => {
  const result = resolveKyrubInventoryHistoryRead(
    'Quais foram as últimas perdas do estoque?',
    context
  );
  assert.ok(result);
  assert.equal(result.matchedCount, 1);
  assert.match(result.reply, /Perda\/desperdício/);
  assert.match(result.reply, /Carne bovina Premium/);
  assert.doesNotMatch(result.reply, /Pão para hambúrguer/);
});

test('history read shows authoritative before delta and after quantities', () => {
  const result = resolveKyrubInventoryHistoryRead(
    'Mostre as movimentações recentes do estoque',
    context
  );
  assert.ok(result);
  assert.match(result.reply, /-0,3 kg/);
  assert.match(result.reply, /1,4 → 1,1 kg/);
  assert.match(result.reply, /\+10 un/);
  assert.match(result.reply, /0 → 10 un/);
});

test('history read reports recent-window truncation explicitly', () => {
  const result = resolveKyrubInventoryHistoryRead(
    'Liste as movimentações recentes do estoque',
    context
  );
  assert.ok(result);
  assert.match(result.reply, /podem existir movimentações mais antigas/i);
});

test('history read fails closed when movement snapshot is unavailable', () => {
  const unavailable: KyrubErpContextSnapshot = {
    ...context,
    inventoryMovements: undefined,
    availability: { ...context.availability, inventoryMovements: false },
  };
  const result = resolveKyrubInventoryHistoryRead(
    'Liste o histórico do estoque',
    unavailable
  );
  assert.ok(result);
  assert.match(result.reply, /temporariamente indisponível/i);
});
