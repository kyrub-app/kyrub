import assert from 'node:assert/strict';
import test from 'node:test';
import type { CartItem, Product } from '../src/types';
import {
  buildCanonicalCustomerOrderWriteData,
  buildCustomerOrder,
  parseCustomerOrder,
} from '../src/utils/customerOrders';

const product: Product = {
  id: 'product-1',
  name: 'Café',
  description: '',
  price: 12.5,
  image: '',
  stock: 10,
  supplierId: 'store-a',
  category: 'Bebidas',
};

const cart: CartItem[] = [{ product, quantity: 1 }];

const buildInternalOrder = () => buildCustomerOrder(
  { uid: 'buyer-a' },
  {
    storeId: 'store-a',
    buyerName: 'Ana',
    buyerEmail: 'ana@example.com',
    fulfillmentType: 'pickup',
    deliveryAddress: '',
    tableCode: '',
    customerNote: '',
    cart,
    itemNotes: {},
  },
  1_700_000_000_000
);

test('new Kyrub customer orders stamp the canonical commercial channel independently from source', () => {
  const order = buildInternalOrder();

  assert.equal(order.source, 'customer');
  assert.equal(order.sourceChannel, 'kyrub');

  const canonical = buildCanonicalCustomerOrderWriteData(order, 'canonical-store-a');
  assert.equal(canonical.source, 'customer');
  assert.equal(canonical.sourceChannel, 'kyrub');
});

test('legacy orders without commercial-channel evidence remain readable without inventing a provider', () => {
  const order = buildInternalOrder();
  const { sourceChannel: _sourceChannel, ...legacyOrder } = order;

  const parsed = parseCustomerOrder(legacyOrder);

  assert.ok(parsed);
  assert.equal(parsed.source, 'customer');
  assert.equal(parsed.sourceChannel, null);
});

test('explicit external channel is preserved while operational source remains independent', () => {
  const parsed = parseCustomerOrder({
    ...buildInternalOrder(),
    source: 'staff',
    sourceChannel: '99food',
    buyerEmail: '',
    operatorId: 'operator-a',
    operatorName: 'Operador',
  });

  assert.ok(parsed);
  assert.equal(parsed.source, 'staff');
  assert.equal(parsed.sourceChannel, '99food');
});

test('unknown commercial channel is treated as unknown instead of being guessed as Kyrub', () => {
  const parsed = parseCustomerOrder({
    ...buildInternalOrder(),
    sourceChannel: 'marketplace-x',
  });

  assert.ok(parsed);
  assert.equal(parsed.sourceChannel, null);
});
