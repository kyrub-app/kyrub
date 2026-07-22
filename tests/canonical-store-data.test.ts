import assert from 'node:assert/strict';
import test from 'node:test';
import type { CustomerOrder } from '../src/utils/customerOrders';
import {
  assertStoreIdIndependentFromOwner,
  getCanonicalCustomerOrderWriteTarget,
  getLegacyCustomerOrderDocumentPath,
  resolveCustomerOrderActor,
  toCanonicalCustomerOrder,
} from '../src/utils/canonicalStoreData';

const makeOrder = (
  overrides: Partial<CustomerOrder> = {}
): CustomerOrder => ({
  id: 'order-a',
  storeId: 'store-a',
  buyerId: 'buyer-a',
  buyerName: 'Cliente',
  buyerEmail: 'cliente@example.com',
  fulfillmentType: 'pickup',
  deliveryAddress: '',
  tableCode: '',
  customerNote: '',
  items: [
    {
      lineId: 'line-a',
      productId: 'product-a',
      name: 'Produto',
      price: 20,
      quantity: 1,
      paidQuantity: 0,
      transferredQuantity: 0,
      note: '',
      image: '',
      isService: false,
    },
  ],
  subtotal: 20,
  total: 20,
  status: 'pending',
  paymentStatus: 'unpaid',
  source: 'customer',
  operatorId: '',
  operatorName: '',
  createdAt: '2026-07-21T00:00:00.000Z',
  updatedAt: '2026-07-21T00:00:00.000Z',
  ...overrides,
});

test('derives authenticated customer identity for canonical orders', () => {
  const order = makeOrder();
  const actor = resolveCustomerOrderActor(order);
  const canonical = toCanonicalCustomerOrder(order);

  assert.deepEqual(actor, {
    createdByUserId: 'buyer-a',
    createdByRole: 'customer',
  });
  assert.equal(canonical.createdByUserId, 'buyer-a');
  assert.equal(canonical.createdByRole, 'customer');
  assert.equal(
    canonical.migratedFromPath,
    'artifacts/store-a/public/data/customerOrders/order-a'
  );
});

test('requires an explicit store role for staff and transfer orders', () => {
  const staffOrder = makeOrder({
    source: 'staff',
    buyerId: 'walk-in-table-12',
    buyerEmail: '',
    operatorId: 'seller-a',
  });

  assert.throws(
    () => resolveCustomerOrderActor(staffOrder),
    /operador e papel da loja/i
  );

  assert.deepEqual(
    resolveCustomerOrderActor(staffOrder, {
      userId: 'seller-a',
      role: 'seller',
    }),
    {
      createdByUserId: 'seller-a',
      createdByRole: 'seller',
    }
  );
});

test('keeps canonical and legacy order paths explicit during migration', () => {
  const order = makeOrder();

  assert.equal(
    getCanonicalCustomerOrderWriteTarget(order),
    'stores/store-a/orders/order-a'
  );
  assert.equal(
    getLegacyCustomerOrderDocumentPath(order.storeId, order.id),
    'artifacts/store-a/public/data/customerOrders/order-a'
  );
});

test('rejects new store ids that reuse the owner uid', () => {
  assert.doesNotThrow(() =>
    assertStoreIdIndependentFromOwner('store-generated-a', 'owner-user-a')
  );
  assert.throws(
    () => assertStoreIdIndependentFromOwner('owner-user-a', 'owner-user-a'),
    /não pode reutilizar o UID/i
  );
});
