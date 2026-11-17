/**
 * Last known location is not live tracking. Gate precise-position responses
 * using the server-managed Firestore updatedAt timestamp, never device time.
 */
export const COURIER_LOCATION_STALE_AFTER_MS = 90_000;
export const COURIER_LOCATION_FUTURE_SKEW_MS = 5_000;

export const isFreshCourierTrackingTimestamp = (
  updatedAt: unknown,
  nowMs: number = Date.now()
): boolean => {
  if (!Number.isFinite(nowMs) || !updatedAt || typeof updatedAt !== 'object') return false;
  const timestamp = updatedAt as { toMillis?: unknown };
  if (typeof timestamp.toMillis !== 'function') return false;
  let lastUpdate: number;
  try {
    lastUpdate = (timestamp.toMillis as () => number)();
  } catch {
    return false;
  }
  return Number.isFinite(lastUpdate)
    && lastUpdate <= nowMs + COURIER_LOCATION_FUTURE_SKEW_MS
    && nowMs - lastUpdate <= COURIER_LOCATION_STALE_AFTER_MS;
};


/**
 * Reject delayed/replayed positions before they can refresh the server-side
 * tracking timestamp or produce arrival geofence evidence.
 * Device clock values are not antifraud proof; they are only a freshness gate.
 * The tolerance accommodates ordinary phone clock skew and mobile latency.
 */
export const COURIER_DEVICE_CAPTURE_MAX_AGE_MS = 120_000;
export const COURIER_DEVICE_CAPTURE_FUTURE_SKEW_MS = 30_000;

export const isPlausibleCourierDeviceCapture = (
  capturedAt: unknown,
  nowMs: number = Date.now()
): boolean =>
  typeof capturedAt === 'number'
  && Number.isFinite(capturedAt)
  && capturedAt > 0
  && Number.isFinite(nowMs)
  && capturedAt <= nowMs + COURIER_DEVICE_CAPTURE_FUTURE_SKEW_MS
  && nowMs - capturedAt <= COURIER_DEVICE_CAPTURE_MAX_AGE_MS;
