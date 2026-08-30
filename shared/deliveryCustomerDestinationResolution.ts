export type DeliveryCustomerDestinationResolutionStatus =
  | 'resolved'
  | 'review_required';

export type DeliveryCustomerDestinationLocationType =
  | 'ROOFTOP'
  | 'RANGE_INTERPOLATED'
  | 'GEOMETRIC_CENTER'
  | 'APPROXIMATE'
  | 'UNKNOWN';

export interface DeliveryCustomerDestinationResolution {
  schemaVersion: 1;
  inputAddress: string;
  formattedAddress: string;
  placeId: string;
  latitude: number;
  longitude: number;
  locationType: DeliveryCustomerDestinationLocationType;
  partialMatch: boolean;
  status: DeliveryCustomerDestinationResolutionStatus;
  provider: 'google_maps';
  authority: 'kyrub_server';
  source: 'google_geocoding';
  resolvedAt: string;
}

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const finite = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const parseLocationType = (
  value: unknown
): DeliveryCustomerDestinationLocationType => {
  if (
    value === 'ROOFTOP' ||
    value === 'RANGE_INTERPOLATED' ||
    value === 'GEOMETRIC_CENTER' ||
    value === 'APPROXIMATE'
  ) {
    return value;
  }
  return 'UNKNOWN';
};

export const parseDeliveryCustomerDestinationResolution = (
  value: unknown
): DeliveryCustomerDestinationResolution | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const latitude = finite(raw.latitude);
  const longitude = finite(raw.longitude);
  const resolvedAt = clean(raw.resolvedAt);
  const status = raw.status;
  if (
    raw.schemaVersion !== 1 ||
    raw.provider !== 'google_maps' ||
    raw.authority !== 'kyrub_server' ||
    raw.source !== 'google_geocoding' ||
    (status !== 'resolved' && status !== 'review_required') ||
    latitude === null || latitude < -90 || latitude > 90 ||
    longitude === null || longitude < -180 || longitude > 180 ||
    !clean(raw.inputAddress) ||
    !clean(raw.formattedAddress) ||
    !clean(raw.placeId) ||
    !resolvedAt || Number.isNaN(Date.parse(resolvedAt))
  ) {
    return null;
  }
  return {
    schemaVersion: 1,
    inputAddress: clean(raw.inputAddress),
    formattedAddress: clean(raw.formattedAddress),
    placeId: clean(raw.placeId),
    latitude,
    longitude,
    locationType: parseLocationType(raw.locationType),
    partialMatch: raw.partialMatch === true,
    status,
    provider: 'google_maps',
    authority: 'kyrub_server',
    source: 'google_geocoding',
    resolvedAt: new Date(resolvedAt).toISOString(),
  };
};

export const buildDeliveryCustomerDestinationResolution = (input: {
  inputAddress: string;
  formattedAddress: string;
  placeId: string;
  latitude: number;
  longitude: number;
  locationType: unknown;
  partialMatch: boolean;
  resolvedAt: string;
}): DeliveryCustomerDestinationResolution => {
  const locationType = parseLocationType(input.locationType);
  const resolution = parseDeliveryCustomerDestinationResolution({
    schemaVersion: 1,
    ...input,
    locationType,
    status:
      input.partialMatch || locationType === 'APPROXIMATE' || locationType === 'UNKNOWN'
        ? 'review_required'
        : 'resolved',
    provider: 'google_maps',
    authority: 'kyrub_server',
    source: 'google_geocoding',
  });
  if (!resolution) {
    throw new Error('DELIVERY_CUSTOMER_DESTINATION_RESOLUTION_INVALID');
  }
  return resolution;
};
