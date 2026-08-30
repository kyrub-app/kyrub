export const STORE_GEOFENCE_MIN_METERS = 25 as const;
export const STORE_GEOFENCE_MAX_METERS = 1000 as const;

export interface StoreGeofencePoint {
  lat: number;
  lng: number;
}

export interface StoreGeofenceDefinition extends StoreGeofencePoint {
  geofenceRadiusMeters: number;
}

const toRadians = (degrees: number): number => degrees * (Math.PI / 180);

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

export const getDistanceMeters = (
  from: StoreGeofencePoint,
  to: StoreGeofencePoint
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
  store: StoreGeofenceDefinition;
  position: StoreGeofencePoint;
}): boolean => {
  validateStoreGeofenceRadius(input.store.geofenceRadiusMeters);
  return getDistanceMeters(input.store, input.position) <= input.store.geofenceRadiusMeters;
};
