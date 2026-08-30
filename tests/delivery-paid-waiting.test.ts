import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { calculateDeliveryPaidWaiting } from '../shared/deliveryPaidWaiting';

const pickup = readFileSync(
  'server/delivery/deliveryPickupHandoffService.ts',
  'utf8'
);

const policy = {
  policyId: 'pickup-wait-v1',
  version: 1,
  enabled: true,
  freeMinutes: 5,
  billingIncrementMinutes: 2,
  amountPerIncrementMinor: 150,
  maxAmountMinor: 600,
  payer: 'store' as const,
};

test('waiting without an explicit policy never creates a charge', () => {
  assert.deepEqual(
    calculateDeliveryPaidWaiting({
      arrivedAtMs: 0,
      collectedAtMs: 15 * 60_000,
      policy: null,
    }),
    {
      totalWaitSeconds: 900,
      freeSeconds: 900,
      billableSeconds: 0,
      billedIncrements: 0,
      amountMinor: 0,
      policyApplied: false,
    }
  );
});

test('waiting applies free time, rounds billable time by increment and caps amount', () => {
  const sevenMinutes = calculateDeliveryPaidWaiting({
    arrivedAtMs: 0,
    collectedAtMs: 7 * 60_000,
    policy,
  });
  assert.equal(sevenMinutes.billableSeconds, 120);
  assert.equal(sevenMinutes.billedIncrements, 1);
  assert.equal(sevenMinutes.amountMinor, 150);

  const longWait = calculateDeliveryPaidWaiting({
    arrivedAtMs: 0,
    collectedAtMs: 30 * 60_000,
    policy,
  });
  assert.equal(longWait.amountMinor, 600);
});

test('negative waiting duration is rejected', () => {
  assert.throws(
    () => calculateDeliveryPaidWaiting({
      arrivedAtMs: 2_000,
      collectedAtMs: 1_000,
      policy,
    }),
    /DELIVERY_WAITING_NEGATIVE_DURATION/
  );
});

test('secure pickup uses server arrival timestamp and server collection timestamp', () => {
  assert.match(pickup, /storeArrivalEvidence/);
  assert.match(pickup, /serverTimestampMillis\(arrival\.detectedAt\)/);
  assert.match(pickup, /const collectedAt = Timestamp\.now\(\)/);
  assert.match(pickup, /source: 'store_geofence_to_secure_pickup'/);
});

test('invalid or missing economic policy cannot block physical pickup or invent charge', () => {
  assert.match(pickup, /policy_missing_or_invalid/);
  assert.match(pickup, /amountMinor: 0/);
  assert.match(pickup, /status: 'not_chargeable'/);
});

test('waiting evidence does not create or settle economic obligations in pickup authority', () => {
  assert.doesNotMatch(
    pickup,
    /economicObligationPath|economicSettlements|buildEconomicSettlement|status:\s*'settled'|payout|transfer|wallet|custod/i
  );
});
