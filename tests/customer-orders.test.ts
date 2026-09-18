import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import './payment-ux-policy.test';
import './marketplace-payment-intent-checkout.test';
import './customer-storefront-order-e2e-contract.test';
import './local-service-pos.test';
import type { CartItem, Product } from '../src/types';
import {
  buildCanonicalCustomerOrderWriteData,
  buildCustomerOrder,
  canTransitionCustomerOrderStatus,
  customerOrdersEquivalent,
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

const tableLocation = {
  schemaVersion: 1 as const,
  id: 'table-7',
  kind: 'table' as const,
  label: 'Mesa 7',
};

const counterLocation = {
  schemaVersion: 1 as const,
  id: 'counter-2',
  kind: 'counter' as const,
  label: 'Balcão 2',
};

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
    assert.equal(order.serviceLocation, null);
  });

  test('builds the canonical-first payload without losing legacy lineage', () => {
    const order = buildCustomerOrder(
      { uid: 'buyer-a' },
      {
        storeId: 'legacy-store-a',
        buyerName: 'Ana',
        buyerEmail: 'ana@example.com',
        fulfillmentType: 'pickup',
        deliveryAddress: '',
        tableCode: '',
        customerNote: '',
        cart: cart(1),
        itemNotes: {},
      },
      1_700_000_000_000
    );

    const canonical = buildCanonicalCustomerOrderWriteData(
      order,
      'canonical-store-a'
    );

    assert.equal(canonical.storeId, 'canonical-store-a');
    assert.equal(canonical.createdByUserId, 'buyer-a');
    assert.equal(canonical.createdByRole, 'customer');
    assert.equal(canonical.legacyStoreId, 'legacy-store-a');
    assert.equal(canonical.legacyCreatedAt, order.createdAt);
    assert.equal(canonical.legacyUpdatedAt, order.updatedAt);
    assert.equal(
      (canonical.migration as Record<string, unknown>).mode,
      'canonical_first'
    );
    assert.match(String(canonical.migratedFromPath), /artifacts\/legacy-store-a/);
  });

  test('parses canonical server timestamps through preserved legacy timestamps', () => {
    const order = buildCustomerOrder(
      { uid: 'buyer-a' },
      {
        storeId: 'legacy-store-a',
        buyerName: 'Ana',
        buyerEmail: 'ana@example.com',
        fulfillmentType: 'pickup',
        deliveryAddress: '',
        tableCode: '',
        customerNote: '',
        cart: cart(1),
        itemNotes: {},
      },
      1_700_000_000_000
    );

    const parsed = parseCustomerOrder({
      ...order,
      storeId: 'canonical-store-a',
      createdAt: { seconds: 1 },
      updatedAt: { seconds: 1 },
      legacyCreatedAt: order.createdAt,
      legacyUpdatedAt: order.updatedAt,
    });

    assert.equal(parsed?.createdAt, order.createdAt);
    assert.equal(parsed?.updatedAt, order.updatedAt);
  });

  test('does not invent address, table, service location or payment for pickup', () => {
    const order = buildCustomerOrder(
      { uid: 'buyer-a' },
      {
        storeId: 'store-a',
        buyerName: 'Ana',
        buyerEmail: 'ana@example.com',
        fulfillmentType: 'pickup',
        deliveryAddress: 'should be removed',
        tableCode: 'should be removed',
        serviceLocation: counterLocation,
        customerNote: '',
        cart: cart(1),
        itemNotes: {},
      }
    );

    assert.equal(order.deliveryAddress, '');
    assert.equal(order.tableCode, '');
    assert.equal(order.serviceLocation, null);
    assert.equal(order.paymentStatus, 'unpaid');
  });

  test('requires a table, service code or canonical service location for dine-in orders', () => {
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

  test('keeps legacy tableCode-only dine-in orders compatible', () => {
    const order = buildCustomerOrder(
      { uid: 'buyer-a' },
      {
        storeId: 'store-a',
        buyerName: 'Ana',
        buyerEmail: 'ana@example.com',
        fulfillmentType: 'dine_in',
        deliveryAddress: '',
        tableCode: ' 12 ',
        customerNote: '',
        cart: cart(1),
        itemNotes: {},
      }
    );

    assert.equal(order.tableCode, '12');
    assert.equal(order.serviceLocation, null);
    assert.equal(parseCustomerOrder(order)?.tableCode, '12');
  });

  test('persists a canonical table snapshot while mirroring its label for legacy readers', () => {
    const order = buildCustomerOrder(
      { uid: 'buyer-a' },
      {
        storeId: 'legacy-store-a',
        buyerName: 'Ana',
        buyerEmail: 'ana@example.com',
        fulfillmentType: 'dine_in',
        deliveryAddress: '',
        tableCode: '',
        serviceLocation: tableLocation,
        customerNote: '',
        cart: cart(1),
        itemNotes: {},
      }
    );

    assert.deepEqual(order.serviceLocation, tableLocation);
    assert.equal(order.tableCode, 'Mesa 7');
    assert.equal(order.sourceChannel, 'kyrub');
    assert.deepEqual(parseCustomerOrder(order)?.serviceLocation, tableLocation);

    const canonical = buildCanonicalCustomerOrderWriteData(
      order,
      'canonical-store-a'
    );
    assert.deepEqual(canonical.serviceLocation, tableLocation);
  });

  test('canonical non-table locations clear stale table semantics', () => {
    const order = buildCustomerOrder(
      { uid: 'buyer-a' },
      {
        storeId: 'store-a',
        buyerName: 'Ana',
        buyerEmail: 'ana@example.com',
        fulfillmentType: 'dine_in',
        deliveryAddress: '',
        tableCode: 'legacy-table-value',
        serviceLocation: counterLocation,
        customerNote: '',
        cart: cart(1),
        itemNotes: {},
      }
    );

    assert.equal(order.tableCode, '');
    assert.deepEqual(order.serviceLocation, counterLocation);
  });

  test('rejects malformed explicit service-location input instead of silently downgrading it', () => {
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
            tableCode: '12',
            serviceLocation: {
              schemaVersion: 1,
              id: '',
              kind: 'table',
              label: 'Mesa 12',
            } as any,
            customerNote: '',
            cart: cart(1),
            itemNotes: {},
          }
        ),
      /local de atendimento inválido/i
    );
  });

  test('ignores malformed persisted service location while preserving legacy table fallback', () => {
    const legacy = buildCustomerOrder(
      { uid: 'buyer-a' },
      {
        storeId: 'store-a',
        buyerName: 'Ana',
        buyerEmail: 'ana@example.com',
        fulfillmentType: 'dine_in',
        deliveryAddress: '',
        tableCode: '12',
        customerNote: '',
        cart: cart(1),
        itemNotes: {},
      }
    );

    const parsed = parseCustomerOrder({
      ...legacy,
      serviceLocation: {
        schemaVersion: 999,
        id: 'counter-2',
        kind: 'counter',
        label: 'Balcão 2',
      },
    });

    assert.equal(parsed?.serviceLocation, null);
    assert.equal(parsed?.tableCode, '12');
  });

  test('canonical-vs-legacy equivalence detects service-location divergence', () => {
    const legacy = buildCustomerOrder(
      { uid: 'buyer-a' },
      {
        storeId: 'store-a',
        buyerName: 'Ana',
        buyerEmail: 'ana@example.com',
        fulfillmentType: 'dine_in',
        deliveryAddress: '',
        tableCode: 'Mesa 7',
        customerNote: '',
        cart: cart(1),
        itemNotes: {},
      },
      1_700_000_000_000
    );
    const canonical = {
      ...legacy,
      serviceLocation: tableLocation,
    };

    assert.equal(customerOrdersEquivalent(legacy, canonical), false);
    assert.equal(customerOrdersEquivalent(canonical, { ...canonical }), true);
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
