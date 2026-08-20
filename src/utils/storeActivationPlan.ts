import type {
  StoreIntegrationId,
  StoreIntegrationPlans,
} from './storeOperationalSettings';
import { STORE_INTEGRATION_IDS } from './storeOperationalSettings';

export type StoreCatalogOrigin = 'kyrub' | 'integration';

export interface StoreActivationChannel {
  id: StoreIntegrationId;
  configured: boolean;
  receivesOrders: boolean;
  syncsCatalog: boolean;
  syncsInventory: boolean;
}

export interface StoreActivationPlan {
  channels: StoreActivationChannel[];
  configuredChannelIds: StoreIntegrationId[];
  orderChannelIds: StoreIntegrationId[];
  catalogChannelIds: StoreIntegrationId[];
  inventoryChannelIds: StoreIntegrationId[];
  catalogOrigin: StoreCatalogOrigin;
  hasOmnichannelPlan: boolean;
}

const isConfigured = (
  plan: StoreIntegrationPlans[StoreIntegrationId]
): boolean => plan.status !== 'not-configured';

export const buildStoreActivationPlan = (
  integrations: StoreIntegrationPlans
): StoreActivationPlan => {
  const channels = STORE_INTEGRATION_IDS.map(id => {
    const plan = integrations[id];
    return {
      id,
      configured: isConfigured(plan),
      receivesOrders: isConfigured(plan) && plan.receiveOrders,
      syncsCatalog: isConfigured(plan) && plan.syncCatalog,
      syncsInventory: isConfigured(plan) && plan.syncInventory,
    };
  });

  const configuredChannelIds = channels
    .filter(channel => channel.configured)
    .map(channel => channel.id);
  const orderChannelIds = channels
    .filter(channel => channel.receivesOrders)
    .map(channel => channel.id);
  const catalogChannelIds = channels
    .filter(channel => channel.syncsCatalog)
    .map(channel => channel.id);
  const inventoryChannelIds = channels
    .filter(channel => channel.syncsInventory)
    .map(channel => channel.id);

  return {
    channels,
    configuredChannelIds,
    orderChannelIds,
    catalogChannelIds,
    inventoryChannelIds,
    catalogOrigin: catalogChannelIds.length > 0 ? 'integration' : 'kyrub',
    hasOmnichannelPlan: configuredChannelIds.length > 1,
  };
};

export const getStoreActivationWarnings = (
  plan: StoreActivationPlan
): string[] => {
  const warnings: string[] = [];

  if (plan.configuredChannelIds.length === 0) {
    warnings.push('Nenhum canal externo foi configurado; a loja funcionará somente com o catálogo e os pedidos do Kyrub.');
  }

  if (plan.catalogChannelIds.length > 1) {
    warnings.push('Mais de um canal quer sincronizar catálogo. Revise qual fonte será autoritativa antes de ativar sincronização em produção.');
  }

  if (
    plan.inventoryChannelIds.length > 0 &&
    plan.catalogChannelIds.length === 0
  ) {
    warnings.push('Há sincronização de estoque planejada sem uma origem externa de catálogo. Confirme o mapeamento dos SKUs antes da produção.');
  }

  return warnings;
};
