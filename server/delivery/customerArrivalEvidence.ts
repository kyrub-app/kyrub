import { getDistanceMeters } from '../../shared/storeGeofence';
import {
  parseDeliveryCustomerDestinationSnapshot,
  type DeliveryCustomerDestinationSnapshot,
} from '../../shared/deliveryCustomerDestination.js';

export interface CourierCustomerLocationEvidence {
  latitude: number;
  longitude: number;
  accuracy: number;
  clientCapturedAt: number;
}

export type CustomerGeofenceSnapshot = DeliveryCustomerDestinationSnapshot;

export interface CustomerArrivalAssessment {
  configured: boolean;
  authoritativeDestination: boolean;
  insideGeofence: boolean;
  distanceMeters: number | null;
  radiusMeters: number | null;
  accuracyMeters: number;
}

export const parseCustomerGeofenceSnapshot = (
  value: unknown
): CustomerGeofenceSnapshot | null =>
  parseDeliveryCustomerDestinationSnapshot(value);

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
