/** Public store media is curated separately from product showcase media. */
export const MAX_STORE_BANNER_IMAGES = 5;
export const MAX_STORE_GALLERY_IMAGES = 24;

export const normalizeStoreMediaImages = (input: unknown, maximum: number): string[] => {
  if (!Array.isArray(input)) return [];
  const items: string[] = [];
  for (const value of input) {
    if (typeof value !== 'string') continue;
    const url = value.trim();
    // Drive / Photos / Kyrub image storage use HTTPS or app-owned relative routes.
    if (url.length > 2048 || !(url.startsWith('https://') || /^\/(?!\/)/.test(url))) continue;
    if (items.includes(url)) continue;
    items.push(url);
    if (items.length === maximum) break;
  }
  return items;
};

/** Older stores had a single banner string; retain it on first editor open. */
export const storeBannerImages = (store: {
  banner?: string;
  bannerImages?: unknown;
}): string[] => {
  if (Array.isArray(store.bannerImages)) {
    return normalizeStoreMediaImages(store.bannerImages, MAX_STORE_BANNER_IMAGES);
  }
  return normalizeStoreMediaImages(store.banner ? [store.banner] : [], MAX_STORE_BANNER_IMAGES);
};

export const storeGalleryImages = (store: { galleryImages?: unknown }): string[] =>
  normalizeStoreMediaImages(store.galleryImages, MAX_STORE_GALLERY_IMAGES);
