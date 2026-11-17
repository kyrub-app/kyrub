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
