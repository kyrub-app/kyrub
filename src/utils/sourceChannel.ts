export type CanonicalSourceChannel = 'kyrub-shop' | 'open-delivery' | 'ifood' | '99food' | 'mercado-livre' | 'shopee' | 'sefaz' | 'external';

const aliases: Record<string, CanonicalSourceChannel> = {
  kyrub: 'kyrub-shop',
  'kyrub-shop': 'kyrub-shop',
  open_delivery: 'open-delivery',
  'open-delivery': 'open-delivery',
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
