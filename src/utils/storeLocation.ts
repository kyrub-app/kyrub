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

/** Additional access or pickup points belonging to one canonical store. */
export type StoreOperationalPointPurpose = 'pickup' | 'staff-access' | 'attendance';

export interface StoreOperationalPoint {
  id: string;
  name: string;
  purpose: StoreOperationalPointPurpose;
  lat: number;
  lng: number;
  instructions: string;
  geofenceRadiusMeters?: number;
}

/** Validate without mutating the canonical store coordinates or legacy geofence. */
export const validateStoreOperationalPoint = (point: StoreOperationalPoint): StoreOperationalPoint => {
  const id = point.id.trim();
  const name = point.name.trim();
  const instructions = point.instructions.trim();
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) throw new Error('Identificador de ponto operacional inválido.');
  if (!name || name.length > 100) throw new Error('Informe um nome de ponto operacional com até 100 caracteres.');
  if (instructions.length > 500) throw new Error('As instruções do ponto devem ter até 500 caracteres.');
  if (!(['pickup', 'staff-access', 'attendance'] as const).includes(point.purpose)) throw new Error('Finalidade do ponto operacional inválida.');
  validateStoreCoordinates(point.lat, point.lng);
  if (point.purpose === 'attendance') {
    if (point.geofenceRadiusMeters === undefined) throw new Error('Informe o raio autorizado para registro de ponto.');
    validateStoreGeofenceRadius(point.geofenceRadiusMeters);
  } else if (point.geofenceRadiusMeters !== undefined) {
    throw new Error('O raio de presença só pode ser definido em pontos de registro de ponto.');
  }
  return { ...point, id, name, instructions };
};
