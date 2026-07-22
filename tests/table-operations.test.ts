import assert from 'node:assert/strict';
import test from 'node:test';
import type { Product } from '../src/types';
import {
  getCustomerOrderOutstandingTotal,
  type CustomerOrder,
} from '../src/utils/customerOrders';
import {
  applyTablePaymentSelections,
  applyTableTransferSelections,
  buildStaffTableOrder,
  getTableOpenLines,
} from '../src/utils/tableOperations';

const user = {
  uid: 'store-1',
  email: 'loja@example.com',
  displayName: 'Operador da Loja',
};

const product = (overrides: Partial<Product> = {}): Product => ({
  id: 'product-1',
  name: 'Café',
  description: '',
  price: 10,
  image: '',
  stock: 20,
  supplierId: 'store-1',
  category: 'Bebidas',
  ...overrides,
});

const staffOrder = (): CustomerOrder =>
  buildStaffTableOrder(
    user,
    {
      storeId: 'store-1',
      tableCode: '12',
      buyerName: '',
      customerNote: '',
      items: [
        { product: product(), quantity: 2, note: 'Sem açúcar' },
        {
          product: product({ id: 'product-2', name: 'Pão', price: 8 }),
          quantity: 1,
          note: '',
        },
      ],
    },
    1_700_000_000_000
  );

test('builds a staff order already accepted for the KDS', () => {
  const order = staffOrder();

  assert.equal(order.id, 'staff-order-store-1-1700000000000');
  assert.equal(order.tableCode, '12');
  assert.equal(order.status, 'accepted');
  assert.equal(order.source, 'staff');
  assert.equal(order.buyerName, 'Atendimento presencial');
  assert.equal(order.buyerEmail, '');
  assert.equal(order.operatorName, 'Operador da Loja');
  assert.equal(order.items[0].lineId, `${order.id}-line-1`);
  assert.equal(order.total, 28);
});

test('registers selected quantities and only closes the order when fully paid', () => {
  const order = staffOrder();
  const firstPayment = applyTablePaymentSelections(
    [order],
    '12',
    [{ orderId: order.id, lineId: order.items[0].lineId, quantity: 1 }],
    1_700_000_001_000
  );

  assert.equal(firstPayment.amount, 10);
  assert.equal(firstPayment.quantity, 1);
  assert.equal(firstPayment.updatedOrders[0].paymentStatus, 'partial');
  assert.equal(firstPayment.updatedOrders[0].status, 'accepted');
  assert.equal(getCustomerOrderOutstandingTotal(firstPayment.updatedOrders[0]), 18);

  const partiallyPaid = firstPayment.updatedOrders[0];
  const finalPayment = applyTablePaymentSelections(
    [partiallyPaid],
    '12',
    [
      {
        orderId: order.id,
        lineId: order.items[0].lineId,
        quantity: 1,
      },
      {
        orderId: order.id,
        lineId: order.items[1].lineId,
        quantity: 1,
      },
    ],
    1_700_000_002_000
  );

  assert.equal(finalPayment.amount, 18);
  assert.equal(finalPayment.updatedOrders[0].paymentStatus, 'paid');
  assert.equal(finalPayment.updatedOrders[0].status, 'completed');
  assert.equal(getCustomerOrderOutstandingTotal(finalPayment.updatedOrders[0]), 0);
});

test('transfers selected quantities and preserves the production stage', () => {
  const order = staffOrder();
  const transfer = applyTableTransferSelections(
    [order],
    '12',
    '7',
    [{ orderId: order.id, lineId: order.items[0].lineId, quantity: 1 }],
    { id: 'store-1', name: 'Operador da Loja' },
    1_700_000_003_000
  );

  assert.equal(transfer.amount, 10);
  assert.equal(transfer.updatedSourceOrders[0].items[0].transferredQuantity, 1);
  assert.equal(transfer.updatedSourceOrders[0].status, 'accepted');
  assert.equal(transfer.targetOrders.length, 1);
  assert.equal(transfer.targetOrders[0].tableCode, '7');
  assert.equal(transfer.targetOrders[0].items[0].quantity, 1);
  assert.equal(transfer.targetOrders[0].status, 'accepted');
  assert.equal(transfer.targetOrders[0].source, 'transfer');
});

test('rejects payment or transfer quantities above the open quantity', () => {
  const order = staffOrder();

  assert.throws(
    () =>
      applyTablePaymentSelections(
        [order],
        '12',
        [{ orderId: order.id, lineId: order.items[0].lineId, quantity: 3 }]
      ),
    /quantidade indisponível/i
  );

  assert.throws(
    () =>
      applyTableTransferSelections(
        [order],
        '12',
        '12',
        [{ orderId: order.id, lineId: order.items[0].lineId, quantity: 1 }],
        { id: 'store-1', name: 'Operador' }
      ),
    /destino diferente/i
  );
});

test('lists only quantities that are still available for payment or transfer', () => {
  const order = staffOrder();
  order.items[0] = {
    ...order.items[0],
    paidQuantity: 1,
    transferredQuantity: 0,
  };

  const lines = getTableOpenLines([order], '12');
  assert.equal(lines.length, 2);
  assert.equal(lines[0].availableQuantity, 1);
});
