import type { StoreIntegrationId } from '../../src/utils/storeOperationalSettings';
import type {
  InventoryAdapterDispatcher,
  InventoryDispatchPayload,
} from './omnichannelInventoryWorker';

export interface InventoryChannelAdapter {
  channelId: StoreIntegrationId;
  pushInventory(payload: InventoryDispatchPayload): Promise<void>;
}

export type InventoryAdapterRegistry = Partial<
  Record<StoreIntegrationId, InventoryChannelAdapter>
>;

export class UnsupportedInventoryChannelError extends Error {
  readonly code = 'INVENTORY_CHANNEL_UNSUPPORTED';

  constructor(readonly channelId: StoreIntegrationId) {
    super(`Inventory sync is not implemented for channel ${channelId}.`);
    this.name = 'UnsupportedInventoryChannelError';
  }
}

export const buildInventoryAdapterRegistry = (
  adapters: InventoryChannelAdapter[]
): InventoryAdapterRegistry => {
  const registry: InventoryAdapterRegistry = {};

  for (const adapter of adapters) {
    if (registry[adapter.channelId]) {
      throw new Error(`Duplicate inventory adapter for ${adapter.channelId}.`);
    }
    registry[adapter.channelId] = adapter;
  }

  return registry;
};

export const createInventoryAdapterDispatcher = (
  registry: InventoryAdapterRegistry
): InventoryAdapterDispatcher => async payload => {
  const adapter = registry[payload.targetChannel];
  if (!adapter) {
    throw new UnsupportedInventoryChannelError(payload.targetChannel);
  }

  if (adapter.channelId !== payload.targetChannel) {
    throw new Error('Inventory adapter registry is corrupted.');
  }

  await adapter.pushInventory(payload);
};

export const getInventoryAdapterSupport = (
  registry: InventoryAdapterRegistry
): Record<StoreIntegrationId, boolean> => ({
  'open-delivery': Boolean(registry['open-delivery']),
  sefaz: Boolean(registry.sefaz),
  ifood: Boolean(registry.ifood),
  '99food': Boolean(registry['99food']),
  'mercado-livre': Boolean(registry['mercado-livre']),
  shopee: Boolean(registry.shopee),
});
