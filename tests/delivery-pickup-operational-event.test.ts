import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const pickup = readFileSync(
  'server/delivery/deliveryPickupHandoffService.ts',
  'utf8'
);

test('secure pickup reads deterministic operational event before transactional writes', () => {
  assert.match(pickup, /pickup_confirmed:v1/);
  assert.match(pickup, /transaction\.get\(pickupEventRef\)/);
  assert.match(pickup, /pickupEventSnapshot/);
});

test('secure pickup persists pickup_confirmed from the same collectedAt authority', () => {
  assert.match(pickup, /const collectedAt = Timestamp\.now\(\)/);
  assert.match(pickup, /type: 'pickup_confirmed'/);
  assert.match(pickup, /occurredAt = collectedAt\.toDate\(\)\.toISOString\(\)/);
  assert.match(pickup, /authority: 'server'/);
  assert.match(pickup, /actor: 'courier'/);
  assert.match(pickup, /transaction\.create\(pickupEventRef/);
});

test('pickup event and handoff are committed in the same Firestore transaction', () => {
  assert.match(pickup, /transaction\.create\(pickupEventRef/);
  assert.match(pickup, /transaction\.update\(claimRef/);
  assert.match(pickup, /transaction\.update\(deliveryRef/);
  assert.match(pickup, /pickupConfirmedOperationalEventId: pickupEventId/);
  assert.match(pickup, /transaction\.delete\(secretRef\)/);
});

test('pickup event conflict fails closed and contains no economic authority', () => {
  assert.match(pickup, /DELIVERY_PICKUP_OPERATIONAL_EVENT_CONFLICT/);
  assert.match(pickup, /pickupEventMatches/);
  assert.doesNotMatch(
    pickup,
    /type: 'pickup_confirmed'[\s\S]{0,500}(economicObligation|settlement|payout|wallet|custod)/i
  );
});
