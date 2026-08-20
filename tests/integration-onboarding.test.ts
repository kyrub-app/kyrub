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
import {
  createEmptyStoreIntegrationPlans,
} from '../src/utils/storeOperationalSettings';
import {
  buildStoreActivationPlan,
  getStoreActivationWarnings,
} from '../src/utils/storeActivationPlan';
import {
  buildStoreChannelRegistry,
  findStoreChannel,
  getConfiguredStoreChannels,
} from '../src/utils/channelRegistry';
import {
  buildExternalIdentityMapping,
  getExternalIdentityMappingKey,
  resolveCanonicalIdByExternalId,
  resolveExternalIdByCanonicalId,
  upsertExternalIdentityMapping,
  type ExternalIdentityMapping,
} from '../src/utils/externalIdentityMapping';

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

describe('store activation plan', () => {
  test('defaults catalog origin to Kyrub without inventing an external source', () => {
    const integrations = createEmptyStoreIntegrationPlans();
    const plan = buildStoreActivationPlan(integrations);

    assert.equal(plan.catalogOrigin, 'kyrub');
    assert.deepEqual(plan.configuredChannelIds, []);
    assert.equal(plan.hasOmnichannelPlan, false);
    assert.equal(getStoreActivationWarnings(plan).length, 1);
  });

  test('derives channels and external catalog origin from the actual integration plans', () => {
    const integrations = createEmptyStoreIntegrationPlans();
    integrations.ifood = {
      ...integrations.ifood,
      status: 'draft',
      receiveOrders: true,
      syncCatalog: true,
      syncInventory: true,
    };
    integrations['99food'] = {
      ...integrations['99food'],
      status: 'draft',
      receiveOrders: true,
    };

    const plan = buildStoreActivationPlan(integrations);

    assert.equal(plan.catalogOrigin, 'integration');
    assert.deepEqual(plan.configuredChannelIds, ['ifood', '99food']);
    assert.deepEqual(plan.orderChannelIds, ['ifood', '99food']);
    assert.deepEqual(plan.catalogChannelIds, ['ifood']);
    assert.deepEqual(plan.inventoryChannelIds, ['ifood']);
    assert.equal(plan.hasOmnichannelPlan, true);
    assert.deepEqual(getStoreActivationWarnings(plan), []);
  });

  test('warns when multiple channels compete to be catalog source', () => {
    const integrations = createEmptyStoreIntegrationPlans();
    integrations.ifood = {
      ...integrations.ifood,
      status: 'draft',
      syncCatalog: true,
    };
    integrations.shopee = {
      ...integrations.shopee,
      status: 'draft',
      syncCatalog: true,
    };

    const warnings = getStoreActivationWarnings(buildStoreActivationPlan(integrations));
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /Mais de um canal/);
  });
});

describe('store channel registry', () => {
  test('always includes Kyrub Shop as the native canonical channel', () => {
    const registry = buildStoreChannelRegistry(
      'store-1',
      createEmptyStoreIntegrationPlans()
    );

    assert.deepEqual(
      getConfiguredStoreChannels(registry).map(channel => channel.channelId),
      ['kyrub-shop']
    );
    assert.equal(
      findStoreChannel(registry, 'kyrub-shop')?.sourceChannel,
      'kyrub-shop'
    );
  });

  test('derives external channel capabilities from configured integration plans', () => {
    const integrations = createEmptyStoreIntegrationPlans();
    integrations.ifood = {
      ...integrations.ifood,
      status: 'draft',
      receiveOrders: true,
      syncCatalog: true,
      syncInventory: true,
    };

    const ifood = findStoreChannel(
      buildStoreChannelRegistry('store-1', integrations),
      'ifood'
    );

    assert.equal(ifood?.configured, true);
    assert.deepEqual(ifood?.capabilities, {
      orders: true,
      catalog: true,
      inventory: true,
    });
    assert.equal(ifood?.sourceChannel, 'ifood');
  });

  test('does not expose capabilities for an unconfigured adapter', () => {
    const integrations = createEmptyStoreIntegrationPlans();
    integrations.shopee = {
      ...integrations.shopee,
      receiveOrders: true,
      syncCatalog: true,
      syncInventory: true,
    };

    const shopee = findStoreChannel(
      buildStoreChannelRegistry('store-1', integrations),
      'shopee'
    );

    assert.deepEqual(shopee?.capabilities, {
      orders: false,
      catalog: false,
      inventory: false,
    });
  });

  test('rejects a registry without store identity', () => {
    assert.throws(
      () => buildStoreChannelRegistry(' ', createEmptyStoreIntegrationPlans()),
      /store id/i
    );
  });
});

describe('external identity mapping', () => {
  const base: ExternalIdentityMapping = {
    storeId: 'store-1',
    channelId: 'ifood',
    entityType: 'product',
    canonicalId: 'product-1',
    externalId: 'ifood-product-99',
  };

  test('normalizes ids and creates a deterministic canonical key', () => {
    const mapping = buildExternalIdentityMapping({
      ...base,
      storeId: ' store-1 ',
      externalId: ' ifood-product-99 ',
    });

    assert.equal(mapping.storeId, 'store-1');
    assert.equal(mapping.externalId, 'ifood-product-99');
    assert.equal(
      getExternalIdentityMappingKey(mapping),
      'store-1::ifood::product::product-1'
    );
  });

  test('resolves canonical and external ids in both directions', () => {
    const mappings = [base];

    assert.equal(
      resolveCanonicalIdByExternalId(mappings, {
        storeId: 'store-1',
        channelId: 'ifood',
        entityType: 'product',
        externalId: 'ifood-product-99',
      }),
      'product-1'
    );
    assert.equal(
      resolveExternalIdByCanonicalId(mappings, {
        storeId: 'store-1',
        channelId: 'ifood',
        entityType: 'product',
        canonicalId: 'product-1',
      }),
      'ifood-product-99'
    );
  });

  test('updates one canonical mapping without creating a duplicate', () => {
    const mappings = upsertExternalIdentityMapping([base], {
      ...base,
      externalId: 'ifood-product-100',
    });

    assert.equal(mappings.length, 1);
    assert.equal(mappings[0].externalId, 'ifood-product-100');
  });

  test('rejects an external id collision in the same store/channel/type', () => {
    assert.throws(
      () => upsertExternalIdentityMapping([base], {
        ...base,
        canonicalId: 'product-2',
      }),
      /collision/i
    );
  });

  test('allows the same external text in another channel because scope differs', () => {
    const mappings = upsertExternalIdentityMapping([base], {
      ...base,
      channelId: '99food',
      canonicalId: 'product-2',
    });

    assert.equal(mappings.length, 2);
  });
});
