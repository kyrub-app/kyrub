import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { KyrubErpContextSnapshot } from '../shared/kyrubErpContext';
import {
  isKyrubOrderDetailReadIntent,
  resolveKyrubOrderDetailRead,
} from '../shared/kyrubOrderReadIntent';

const context: KyrubErpContextSnapshot = {
  source: 'authenticated_client_snapshot',
  generatedAt: new Date(0).toISOString(),
  store: null,
  products: [],
  productCount: 0,
  productsTruncated: false,
  pendingOrders: [
    {
      id: 'customer-order-user-1001',
      status: 'accepted',
      paymentStatus: 'paid',
      fulfillmentType: 'delivery',
      total: 29.5,
      itemCount: 1,
      createdAt: '2026-08-19T12:00:00.000Z',
    },
    {
      id: 'customer-order-user-1002',
      status: 'preparing',
      paymentStatus: 'unpaid',
      fulfillmentType: 'pickup',
      total: 45,
      itemCount: 2,
      createdAt: '2026-08-19T12:10:00.000Z',
    },
  ],
  pendingOrderCount: 2,
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

test('order detail intent stays separate from operational mutations', () => {
  assert.equal(isKyrubOrderDetailReadIntent('O que tem no pedido customer-order-user-1001?'), true);
  assert.equal(isKyrubOrderDetailReadIntent('Quanto deu o pedido customer-order-user-1001?'), true);
  assert.equal(isKyrubOrderDetailReadIntent('Aceite o pedido customer-order-user-1001'), false);
  assert.equal(isKyrubOrderDetailReadIntent('Cancele o pedido customer-order-user-1001 porque cliente pediu'), false);
});

test('explicit order id can resolve a historical order outside the active snapshot', () => {
  const result = resolveKyrubOrderDetailRead(
    'Mostre os detalhes do pedido customer-order-user-9999',
    context
  );
  assert.equal(result.kind, 'resolved');
  if (result.kind !== 'resolved') return;
  assert.equal(result.orderId, 'customer-order-user-9999');
  assert.equal(result.order, undefined);
  assert.equal(result.focus, 'overview');
});

test('ambiguous active-order read asks for an order instead of guessing', () => {
  const result = resolveKyrubOrderDetailRead('Mostre os detalhes do pedido', context);
  assert.equal(result.kind, 'needs_order');
  if (result.kind !== 'needs_order') return;
  assert.equal(result.orders.length, 2);
});

test('read focus distinguishes items, payment, fulfillment and customer note', () => {
  const cases = [
    ['Quais itens do pedido customer-order-user-1001?', 'items'],
    ['Qual o pagamento do pedido customer-order-user-1001?', 'payment'],
    ['Qual a entrega do pedido customer-order-user-1001?', 'fulfillment'],
    ['Qual a observação do pedido customer-order-user-1001?', 'customer_note'],
  ] as const;
  for (const [message, expected] of cases) {
    const result = resolveKyrubOrderDetailRead(message, context);
    assert.equal(result.kind, 'resolved');
    if (result.kind === 'resolved') assert.equal(result.focus, expected);
  }
});

test('order detail service reads only the authenticated owner path and omits buyer email from response shape', () => {
  const service = readFileSync('src/actions/orderReadActionService.ts', 'utf8');
  assert.match(service, /getCustomerOrderDocumentPath\(user\.uid, normalizedOrderId\)/);
  assert.match(service, /order\.storeId !== user\.uid/);
  assert.doesNotMatch(service, /buyerEmail:/);
});

test('runtime exposes location only in fulfillment-focused answer', () => {
  const runtime = readFileSync('src/ai/catalogDraftRuntime.ts', 'utf8');
  assert.match(runtime, /isKyrubOrderDetailReadIntent/);
  assert.match(runtime, /readKyrubOrderDetails/);
  assert.match(runtime, /fulfillmentLabel\(order, false\)/);
  assert.match(runtime, /fulfillmentLabel\(order, true\)/);
  assert.match(runtime, /Não encontrei o pedido .* nos pedidos desta loja/);
});
