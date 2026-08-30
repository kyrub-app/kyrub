export interface DeliveryCustomerDestinationSnapshot {
  latitude: number;
  longitude: number;
  radiusMeters: number;
  authority: 'kyrub_server';
  source: 'order_delivery_destination';
  snapshottedAt: string;
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const finite = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

export const parseDeliveryCustomerDestinationSnapshot = (
  value: unknown
): DeliveryCustomerDestinationSnapshot | null => {
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
    latitude === null || latitude < -90 || latitude > 90 ||
    longitude === null || longitude < -180 || longitude > 180 ||
    radiusMeters === null || !Number.isSafeInteger(radiusMeters) || radiusMeters <= 0 ||
    !snapshottedAt || Number.isNaN(Date.parse(snapshottedAt))
  ) {
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

export const buildDeliveryCustomerDestinationSnapshot = (input: {
  latitude: number;
  longitude: number;
  radiusMeters: number;
  snapshottedAt: string;
}): DeliveryCustomerDestinationSnapshot => {
  const snapshot = parseDeliveryCustomerDestinationSnapshot({
    ...input,
    authority: 'kyrub_server',
    source: 'order_delivery_destination',
  });
  if (!snapshot) throw new Error('DELIVERY_CUSTOMER_DESTINATION_SNAPSHOT_INVALID');
  return snapshot;
};
