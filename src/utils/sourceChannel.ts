import type { CommerceChannel } from '../../shared/channelAvailabilityFiscalFoundation';

/** Single commercial channel contract shared by integrations, KDS, CRM and inventory. */
export type CanonicalSourceChannel = CommerceChannel;

/** Legacy integration spellings are accepted at the boundary, never persisted as new channels. */
const aliases: Record<string, CommerceChannel> = {
  kyrub: 'kyrub',
  'kyrub-shop': 'kyrub',
  mercado_livre: 'mercado_livre',
  'mercado-livre': 'mercado_livre',
  '99food': '99food',
  ifood: 'ifood',
  shopee: 'shopee',
  instagram: 'instagram',
  erp: 'erp',
  other: 'other',
  external: 'other',
  // Open Delivery is a protocol, not a commercial source.
  open_delivery: 'other',
  'open-delivery': 'other',
  // SEFAZ is a fiscal authority, not a sales channel.
  sefaz: 'other',
};

export const normalizeCanonicalSourceChannel = (value: string): CommerceChannel => {
  const normalized = value.trim().toLowerCase();
  if (!normalized) throw new Error('Source channel is required.');
  return aliases[normalized] ?? 'other';
};

export const withCanonicalSourceChannel = <T extends Record<string, unknown>>(
  value: T,
  sourceChannel: string
): T & { sourceChannel: CommerceChannel } => ({
  ...value,
  sourceChannel: normalizeCanonicalSourceChannel(sourceChannel),
});

/** Compatibility export for callers migrated from the former integration channel type. */
export const toOperationalCommerceChannel = (source: CanonicalSourceChannel): CommerceChannel => source;
