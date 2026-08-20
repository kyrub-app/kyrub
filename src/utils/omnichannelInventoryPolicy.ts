import type { StoreChannelId, StoreChannelRegistryEntry } from './channelRegistry';

export interface CanonicalInventoryChange {
  storeId: string;
  productId: string;
  quantity: number;
  sourceChannel: StoreChannelId | 'internal';
}

export interface InventorySyncTarget {
  channelId: StoreChannelId;
  quantity: number;
}

const required = (label: string, value: string): string => {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
};

export const normalizeCanonicalInventoryChange = (
  input: CanonicalInventoryChange
): CanonicalInventoryChange => {
  const quantity = Number(input.quantity);
  if (!Number.isFinite(quantity) || quantity < 0) {
    throw new Error('Inventory quantity must be a finite non-negative number.');
  }

  return {
    storeId: required('store id', input.storeId),
    productId: required('product id', input.productId),
    quantity,
    sourceChannel: input.sourceChannel,
  };
};

export const getInventorySyncTargets = (
  registry: StoreChannelRegistryEntry[],
  changeInput: CanonicalInventoryChange
): InventorySyncTarget[] => {
  const change = normalizeCanonicalInventoryChange(changeInput);

  return registry
    .filter(channel =>
      channel.storeId === change.storeId &&
      channel.configured &&
      channel.capabilities.inventory &&
      channel.channelId !== change.sourceChannel
    )
    .map(channel => ({
      channelId: channel.channelId,
      quantity: change.quantity,
    }));
};

export const shouldApplyInboundInventoryToCanonical = (input: {
  sourceChannel: StoreChannelId;
  registry: StoreChannelRegistryEntry[];
  storeId: string;
}): boolean => {
  const channel = input.registry.find(entry =>
    entry.storeId === input.storeId &&
    entry.channelId === input.sourceChannel
  );

  return Boolean(
    channel &&
    channel.configured &&
    channel.capabilities.inventory
  );
};
