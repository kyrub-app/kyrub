import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildStoreChannelRegistry, findStoreChannel, getConfiguredStoreChannels } from '../src/utils/channelRegistry';
import { createEmptyStoreIntegrationPlans } from '../src/utils/storeOperationalSettings';

describe('store channel registry', () => {
  test('always includes Kyrub Shop as the native canonical channel', () => {
    const registry = buildStoreChannelRegistry('store-1', createEmptyStoreIntegrationPlans());
    assert.deepEqual(getConfiguredStoreChannels(registry).map(channel => channel.channelId), ['kyrub-shop']);
    assert.equal(findStoreChannel(registry, 'kyrub-shop')?.sourceChannel, 'kyrub-shop');
  });

  test('derives external capabilities only from configured integration plans', () => {
    const integrations = createEmptyStoreIntegrationPlans();
    integrations.ifood = { ...integrations.ifood, status: 'draft', receiveOrders: true, syncCatalog: true, syncInventory: true };
    const registry = buildStoreChannelRegistry('store-1', integrations);
    const ifood = findStoreChannel(registry, 'ifood');
    assert.equal(ifood?.configured, true);
    assert.deepEqual(ifood?.capabilities, { orders: true, catalog: true, inventory: true });
    assert.equal(ifood?.sourceChannel, 'ifood');
  });

  test('does not expose capabilities for an unconfigured adapter', () => {
    const integrations = createEmptyStoreIntegrationPlans();
    integrations.shopee = { ...integrations.shopee, receiveOrders: true, syncCatalog: true, syncInventory: true };
    const shopee = findStoreChannel(buildStoreChannelRegistry('store-1', integrations), 'shopee');
    assert.deepEqual(shopee?.capabilities, { orders: false, catalog: false, inventory: false });
  });

  test('rejects a registry without store identity', () => {
    assert.throws(() => buildStoreChannelRegistry(' ', createEmptyStoreIntegrationPlans()), /store id/i);
  });
});
