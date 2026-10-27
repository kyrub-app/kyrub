/** Commercial origin, not the transport protocol used by an integration. */
export type CanonicalSourceChannel = 'kyrub-shop' | 'open-delivery' | 'ifood' | '99food' | 'mercado-livre' | 'shopee' | 'sefaz' | 'external';

const aliases: Record<string, CanonicalSourceChannel> = {
  kyrub: 'kyrub-shop',
  'kyrub-shop': 'kyrub-shop',
  // Legacy values remain readable; Open Delivery itself is not a sales channel.
  open_delivery: 'external',
  'open-delivery': 'external',
  ifood: 'ifood',
  '99food': '99food',
  mercado_livre: 'mercado-livre',
  'mercado-livre': 'mercado-livre',
  shopee: 'shopee',
  sefaz: 'sefaz',
};

export const normalizeCanonicalSourceChannel = (value: string): CanonicalSourceChannel => {
  const normalized = value.trim().toLowerCase();
  if (!normalized) throw new Error('Source channel is required.');
  return aliases[normalized] ?? 'external';
};

export const withCanonicalSourceChannel = <T extends Record<string, unknown>>(
  value: T,
  sourceChannel: string
): T & { sourceChannel: CanonicalSourceChannel } => ({
  ...value,
  sourceChannel: normalizeCanonicalSourceChannel(sourceChannel),
});

/** Maps integration channel names to the existing operational order contract. */
export const toOperationalCommerceChannel = (source: CanonicalSourceChannel): import('../../shared/channelAvailabilityFiscalFoundation').CommerceChannel => {
  switch (source) {
    case 'kyrub-shop': return 'kyrub';
    case 'mercado-livre': return 'mercado_livre';
    case '99food': return '99food';
    case 'ifood': return 'ifood';
    case 'shopee': return 'shopee';
    default: return 'other';
  }
};
