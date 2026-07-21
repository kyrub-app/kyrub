import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { CartItem, Product } from '../src/types';
import {
  buildCustomerOrder,
  canTransitionCustomerOrderStatus,
  getLastCustomerOrderStorageKey,
  loadLastCustomerOrderId,
  parseCustomerOrder,
  saveLastCustomerOrderId,
  type StorageLike,
} from '../src/utils/customerOrders';

class MemoryStorage implements StorageLike {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

const product = (overrides: Partial<Product> = {}): Product => ({
  id: 'product-1',
  name: 'Café',
  description: '',
  price: 12.5,
  image: '',
  stock: 10,
  supplierId: 'store-a',
  category: 'Bebidas',
  ...overrides,
});

const cart = (quantity = 2): CartItem[] => [{ product: product(), quantity }];

describe('customer orders', () => {
  test('builds a delivery order with immutable product snapshots', () => {
    const order = buildCustomerOrder(
      { uid: 'buyer-a' },
      {
        storeId: 'store-a',
        buyerName: ' Ana ',
        buyerEmail: ' ana@example.com ',
        fulfillmentType: 'delivery',
        deliveryAddress: ' Rua A, 10 ',
        tableCode: '',
        customerNote: ' Tocar a campainha ',
        cart: cart(2),
        itemNotes: { 'product-1': ' Sem açúcar ' },
      },
      1_700_000_000_000
    );

    assert.equal(order.id, 'customer-order-buyer-a-1700000000000');
    assert.equal(order.buyerName, 'Ana');
    assert.equal(order.deliveryAddress, 'Rua A, 10');
    assert.equal(order.items[0].note, 'Sem açúcar');
    assert.equal(order.subtotal, 25);
    assert.equal(order.total, 25);
    assert.equal(order.status, 'pending');
    assert.equal(order.paymentStatus, 'unpaid');
  });

  test('does not invent address, table or payment for pickup', () => {
    const order = buildCustomerOrder(
      { uid: 'buyer-a' },
      {
        storeId: 'store-a',
        buyerName: 'Ana',
        buyerEmail: 'ana@example.com',
        fulfillmentType: 'pickup',
        deliveryAddress: 'should be removed',
        tableCode: 'should be removed',
        customerNote: '',
        cart: cart(1),
        itemNotes: {},
      }
    );

    assert.equal(order.deliveryAddress, '');
    assert.equal(order.tableCode, '');
    assert.equal(order.paymentStatus, 'unpaid');
  });

  test('requires a table or service code for dine-in orders', () => {
    assert.throws(
      () =>
        buildCustomerOrder(
          { uid: 'buyer-a' },
          {
            storeId: 'store-a',
            buyerName: 'Ana',
            buyerEmail: 'ana@example.com',
            fulfillmentType: 'dine_in',
            deliveryAddress: '',
            tableCode: '',
            customerNote: '',
            cart: cart(1),
            itemNotes: {},
          }
        ),
      /mesa ou o código/i
    );
  });

  test('enforces the customer-order status workflow', () => {
    assert.equal(canTransitionCustomerOrderStatus('pending', 'accepted'), true);
    assert.equal(canTransitionCustomerOrderStatus('pending', 'ready'), false);
    assert.equal(canTransitionCustomerOrderStatus('preparing', 'ready'), true);
    assert.equal(canTransitionCustomerOrderStatus('completed', 'pending'), false);
  });

  test('parses valid records and rejects malformed item snapshots', () => {
    const order = buildCustomerOrder(
      { uid: 'buyer-a' },
      {
        storeId: 'store-a',
        buyerName: 'Ana',
        buyerEmail: 'ana@example.com',
        fulfillmentType: 'pickup',
        deliveryAddress: '',
        tableCode: '',
        customerNote: '',
        cart: cart(1),
        itemNotes: {},
      }
    );

    assert.equal(parseCustomerOrder(order)?.id, order.id);
    assert.equal(
      parseCustomerOrder({
        ...order,
        items: [{ ...order.items[0], quantity: 0 }],
      }),
      null
    );
  });

  test('keeps the last tracked order isolated by buyer and store', () => {
    const storage = new MemoryStorage();
    saveLastCustomerOrderId(storage, 'buyer-a', 'store-a', 'order-a');

    assert.equal(
      loadLastCustomerOrderId(storage, 'buyer-a', 'store-a'),
      'order-a'
    );
    assert.equal(loadLastCustomerOrderId(storage, 'buyer-b', 'store-a'), '');
    assert.notEqual(
      getLastCustomerOrderStorageKey('buyer-a', 'store-a'),
      getLastCustomerOrderStorageKey('buyer-a', 'store-b')
    );
  });
});
