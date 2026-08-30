import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const tracking = readFileSync(
  'server/delivery/deliveryTrackingRouter.ts',
  'utf8'
);
const opportunity = readFileSync(
  'server/delivery/deliveryOpportunityRouter.ts',
  'utf8'
);
const pickup = readFileSync(
  'server/delivery/deliveryPickupHandoffService.ts',
  'utf8'
);
const orchestrator = readFileSync(
  'server/delivery/deliveryResponsibilityDecisionOrchestrator.ts',
  'utf8'
);
const policyService = readFileSync(
  'server/delivery/deliveryResponsibilityPolicyService.ts',
  'utf8'
);

test('store geofence arrival becomes canonical operational evidence', () => {
  assert.match(tracking, /courier_entered_store_geofence/);
  assert.match(tracking, /authority: 'geofence'/);
  assert.match(tracking, /persistDeliveryOperationalEvent/);
});

test('delivery birth freezes an explicit responsibility policy snapshot', () => {
  assert.match(opportunity, /loadAuthoritativeDeliveryResponsibilityPolicy/);
  assert.match(opportunity, /responsibilityPolicySnapshot/);
  assert.match(opportunity, /responsibilityPolicySnapshotAuthority: 'kyrub_platform'/);
  assert.match(policyService, /storeFreeWaitingSeconds/);
  assert.match(policyService, /customerFreeWaitingSeconds/);
  assert.doesNotMatch(policyService, /\b420\b|\b120\b/);
});

test('secure pickup triggers post-event responsibility materialization', () => {
  assert.match(opportunity, /confirmSecureCourierPickupAndStartRoute/);
  assert.match(opportunity, /materializeDeliveryResponsibilityAndWaitingDecision/);
  assert.match(opportunity, /catch \(orchestrationError\)/);
});

test('secure pickup does not materialize an economic obligation directly', () => {
  assert.doesNotMatch(pickup, /createPaidWaitingObligationFromApprovedDecision/);
  assert.doesNotMatch(pickup, /deliveryPaidWaitingObligationService/);
  assert.match(pickup, /post-event orchestrator/);
  assert.match(pickup, /type: 'pickup_confirmed'/);
});

test('runtime materialization consumes canonical events before economic decision', () => {
  assert.match(orchestrator, /deliveryOperationalEvents/);
  assert.match(orchestrator, /assessDeliveryOperationalResponsibility/);
  assert.match(orchestrator, /decideDeliveryBillableWaiting/);
  assert.match(orchestrator, /decision\.status === 'approved'/);
  assert.match(orchestrator, /createPaidWaitingObligationFromApprovedDecision/);
});

test('conflicting responsibility and economic free windows fail closed', () => {
  assert.match(orchestrator, /waitingFreeWindowMatches/);
  assert.match(
    orchestrator,
    /responsibilityPolicy\.storeFreeWaitingSeconds === economicPolicy\.freeMinutes \* 60/
  );
  assert.match(orchestrator, /free_window_mismatch/);
  assert.match(orchestrator, /obligationCreated: false/);
});

test('runtime layer does not settle, payout or create custodial balances', () => {
  assert.doesNotMatch(
    orchestrator,
    /economicSettlements|buildEconomicSettlement|payout|wallet|custod|bankTransfer/i
  );
});
