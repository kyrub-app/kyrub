import type {
  StoreIntegrationId,
  StoreIntegrationPlans,
} from './storeOperationalSettings';
import { STORE_INTEGRATION_IDS } from './storeOperationalSettings';

export type StoreChannelId = 'kyrub-shop' | StoreIntegrationId;
export type StoreChannelKind =
  | 'native'
  | 'interoperability'
  | 'food-marketplace'
  | 'commerce-marketplace'
  | 'fiscal';

export interface StoreChannelCapabilities {
  orders: boolean;
  catalog: boolean;
  inventory: boolean;
}

export interface StoreChannelRegistryEntry {
  storeId: string;
  channelId: StoreChannelId;
  kind: StoreChannelKind;
  configured: boolean;
  sourceChannel: StoreChannelId;
  capabilities: StoreChannelCapabilities;
}

const CHANNEL_KINDS: Record<StoreIntegrationId, StoreChannelKind> = {
  'open-delivery': 'interoperability',
  sefaz: 'fiscal',
  ifood: 'food-marketplace',
  '99food': 'food-marketplace',
  'mercado-livre': 'commerce-marketplace',
  shopee: 'commerce-marketplace',
};

const isConfigured = (
  integrations: StoreIntegrationPlans,
  channelId: StoreIntegrationId
): boolean => integrations[channelId].status !== 'not-configured';

export const buildStoreChannelRegistry = (
  storeId: string,
  integrations: StoreIntegrationPlans
): StoreChannelRegistryEntry[] => {
  const normalizedStoreId = storeId.trim();
  if (!normalizedStoreId) {
    throw new Error('Channel Registry requires a store id.');
  }

  const nativeChannel: StoreChannelRegistryEntry = {
    storeId: normalizedStoreId,
    channelId: 'kyrub-shop',
    kind: 'native',
    configured: true,
    sourceChannel: 'kyrub-shop',
    capabilities: {
      orders: true,
      catalog: true,
      inventory: true,
    },
  };

  const externalChannels = STORE_INTEGRATION_IDS.map(channelId => {
    const plan = integrations[channelId];
    const configured = isConfigured(integrations, channelId);

    return {
      storeId: normalizedStoreId,
      channelId,
      kind: CHANNEL_KINDS[channelId],
      configured,
      sourceChannel: channelId,
      capabilities: {
        orders: configured && plan.receiveOrders,
        catalog: configured && plan.syncCatalog,
        inventory: configured && plan.syncInventory,
      },
    } satisfies StoreChannelRegistryEntry;
  });

  return [nativeChannel, ...externalChannels];
};

export const getConfiguredStoreChannels = (
  registry: StoreChannelRegistryEntry[]
): StoreChannelRegistryEntry[] =>
  registry.filter(channel => channel.configured);

export const findStoreChannel = (
  registry: StoreChannelRegistryEntry[],
  channelId: StoreChannelId
): StoreChannelRegistryEntry | null =>
  registry.find(channel => channel.channelId === channelId) ?? null;
