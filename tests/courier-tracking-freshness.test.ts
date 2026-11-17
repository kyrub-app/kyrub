import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  COURIER_LOCATION_STALE_AFTER_MS,
  isFreshCourierTrackingTimestamp,
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
