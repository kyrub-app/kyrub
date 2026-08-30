import {
  getDistanceMeters,
  validateStoreCoordinates,
  validateStoreGeofenceRadius,
} from '../../shared/storeGeofence';

export interface CourierLocationEvidence {
  latitude: number;
  longitude: number;
  accuracy: number;
  clientCapturedAt: number;
}

export interface StoreArrivalAssessment {
  configured: boolean;
  insideGeofence: boolean;
  distanceMeters: number | null;
  radiusMeters: number | null;
  accuracyMeters: number;
}

const finite = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

export const assessCourierStoreArrival = (
  store: Record<string, unknown> | undefined,
  location: CourierLocationEvidence
): StoreArrivalAssessment => {
  const lat = finite(store?.lat);
  const lng = finite(store?.lng);
  const radius = finite(store?.geofenceRadiusMeters);

  if (lat === null || lng === null || radius === null) {
    return {
      configured: false,
      insideGeofence: false,
      distanceMeters: null,
      radiusMeters: null,
      accuracyMeters: location.accuracy,
    };
  }

  try {
    validateStoreCoordinates(lat, lng);
    validateStoreGeofenceRadius(radius);
  } catch {
    return {
      configured: false,
      insideGeofence: false,
      distanceMeters: null,
      radiusMeters: null,
      accuracyMeters: location.accuracy,
    };
  }

  const distanceMeters = Math.round(
    getDistanceMeters(
      { lat, lng },
      { lat: location.latitude, lng: location.longitude }
    )
  );

  return {
    configured: true,
    insideGeofence: distanceMeters <= radius,
    distanceMeters,
    radiusMeters: radius,
    accuracyMeters: location.accuracy,
  };
};
