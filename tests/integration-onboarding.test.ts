import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  INTEGRATION_TEST_ORDER_EVENT,
  LEGACY_ORDER_CACHE_KEY,
  appendIntegrationTestOrder,
  buildIntegrationTestOrder,
  parseIntegrationTestOrderRequest,
  parseLegacyOrderCache,
  type IntegrationTestOrderRequest,
} from '../src/utils/integrationTestOrders';

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

const request: IntegrationTestOrderRequest = {
  requestId: 'integration-test-ifood-1',
  providerId: 'ifood',
  providerLabel: 'iFood',
  storeId: 'store-a',
  routingTarget: 'COZINHA',
  accountLabel: 'Loja Centro',
  externalStoreId: 'merchant-123',
  createdAt: '2026-07-27T12:00:00.000Z',
};

describe('integration onboarding order tests', () => {
  test('uses a dedicated browser event and the existing order cache', () => {
    assert.equal(INTEGRATION_TEST_ORDER_EVENT, 'kyrub-integration-test-order');
    assert.equal(LEGACY_ORDER_CACHE_KEY, 'kyrub_orders');
  });

  test('rejects malformed browser event payloads', () => {
    assert.equal(parseIntegrationTestOrderRequest(null), null);
    assert.equal(
      parseIntegrationTestOrderRequest({ ...request, providerId: 'unknown' }),
      null
    );
    assert.equal(
      parseIntegrationTestOrderRequest({ ...request, routingTarget: '' }),
      null
    );
    assert.deepEqual(parseIntegrationTestOrderRequest(request), request);
  });

  test('builds a zero-value test order for the selected operational target', () => {
    const order = buildIntegrationTestOrder(request);

    assert.equal(order.id, request.requestId);
    assert.equal(order.storeId, request.storeId);
    assert.equal(order.status, 'pending');
    assert.equal(order.total, 0);
    assert.match(order.buyerName, /TESTE · iFood/);
    assert.match(order.items[0].name, /Loja Centro → COZINHA/);
  });

  test('appends the test once and preserves existing orders', () => {
    const storage = new MemoryStorage();
    storage.setItem(
      LEGACY_ORDER_CACHE_KEY,
      JSON.stringify([
        {
          id: 'existing-order',
          storeId: 'store-a',
          buyerName: 'Cliente',
          buyerEmail: 'cliente@example.com',
          items: [],
          total: 10,
          status: 'pending',
          createdAt: '2026-07-27T11:00:00.000Z',
          type: 'retail',
        },
      ])
    );

    appendIntegrationTestOrder(storage, request);
    appendIntegrationTestOrder(storage, request);

    const orders = parseLegacyOrderCache(storage.getItem(LEGACY_ORDER_CACHE_KEY));
    assert.deepEqual(orders.map(order => order.id), [
      request.requestId,
      'existing-order',
    ]);
  });

  test('invalid order cache falls back safely', () => {
    assert.deepEqual(parseLegacyOrderCache('{invalid'), []);
    assert.deepEqual(parseLegacyOrderCache(null), []);
  });
});