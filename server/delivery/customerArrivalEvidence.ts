import {
  getDistanceMeters,
  validateStoreCoordinates,
  validateStoreGeofenceRadius,
} from '../../shared/storeGeofence';

export interface CourierCustomerLocationEvidence {
  latitude: number;
  longitude: number;
  accuracy: number;
  clientCapturedAt: number;
}

export interface CustomerGeofenceSnapshot {
  latitude: number;
  longitude: number;
  radiusMeters: number;
  authority: 'kyrub_server';
  source: 'order_delivery_destination';
  snapshottedAt: string;
}

export interface CustomerArrivalAssessment {
  configured: boolean;
  authoritativeDestination: boolean;
  insideGeofence: boolean;
  distanceMeters: number | null;
  radiusMeters: number | null;
  accuracyMeters: number;
}

const finite = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

export const parseCustomerGeofenceSnapshot = (
  value: unknown
): CustomerGeofenceSnapshot | null => {
  const raw = record(value);
  const latitude = finite(raw.latitude);
  const longitude = finite(raw.longitude);
  const radiusMeters = finite(raw.radiusMeters);
  const snapshottedAt = typeof raw.snapshottedAt === 'string'
    ? raw.snapshottedAt.trim()
    : '';

  if (
    raw.authority !== 'kyrub_server' ||
    raw.source !== 'order_delivery_destination' ||
    latitude === null ||
    longitude === null ||
    radiusMeters === null ||
    !snapshottedAt ||
    Number.isNaN(Date.parse(snapshottedAt))
  ) {
    return null;
  }

  try {
    validateStoreCoordinates(latitude, longitude);
    validateStoreGeofenceRadius(radiusMeters);
  } catch {
    return null;
  }

  return {
    latitude,
    longitude,
    radiusMeters,
    authority: 'kyrub_server',
    source: 'order_delivery_destination',
    snapshottedAt: new Date(snapshottedAt).toISOString(),
  };
};

export const assessCourierCustomerArrival = (
  snapshotValue: unknown,
  location: CourierCustomerLocationEvidence
): CustomerArrivalAssessment => {
  const snapshot = parseCustomerGeofenceSnapshot(snapshotValue);
  if (!snapshot) {
    return {
      configured: false,
      authoritativeDestination: false,
      insideGeofence: false,
      distanceMeters: null,
      radiusMeters: null,
      accuracyMeters: location.accuracy,
    };
  }

  const distanceMeters = Math.round(
    getDistanceMeters(
      { lat: snapshot.latitude, lng: snapshot.longitude },
      { lat: location.latitude, lng: location.longitude }
    )
  );

  return {
    configured: true,
    authoritativeDestination: true,
    insideGeofence: distanceMeters <= snapshot.radiusMeters,
    distanceMeters,
    radiusMeters: snapshot.radiusMeters,
    accuracyMeters: location.accuracy,
  };
};
