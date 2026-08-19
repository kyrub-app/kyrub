import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { KyrubErpContextSnapshot } from '../shared/kyrubErpContext';
import { buildKyrubProductCompositionProposal } from '../shared/kyrubProductCompositionProposal';
import { isKyrubAiActionProposal } from '../src/ai/actionEvents';

const context: KyrubErpContextSnapshot = {
  source: 'authenticated_client_snapshot',
  generatedAt: new Date(0).toISOString(),
  store: null,
  products: [
    {
      id: 'product-xburger',
      name: '002 X-BURGER',
      category: 'BURGERS ARTESANAIS',
      price: 29.5,
      stock: 0,
      isService: false,
      hasDescription: true,
      hasImage: false,
    },
  ],
  productCount: 1,
  productsTruncated: false,
  inventory: [
    {
      id: 'inv-bread',
      name: 'Pão para hambúrguer',
      unit: 'un',
      currentQuantity: 10,
      minimumQuantity: 0,
      purchaseCost: 1,
      supplier: '',
      updatedAt: '',
    },
    {
      id: 'inv-beef',
      name: 'Carne bovina Premium',
      unit: 'kg',
      currentQuantity: 2,
      minimumQuantity: 0,
      purchaseCost: 30,
      supplier: '',
      updatedAt: '',
    },
  ],
  inventoryCount: 2,
  inventoryTruncated: false,
  pendingOrders: [],
  pendingOrderCount: 0,
  ordersTruncated: false,
  lowStockThreshold: 5,
  availability: {
    store: true,
    products: true,
    inventory: true,
    orders: true,
  },
  warnings: [],
};

test('composition builder resolves real product and inventory ids and converts g to kg', () => {
  const result = buildKyrubProductCompositionProposal(
    'Crie a ficha técnica do X-Burger. Rendimento: 1 un\n1 un Pão para hambúrguer\n140 g Carne bovina Premium',
    'conversation-1',
    context
  );

  assert.equal(result.kind, 'proposal');
  if (result.kind !== 'proposal') return;
  assert.equal(result.proposal.productId, 'product-xburger');
  assert.equal(result.proposal.yieldQuantity, 1);
  assert.deepEqual(result.proposal.lines.map(line => [line.inventoryItemId, line.quantity, line.unit]), [
    ['inv-bread', 1, 'un'],
    ['inv-beef', 0.14, 'kg'],
  ]);
});

test('composition builder refuses to invent a missing product or ingredient', () => {
  assert.equal(
    buildKyrubProductCompositionProposal(
      'Crie a ficha técnica do produto Fantasma\n1 un Pão para hambúrguer',
      'conversation-2',
      context
    ).kind,
    'needs_product'
  );

  assert.equal(
    buildKyrubProductCompositionProposal(
      'Crie a ficha técnica do X-Burger\n1 un Ingrediente que não existe',
      'conversation-3',
      context
    ).kind,
    'needs_lines'
  );
});

test('composition builder rejects the whole recipe when any ingredient line is unresolved', () => {
  assert.equal(
    buildKyrubProductCompositionProposal(
      'Crie a ficha técnica do X-Burger\n1 un Pão para hambúrguer\n140 g Carne bovina Premium\n1 un Molho inexistente',
      'conversation-partial',
      context
    ).kind,
    'needs_lines'
  );
});

test('central proposal validator accepts semantic inventory modes and product composition', () => {
  assert.equal(isKyrubAiActionProposal({
    id: 'loss-1',
    type: 'adjust_inventory',
    mode: 'decrement',
    movementKind: 'loss',
    entries: [{ name: 'Carne bovina Premium', quantity: 0.3, unit: 'kg' }],
    source: { kind: 'loss_report' },
    requiresConfirmation: true,
  }), true);

  assert.equal(isKyrubAiActionProposal({
    id: 'correction-1',
    type: 'adjust_inventory',
    mode: 'set',
    movementKind: 'correction',
    entries: [{ name: 'Pão para hambúrguer', quantity: 0, unit: 'un' }],
    source: { kind: 'physical_count' },
    requiresConfirmation: true,
  }), true);

  assert.equal(isKyrubAiActionProposal({
    id: 'composition-1',
    type: 'set_product_composition',
    productId: 'product-xburger',
    productName: '002 X-BURGER',
    kind: 'recipe',
    yieldQuantity: 1,
    lines: [{ inventoryItemId: 'inv-bread', inventoryItemName: 'Pão para hambúrguer', quantity: 1, unit: 'un' }],
    requiresConfirmation: true,
  }), true);
});

test('composition confirmation bridge is mounted in authenticated app', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const bridge = readFileSync(
    new URL('../src/components/KyrubAiProductCompositionActionBridge.tsx', import.meta.url),
    'utf8'
  );
  assert.match(app, /KyrubAiProductCompositionActionBridge/);
  assert.match(bridge, /set_product_composition/);
  assert.match(bridge, /Salvar ficha/);
  assert.match(bridge, /saldo dos insumos não é alterado/i);
});

test('catalog draft runtime routes composition intent through authoritative ERP and official action event', () => {
  const runtime = readFileSync(
    new URL('../src/ai/catalogDraftRuntime.ts', import.meta.url),
    'utf8'
  );
  assert.match(runtime, /isKyrubProductCompositionIntent/);
  assert.match(runtime, /buildKyrubProductCompositionProposal/);
  assert.match(runtime, /readKyrubErpContext\(user, \{ force: true \}\)/);
  assert.match(runtime, /emitKyrubAiActionProposal/);
  assert.match(runtime, /enabledActions: \['set_product_composition'\]/);
});
