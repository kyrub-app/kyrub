/** Canonical distance predicate for published marketplace stores.
 * When the filter is disabled, stores without coordinates remain visible.
 */
export interface MarketplaceCoordinates {
  lat: number;
  lng: number;
}

export function matchesMarketplaceDistance(
  store: { lat?: number; lng?: number },
  enabled: boolean,
  userCoords: MarketplaceCoordinates | null,
  radiusKm: number,
  getDistance: (lat1: number, lng1: number, lat2: number, lng2: number) => number
): boolean {
  if (!enabled || !userCoords) return true;
  if (!Number.isFinite(store.lat) || !Number.isFinite(store.lng)) return false;
  const distance = getDistance(
    userCoords.lat,
    userCoords.lng,
    store.lat as number,
    store.lng as number
  );
  return Number.isFinite(distance) && distance <= radiusKm;
}
