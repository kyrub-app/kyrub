import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { calculateDeliveryPaidWaiting } from '../shared/deliveryPaidWaiting';
import {
  buildDeliveryPaidWaitingCourierObligation,
  buildDeliveryPaidWaitingObligationId,
} from '../shared/deliveryPaidWaitingObligation';

const pickup = readFileSync(
  'server/delivery/deliveryPickupHandoffService.ts',
  'utf8'
);
const obligationService = readFileSync(
  'server/delivery/deliveryPaidWaitingObligationService.ts',
  'utf8'
);
const orchestrator = readFileSync(
  'server/delivery/deliveryResponsibilityDecisionOrchestrator.ts',
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

const obligationInput = (payer: 'store' | 'kyrub', amountMinor: number, policyVersion = 1) => ({
  canonicalStoreId: 'store-1',
  orderId: 'order-1',
  deliveryId: 'delivery-1',
  courierId: 'courier-1',
  amountMinor,
  payer,
  policyId: `pickup-wait-v${policyVersion}`,
  policyVersion,
  responsibilityPolicyId: 'delivery-responsibility-v1',
  responsibilityPolicyVersion: 1,
  decidedAt: '2026-08-30T05:30:00.000Z',
});

test('waiting without an explicit policy never creates a charge', () => {
  assert.deepEqual(
    calculateDeliveryPaidWaiting({ arrivedAtMs: 0, collectedAtMs: 15 * 60_000, policy: null }),
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
  const sevenMinutes = calculateDeliveryPaidWaiting({ arrivedAtMs: 0, collectedAtMs: 7 * 60_000, policy });
  assert.equal(sevenMinutes.billableSeconds, 120);
  assert.equal(sevenMinutes.billedIncrements, 1);
  assert.equal(sevenMinutes.amountMinor, 150);

  const longWait = calculateDeliveryPaidWaiting({ arrivedAtMs: 0, collectedAtMs: 30 * 60_000, policy });
  assert.equal(longWait.amountMinor, 600);
});

test('negative waiting duration is rejected', () => {
  assert.throws(
    () => calculateDeliveryPaidWaiting({ arrivedAtMs: 2_000, collectedAtMs: 1_000, policy }),
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
  assert.match(obligationService, /return null/);
});

test('paid waiting obligation is deterministic, pending and references its approved decision', () => {
  assert.equal(
    buildDeliveryPaidWaitingObligationId({ deliveryId: 'delivery-1', courierId: 'courier-1' }),
    'obligation:courier_payable:waiting:delivery-1:courier-1'
  );
  const obligation = buildDeliveryPaidWaitingCourierObligation(obligationInput('store', 300));
  assert.equal(obligation.kind, 'courier_payable');
  assert.equal(obligation.status, 'pending');
  assert.equal(obligation.beneficiaryPrincipalId, 'courier-1');
  assert.equal(obligation.payer, 'store');
  assert.equal(obligation.payerPrincipalId, 'store:store-1');
  assert.equal(obligation.sourceAuthority, 'delivery_paid_waiting');
  assert.equal(obligation.amountMinor, 300);
  assert.equal(obligation.billableWaitingDecisionRef, 'delivery:delivery-1:billableWaitingDecision');
  assert.equal(obligation.responsibilityPolicyId, 'delivery-responsibility-v1');
  assert.equal(obligation.eligibleAt, '');
});

test('kyrub-funded waiting is explicit funding and is not charged to customer', () => {
  const obligation = buildDeliveryPaidWaitingCourierObligation(obligationInput('kyrub', 450, 2));
  assert.equal(obligation.funding.customerMinor, 0);
  assert.equal(obligation.funding.kyrubMinor, 450);
  assert.equal(obligation.payerPrincipalId, 'kyrub:platform');
});

test('paid-waiting obligation materializes only after an approved responsibility decision', () => {
  assert.doesNotMatch(pickup, /createPaidWaitingObligationFromApprovedDecision/);
  assert.doesNotMatch(pickup, /decision:\s*delivery\.billableWaitingDecision/);
  assert.match(orchestrator, /decision\.status === 'approved'/);
  assert.match(orchestrator, /createPaidWaitingObligationFromApprovedDecision/);
  assert.match(orchestrator, /decision,/);
  assert.match(obligationService, /raw\.status !== 'approved'/);
  assert.match(obligationService, /kyrub_billable_waiting_decision_engine/);
  assert.match(obligationService, /economicObligations/);
  assert.doesNotMatch(
    `${pickup}\n${orchestrator}\n${obligationService}`,
    /economicSettlements|buildEconomicSettlement|status:\s*'settled'|payout|transfer|wallet|custod/i
  );
});
