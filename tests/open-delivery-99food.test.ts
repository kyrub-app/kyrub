import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildOpenDeliveryAction,
  normalizeOpenDeliveryOrder,
  parseOpenDeliveryEvent,
  resolveOrderDetailsUrl,
} from '../server/integrations/openDelivery';
import {
  createOpenDeliverySignature,
  decryptIntegrationSecret,
  encryptIntegrationSecret,
  verifyOpenDeliverySignature,
} from '../server/integrations/secretVault';
import {
  normalizeCanonicalSourceChannel,
  withCanonicalSourceChannel,
} from '../src/utils/sourceChannel';

test('validates Open Delivery event identity and type', () => {
  assert.deepEqual(
    parseOpenDeliveryEvent({
      eventId: 'event-1',
      eventType: 'CREATED',
      orderId: 'order-1',
      orderURL: 'https://sandbox.99.example/v1/orders/order-1',
      createdAt: '2026-07-27T12:00:00.000Z',
      sourceAppId: '99food-app',
    }),
    {
      eventId: 'event-1',
      eventType: 'CREATED',
      orderId: 'order-1',
      orderURL: 'https://sandbox.99.example/v1/orders/order-1',
      createdAt: '2026-07-27T12:00:00.000Z',
      sourceAppId: '99food-app',
      virtualBrand: '',
    }
  );

  assert.throws(
    () => parseOpenDeliveryEvent({ eventType: 'UNKNOWN', orderId: 'order-1' }),
    /inválido ou incompleto/
  );
});

test('verifies webhook HMAC using the raw body and merchant client secret', () => {
  const rawBody = Buffer.from('{"eventId":"event-1"}', 'utf8');
  const signature = createOpenDeliverySignature(rawBody, 'merchant-secret');

  assert.equal(
    verifyOpenDeliverySignature(rawBody, 'merchant-secret', signature),
    true
  );
  assert.equal(
    verifyOpenDeliverySignature(rawBody, 'wrong-secret', signature),
    false
  );
});

test('encrypts credentials with authenticated encryption and tenant-specific AAD', () => {
  const key = Buffer.alloc(32, 7);
  const credentials = { clientId: 'merchant-client', clientSecret: 'super-secret' };
  const encrypted = encryptIntegrationSecret(credentials, key, '99food:tenant-a');

  assert.notEqual(encrypted.ciphertext, JSON.stringify(credentials));
  assert.deepEqual(
    decryptIntegrationSecret(encrypted, key, '99food:tenant-a'),
    credentials
  );
  assert.throws(
    () => decryptIntegrationSecret(encrypted, key, '99food:tenant-b')
  );
});

test('normalizes a 99Food Open Delivery order into the existing KDS order shape', () => {
  const order = normalizeOpenDeliveryOrder(
    {
      id: 'order-99-1',
      displayId: '9912',
      type: 'DELIVERY',
      createdAt: '2026-07-27T12:00:00.000Z',
      lastEvent: 'CREATED',
      customer: {
        id: 'customer-1',
        name: 'Cliente Teste',
        email: 'cliente@example.com',
      },
      delivery: {
        deliveryAddress: {
          street: 'Rua Exemplo',
          number: '10',
          district: 'Centro',
          city: 'São Paulo',
          state: 'SP',
        },
      },
      items: [
        {
          id: 'item-1',
          name: 'Prato executivo',
          quantity: 2,
          unitPrice: { value: 24.9 },
          specialInstructions: 'Sem cebola',
          options: [{ name: 'Arroz integral', quantity: 1 }],
        },
      ],
      total: {
        itemsPrice: 49.8,
        orderAmount: 54.8,
      },
      payments: {
        prepaid: 54.8,
        pending: 0,
      },
    },
    {
      tenantId: 'tenant-a',
      routingTarget: 'COZINHA',
      sourceAppId: '99food-app',
      receivedAt: '2026-07-27T12:01:00.000Z',
    }
  );

  assert.equal(order.id, '99food-order-99-1');
  assert.equal(order.storeId, 'tenant-a');
  assert.equal(order.fulfillmentType, 'delivery');
  assert.equal(order.deliveryAddress, 'Rua Exemplo, 10 · Centro · São Paulo - SP');
  assert.equal(order.items[0]?.quantity, 2);
  assert.equal(order.items[0]?.price, 24.9);
  assert.match(order.items[0]?.note ?? '', /Sem cebola/);
  assert.match(order.items[0]?.note ?? '', /Arroz integral/);
  assert.equal(order.total, 54.8);
  assert.equal(order.paymentStatus, 'paid');
  assert.equal(order.integration.provider, '99food');
  assert.equal(order.integration.routingTarget, 'COZINHA');
});

test('canonical source channel is independent from the legacy order source', () => {
  assert.equal(normalizeCanonicalSourceChannel('99food'), '99food');
  assert.equal(normalizeCanonicalSourceChannel('open_delivery'), 'open-delivery');
  assert.equal(normalizeCanonicalSourceChannel('unknown-marketplace'), 'external');

  const tagged = withCanonicalSourceChannel(
    { id: 'order-1', source: 'transfer' },
    '99food'
  );
  assert.equal(tagged.source, 'transfer');
  assert.equal(tagged.sourceChannel, '99food');
});

test('prevents a webhook order URL from redirecting credentials to another origin', () => {
  assert.equal(
    resolveOrderDetailsUrl(
      'https://sandbox.99.example',
      'order-1',
      'https://sandbox.99.example/v1/orders/order-1'
    ),
    'https://sandbox.99.example/v1/orders/order-1'
  );
  assert.equal(
    resolveOrderDetailsUrl(
      'https://sandbox.99.example',
      'order-1',
      'https://attacker.example/steal-token'
    ),
    'https://sandbox.99.example/v1/orders/order-1'
  );
});

test('maps Kyrub KDS actions to Open Delivery order endpoints', () => {
  assert.equal(
    buildOpenDeliveryAction('order-1', 'accepted', {
      displayId: '99',
      createdAt: '2026-07-27T12:00:00.000Z',
    }).path,
    '/v1/orders/order-1/confirm'
  );
  assert.equal(
    buildOpenDeliveryAction('order-1', 'ready', {
      displayId: '99',
      createdAt: '2026-07-27T12:00:00.000Z',
    }).path,
    '/v1/orders/order-1/readyForPickup'
  );
  assert.equal(
    buildOpenDeliveryAction('order-1', 'cancelled', {
      displayId: '99',
      createdAt: '2026-07-27T12:00:00.000Z',
      reason: 'Sem estoque',
    }).path,
    '/v1/orders/order-1/requestCancellation'
  );
});
