import {
  STORE_GEOFENCE_MAX_METERS,
  STORE_GEOFENCE_MIN_METERS,
  getDistanceMeters,
  isWithinStoreGeofence,
  validateStoreCoordinates,
  validateStoreGeofenceRadius,
} from '../../shared/storeGeofence';

export {
  STORE_GEOFENCE_MAX_METERS,
  STORE_GEOFENCE_MIN_METERS,
  getDistanceMeters,
  isWithinStoreGeofence,
  validateStoreCoordinates,
  validateStoreGeofenceRadius,
};

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
