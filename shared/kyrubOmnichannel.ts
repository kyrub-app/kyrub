export const KYRUB_OMNICHANNEL_SCHEMA_VERSION = 1 as const;

export type KyrubSourceChannel =
  | 'kyrub'
  | '99food'
  | 'open_delivery'
  | 'whatsapp'
  | 'instagram'
  | 'manual';

export type KyrubOmnichannelCapability =
  | 'order_ingress'
  | 'status_sync'
  | 'inventory_sync'
  | 'catalog_sync';

export type KyrubSourceChannelDefinition = {
  channel: KyrubSourceChannel;
  external: boolean;
  capabilities: KyrubOmnichannelCapability[];
};

export const KYRUB_SOURCE_CHANNEL_REGISTRY: Record<
  KyrubSourceChannel,
  KyrubSourceChannelDefinition
> = {
  kyrub: {
    channel: 'kyrub',
    external: false,
    capabilities: ['order_ingress', 'status_sync', 'inventory_sync', 'catalog_sync'],
  },
  '99food': {
    channel: '99food',
    external: true,
    capabilities: ['order_ingress', 'status_sync', 'inventory_sync'],
  },
  open_delivery: {
    channel: 'open_delivery',
    external: true,
    capabilities: ['order_ingress', 'status_sync'],
  },
  whatsapp: {
    channel: 'whatsapp',
    external: true,
    capabilities: ['order_ingress'],
  },
  instagram: {
    channel: 'instagram',
    external: true,
    capabilities: ['order_ingress'],
  },
  manual: {
    channel: 'manual',
    external: false,
    capabilities: ['order_ingress'],
  },
};

export type KyrubOmnichannelIngressEnvelope<TPayload = unknown> = {
  schemaVersion: typeof KYRUB_OMNICHANNEL_SCHEMA_VERSION;
  channel: KyrubSourceChannel;
  externalOrderId: string;
  tenantId: string;
  receivedAt: string;
  idempotencyKey: string;
  payload: TPayload;
};
