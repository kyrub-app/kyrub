import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const eventService = readFileSync(
  'server/delivery/deliveryOperationalEventService.ts',
  'utf8'
);
const tracking = readFileSync(
  'server/delivery/deliveryTrackingRouter.ts',
  'utf8'
);
const pickup = readFileSync(
  'server/delivery/deliveryPickupHandoffService.ts',
  'utf8'
);

test('operational event store is deterministic and idempotent', () => {
  assert.match(eventService, /deliveryOperationalEvents/);
  assert.match(eventService, /`\$\{deliveryId\}:\$\{type\}`/);
  assert.match(eventService, /transaction\.get\(reference\)/);
  assert.match(eventService, /transaction\.create\(reference, event\)/);
  assert.match(eventService, /return same \? event : null/);
});

test('first corroborated store geofence entry persists the canonical arrival event', () => {
  assert.match(tracking, /shouldRecordArrival/);
  assert.match(tracking, /const arrivalAt = Timestamp\.now\(\)/);
  assert.match(tracking, /type: 'courier_entered_store_geofence'/);
  assert.match(tracking, /authority: 'geofence'/);
  assert.match(tracking, /actor: 'courier'/);
  assert.match(tracking, /detectedAt: arrivalAt/);
});

test('secure pickup persists pickup_confirmed with the same server-side collection time', () => {
  assert.match(pickup, /const collectedAt = Timestamp\.now\(\)/);
  assert.match(pickup, /type: 'pickup_confirmed'/);
  assert.match(pickup, /occurredAt: collectedAt\.toDate\(\)\.toISOString\(\)/);
  assert.match(pickup, /authority: 'server'/);
  assert.match(pickup, /actor: 'courier'/);
});

test('operational persistence remains separate from economic materialization', () => {
  assert.doesNotMatch(eventService, /economicObligation|economicSettlement|payout|wallet|custod/i);
  assert.doesNotMatch(pickup, /createPaidWaitingObligationFromApprovedDecision/);
});
