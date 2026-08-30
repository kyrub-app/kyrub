import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const handoff = readFileSync(
  'server/delivery/deliveryCustomerHandoffService.ts',
  'utf8'
);
const assessment = readFileSync(
  'shared/deliveryResponsibilityAssessment.ts',
  'utf8'
);

test('courier customer-arrival action becomes canonical but non-authoritative location evidence', () => {
  assert.match(handoff, /type: 'courier_arrived_customer'/);
  assert.match(handoff, /authority: 'courier_action'/);
  assert.match(handoff, /actor: 'courier'/);
  assert.match(handoff, /persistDeliveryOperationalEvent/);
  assert.doesNotMatch(
    handoff,
    /type: 'courier_arrived_customer'[\s\S]{0,240}authority: 'geofence'/
  );
});

test('customer arrival timestamp is server minted and reused by handoff state', () => {
  assert.match(handoff, /Timestamp\.now\(\)\.toDate\(\)\.toISOString\(\)/);
  assert.match(handoff, /arrivedAt: Timestamp\.fromDate\(new Date\(arrivedAt\)\)/);
});

test('buyer confirmation persists customer_available and delivery_confirmed in the completion transaction', () => {
  assert.match(handoff, /type: 'customer_available'/);
  assert.match(handoff, /type: 'delivery_confirmed'/);
  assert.match(handoff, /authority: 'customer_action'/);
  assert.match(handoff, /actor: 'customer'/);
  assert.match(handoff, /occurredAt: confirmedAt/);
  assert.match(handoff, /transaction\.create\(completionRef, completion\)/);
});

test('courier-declared arrival alone cannot establish authoritative customer location', () => {
  assert.match(assessment, /courier_entered_customer_geofence/);
  assert.match(assessment, /location_evidence_conflict/);
  assert.match(assessment, /evidenceStatus: authoritativeArrival \? 'corroborated' : 'review_required'/);
});

test('customer handoff events do not directly create economic settlement or custody', () => {
  assert.doesNotMatch(
    handoff,
    /type: '(courier_arrived_customer|customer_available|delivery_confirmed)'[\s\S]{0,420}(economicSettlements|buildEconomicSettlement|payout|wallet|custod|bankTransfer)/i
  );
});
