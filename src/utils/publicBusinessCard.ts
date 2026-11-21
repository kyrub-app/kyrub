/** Public storefront links only, never arbitrary URLs, credentials or private routes. */
export function publicBusinessCardUrl(input: string): string | null {
  const raw = input.trim();
  const match = /^(?:https:\/\/kyrub\.com\/)?@?([a-z0-9]+(?:-[a-z0-9]+)*)$/i.exec(raw);
  if (!match || match[1].length > 120) return null;
  return `https://kyrub.com/@${match[1].toLowerCase()}`;
}
export function publicStoreCardMessage(url: string) {
  if (publicBusinessCardUrl(url) !== url) throw Error('INVALID_PUBLIC_CARD');
  return { records: [{ recordType: 'url' as const, data: url }] };
}
export type PublicCardInfo = { url: string; name: string };
export function confirmedPublicCard(url: string, payload: unknown): PublicCardInfo | null {
  if (publicBusinessCardUrl(url) !== url || !payload || typeof payload !== 'object') return null;
  const data = payload as Record<string, unknown>;
  if (!data.store || typeof data.store !== 'object' || !Array.isArray(data.offers)) return null;
  const store = data.store as Record<string, unknown>;
  if (typeof store.slug !== 'string' || typeof store.name !== 'string' ||
      publicBusinessCardUrl(store.slug) !== url || !store.name.trim()) return null;
  return { url, name: store.name.trim().slice(0, 160) };
}
