import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  assessCourierCustomerArrival,
  parseCustomerGeofenceSnapshot,
} from '../server/delivery/customerArrivalEvidence';

const tracking = readFileSync(
  'server/delivery/deliveryTrackingRouter.ts',
  'utf8'
);
const assessmentSource = readFileSync(
  'server/delivery/customerArrivalEvidence.ts',
  'utf8'
);

const location = {
  latitude: -23.5505,
  longitude: -46.6333,
  accuracy: 10,
  clientCapturedAt: 1,
};

const snapshot = {
  latitude: -23.5505,
  longitude: -46.6333,
  radiusMeters: 80,
  authority: 'kyrub_server' as const,
  source: 'order_delivery_destination' as const,
  snapshottedAt: '2026-08-30T18:00:00.000Z',
};

test('customer geofence fails closed without a frozen server destination', () => {
  const result = assessCourierCustomerArrival(null, location);
  assert.equal(result.configured, false);
  assert.equal(result.authoritativeDestination, false);
  assert.equal(result.insideGeofence, false);
});

test('client or courier supplied destination authority is rejected', () => {
  assert.equal(
    parseCustomerGeofenceSnapshot({ ...snapshot, authority: 'courier_action' }),
    null
  );
  assert.equal(
    parseCustomerGeofenceSnapshot({ ...snapshot, source: 'request_body' }),
    null
  );
});

test('server-frozen destination can corroborate courier location', () => {
  const result = assessCourierCustomerArrival(snapshot, location);
  assert.equal(result.configured, true);
  assert.equal(result.authoritativeDestination, true);
  assert.equal(result.insideGeofence, true);
  assert.equal(result.distanceMeters, 0);
  assert.equal(result.radiusMeters, 80);
});

test('customer geofence radius is explicit and never hidden as a runtime default', () => {
  assert.match(assessmentSource, /radiusMeters/);
  assert.doesNotMatch(assessmentSource, /DEFAULT_.*RADIUS|\?\?\s*\d+|radiusMeters:\s*\d+/);
});

test('tracking only emits customer geofence event while delivering with authoritative destination', () => {
  assert.match(tracking, /deliveryStatus === 'delivering'/);
  assert.match(tracking, /customerAssessment\.authoritativeDestination/);
  assert.match(tracking, /type: 'courier_entered_customer_geofence'/);
  assert.match(tracking, /authority: 'geofence'/);
  assert.match(tracking, /destinationAuthority: 'kyrub_server'/);
});

test('tracking consumes destination only from canonical delivery state, not request body', () => {
  assert.match(
    tracking,
    /assessCourierCustomerArrival\(\s*delivery\.customerGeofenceSnapshot,\s*location\s*\)/
  );
  assert.doesNotMatch(tracking, /request\.body.*customerGeofenceSnapshot/);
});

test('customer geofence evidence itself carries no economic authority', () => {
  assert.doesNotMatch(
    `${tracking}\n${assessmentSource}`,
    /economicObligations|economicSettlements|payout|wallet|custod|customerCharge/i
  );
});
