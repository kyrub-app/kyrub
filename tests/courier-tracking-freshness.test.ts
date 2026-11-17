import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  COURIER_LOCATION_STALE_AFTER_MS,
  isFreshCourierTrackingTimestamp,
  isPlausibleCourierDeviceCapture,
  COURIER_DEVICE_CAPTURE_MAX_AGE_MS,
  COURIER_DEVICE_CAPTURE_FUTURE_SKEW_MS,
} from '../server/delivery/courierTrackingFreshness';

test('authoritative GPS timestamp expires when the courier stops sending updates', () => {
  const now = Date.now();
  const source = (ms: number) => ({ toMillis: () => ms });
  assert.equal(isFreshCourierTrackingTimestamp(source(now - 10_000), now), true);
  assert.equal(isFreshCourierTrackingTimestamp(source(now - COURIER_LOCATION_STALE_AFTER_MS), now), true);
  assert.equal(isFreshCourierTrackingTimestamp(source(now - COURIER_LOCATION_STALE_AFTER_MS - 1), now), false);
  assert.equal(isFreshCourierTrackingTimestamp(source(now + 10_000), now), false);
  assert.equal(isFreshCourierTrackingTimestamp(null, now), false);
  assert.equal(isFreshCourierTrackingTimestamp({ seconds: now / 1000 }, now), false);
  assert.equal(isFreshCourierTrackingTimestamp({ toMillis: () => NaN }, now), false);
  assert.equal(isFreshCourierTrackingTimestamp({ toMillis: () => { throw new Error('bad'); } }, now), false);
});


test('device GPS timestamp is required and cannot refresh stale geofence evidence', () => {
  const now = 1_800_000_000_000;
  assert.equal(isPlausibleCourierDeviceCapture(now, now), true);
  assert.equal(isPlausibleCourierDeviceCapture(now - 4_000, now), true);
  assert.equal(isPlausibleCourierDeviceCapture(now - COURIER_DEVICE_CAPTURE_MAX_AGE_MS, now), true);
  assert.equal(isPlausibleCourierDeviceCapture(now - COURIER_DEVICE_CAPTURE_MAX_AGE_MS - 1, now), false);
  assert.equal(isPlausibleCourierDeviceCapture(now + COURIER_DEVICE_CAPTURE_FUTURE_SKEW_MS, now), true);
  assert.equal(isPlausibleCourierDeviceCapture(now + COURIER_DEVICE_CAPTURE_FUTURE_SKEW_MS + 1, now), false);
  for (const invalid of [undefined, null, '', '2026-11-17', 0, -1, Number.NaN, Infinity, -Infinity]) {
    assert.equal(isPlausibleCourierDeviceCapture(invalid, now), false, String(invalid));
  }
  assert.equal(isPlausibleCourierDeviceCapture(now, Number.NaN), false);
});
