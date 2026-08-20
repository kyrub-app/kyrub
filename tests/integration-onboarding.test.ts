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
import {
  createStoreOnboardingDraft,
  getStoreOnboardingProgress,
  loadStoreOnboardingDraft,
  saveStoreOnboardingDraft,
  shouldOfferStoreOnboarding,
} from '../src/utils/smartStoreOnboarding';

class MemoryStorage {
  private values = new Map<string, string>();

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

describe('smart store onboarding', () => {
  test('skips known answers and prioritizes the next missing required field', () => {
    const progress = getStoreOnboardingProgress({
      name: 'City Chopperia',
      description: 'Burgers e chopp',
      address: 'Rua Central, 10',
      contact: '',
      keywords: '',
    });

    assert.equal(progress.completed, 3);
    assert.equal(progress.percent, 60);
    assert.equal(progress.nextField, 'contact');
    assert.equal(progress.readyForReview, false);
  });

  test('allows review with minimum data while optional completion remains available', () => {
    const profile = {
      name: 'City Chopperia',
      description: '',
      address: '',
      contact: '(11) 99999-9999',
      keywords: '',
    };
    const progress = getStoreOnboardingProgress(profile);

    assert.equal(progress.readyForReview, true);
    assert.equal(progress.nextField, 'description');
    assert.equal(shouldOfferStoreOnboarding(profile), true);
  });

  test('resume draft stores navigation only, not a second store profile', () => {
    const storage = new MemoryStorage();
    const draft = createStoreOnboardingDraft(
      'address',
      new Date('2026-08-20T18:00:00.000Z')
    );

    saveStoreOnboardingDraft(storage, 'user-1', draft);
    const serialized = storage.getItem('kyrub_store_onboarding_user-1') ?? '';

    assert.deepEqual(loadStoreOnboardingDraft(storage, 'user-1'), draft);
    assert.equal(serialized.includes('City Chopperia'), false);
    assert.equal(serialized.includes('profile'), false);
  });
});
