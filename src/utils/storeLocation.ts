export const STORE_GEOFENCE_MIN_METERS = 25 as const;
export const STORE_GEOFENCE_MAX_METERS = 1000 as const;

export interface StoreLocationDraft {
  latitude: string;
  longitude: string;
  geofenceRadiusMeters: string;
}

export interface StoreLocationSnapshot {
  lat?: number;
  lng?: number;
  geofenceRadiusMeters?: number;
}

const parseNumber = (value: string): number =>
  Number(value.trim().replace(',', '.'));

export const hasStoreCoordinates = (value: {
  lat?: number;
  lng?: number;
}): boolean =>
  typeof value.lat === 'number' &&
  Number.isFinite(value.lat) &&
  typeof value.lng === 'number' &&
  Number.isFinite(value.lng);

export const validateStoreCoordinates = (lat: number, lng: number): void => {
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    throw new Error('Informe uma latitude válida entre -90 e 90.');
  }
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
    throw new Error('Informe uma longitude válida entre -180 e 180.');
  }
};

export const validateStoreGeofenceRadius = (radius: number): void => {
  if (
    !Number.isSafeInteger(radius) ||
    radius < STORE_GEOFENCE_MIN_METERS ||
    radius > STORE_GEOFENCE_MAX_METERS
  ) {
    throw new Error(
      `Informe um raio de presença entre ${STORE_GEOFENCE_MIN_METERS} e ${STORE_GEOFENCE_MAX_METERS} metros.`
    );
  }
};

export const parseStoreLocationDraft = (
  draft: StoreLocationDraft
): StoreLocationSnapshot => {
  const latitude = draft.latitude.trim();
  const longitude = draft.longitude.trim();
  const radius = draft.geofenceRadiusMeters.trim();

  if (!latitude && !longitude && !radius) return {};
  if (!latitude || !longitude) {
    throw new Error('Preencha latitude e longitude juntas.');
  }

  const lat = parseNumber(latitude);
  const lng = parseNumber(longitude);
  validateStoreCoordinates(lat, lng);

  if (!radius) {
    throw new Error('Informe o raio de presença da loja em metros.');
  }
  const geofenceRadiusMeters = Number(radius);
  validateStoreGeofenceRadius(geofenceRadiusMeters);

  return { lat, lng, geofenceRadiusMeters };
};

const toRadians = (degrees: number): number => degrees * (Math.PI / 180);

export const getDistanceMeters = (
  from: { lat: number; lng: number },
  to: { lat: number; lng: number }
): number => {
  validateStoreCoordinates(from.lat, from.lng);
  validateStoreCoordinates(to.lat, to.lng);

  const earthRadiusMeters = 6_371_000;
  const latitudeDelta = toRadians(to.lat - from.lat);
  const longitudeDelta = toRadians(to.lng - from.lng);
  const fromLatitude = toRadians(from.lat);
  const toLatitude = toRadians(to.lat);
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(fromLatitude) *
      Math.cos(toLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;
  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

export const isWithinStoreGeofence = (input: {
  store: { lat: number; lng: number; geofenceRadiusMeters: number };
  position: { lat: number; lng: number };
}): boolean => {
  validateStoreGeofenceRadius(input.store.geofenceRadiusMeters);
  return getDistanceMeters(input.store, input.position) <= input.store.geofenceRadiusMeters;
};
