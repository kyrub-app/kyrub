import assert from 'node:assert/strict';
import test from 'node:test';
import type { CustomerOrder } from '../src/utils/customerOrders';
import {
  buildCustomerTableCards,
  getCustomerTableStateLabel,
} from '../src/utils/customerTables';

const makeOrder = (
  overrides: Partial<CustomerOrder> = {}
): CustomerOrder => ({
  id: 'order-1',
  storeId: 'store-1',
  buyerId: 'buyer-1',
  buyerName: 'Cliente Um',
  buyerEmail: 'cliente@example.com',
  fulfillmentType: 'dine_in',
  deliveryAddress: '',
  tableCode: '12',
  customerNote: '',
  items: [
    {
      lineId: 'order-1-line-1',
      productId: 'product-1',
      name: 'Produto',
      price: 20,
      quantity: 2,
      paidQuantity: 0,
      transferredQuantity: 0,
      note: '',
      image: '',
      isService: false,
    },
  ],
  subtotal: 40,
  total: 40,
  status: 'pending',
  paymentStatus: 'unpaid',
  source: 'customer',
  operatorId: '',
  operatorName: '',
  createdAt: '2026-07-21T20:00:00.000Z',
  updatedAt: '2026-07-21T20:00:00.000Z',
  ...overrides,
});

test('groups active dine-in orders into one card per normalized table code', () => {
  const cards = buildCustomerTableCards([
    makeOrder(),
    makeOrder({
      id: 'order-2',
      buyerId: 'buyer-2',
      buyerName: 'Cliente Dois',
      tableCode: ' 12 ',
      status: 'accepted',
      total: 15,
      subtotal: 15,
      items: [
        {
          lineId: 'order-2-line-1',
          productId: 'product-2',
          name: 'Outro produto',
          price: 15,
          quantity: 1,
          paidQuantity: 0,
          transferredQuantity: 0,
          note: '',
          image: '',
          isService: false,
        },
      ],
      createdAt: '2026-07-21T20:05:00.000Z',
      updatedAt: '2026-07-21T20:06:00.000Z',
    }),
  ]);

  assert.equal(cards.length, 1);
  assert.equal(cards[0].tableCode, '12');
  assert.equal(cards[0].orderCount, 2);
  assert.equal(cards[0].pendingCount, 1);
  assert.equal(cards[0].itemCount, 3);
  assert.equal(cards[0].total, 55);
  assert.deepEqual(cards[0].buyerNames, ['Cliente Dois', 'Cliente Um']);
  assert.equal(cards[0].state, 'pending');
  assert.equal(cards[0].openedAt, '2026-07-21T20:00:00.000Z');
});

test('ignores delivery, pickup and terminal dine-in orders', () => {
  const cards = buildCustomerTableCards([
    makeOrder({ id: 'delivery', fulfillmentType: 'delivery', tableCode: '' }),
    makeOrder({ id: 'pickup', fulfillmentType: 'pickup', tableCode: '' }),
    makeOrder({ id: 'completed', status: 'completed' }),
    makeOrder({ id: 'cancelled', status: 'cancelled' }),
    makeOrder({ id: 'rejected', status: 'rejected' }),
  ]);

  assert.deepEqual(cards, []);
});

test('prioritizes alerting tables before numeric table order', () => {
  const cards = buildCustomerTableCards([
    makeOrder({ id: 'accepted-2', tableCode: '2', status: 'accepted' }),
    makeOrder({ id: 'preparing-10', tableCode: '10', status: 'preparing' }),
    makeOrder({ id: 'ready-5', tableCode: '5', status: 'ready' }),
    makeOrder({ id: 'pending-20', tableCode: '20', status: 'pending' }),
  ]);

  assert.deepEqual(
    cards.map(card => `${card.tableCode}:${card.state}`),
    ['20:pending', '5:ready', '10:preparing', '2:accepted']
  );
});

test('uses the highest-priority operational state within a shared table', () => {
  const cards = buildCustomerTableCards([
    makeOrder({ id: 'accepted', status: 'accepted' }),
    makeOrder({ id: 'preparing', status: 'preparing' }),
    makeOrder({ id: 'ready', status: 'ready' }),
  ]);

  assert.equal(cards[0].state, 'ready');
  assert.equal(getCustomerTableStateLabel(cards[0].state, 0), 'Pronto');
});

test('shows only unpaid and non-transferred quantities in the table card', () => {
  const cards = buildCustomerTableCards([
    makeOrder({
      status: 'accepted',
      items: [
        {
          lineId: 'line-1',
          productId: 'product-1',
          name: 'Produto',
          price: 20,
          quantity: 4,
          paidQuantity: 1,
          transferredQuantity: 1,
          note: '',
          image: '',
          isService: false,
        },
      ],
    }),
  ]);

  assert.equal(cards[0].itemCount, 2);
  assert.equal(cards[0].total, 40);
});
