import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
  'server/delivery/deliveryResponsibilityDecisionOrchestrator.ts',
  'utf8'
);
const policySource = readFileSync(
  'server/delivery/deliveryResponsibilityPolicyService.ts',
  'utf8'
);

test('orchestrator consumes canonical events before creating any paid-waiting obligation', () => {
  assert.match(source, /deliveryOperationalEvents/);
  assert.match(source, /assessDeliveryOperationalResponsibility/);
  assert.match(source, /decideDeliveryBillableWaiting/);
  assert.match(source, /decision\.status === 'approved'/);
  assert.match(source, /createPaidWaitingObligationFromApprovedDecision/);
});

test('courier identity comes from the authoritative delivery claim', () => {
  assert.match(source, /deliveryClaims/);
  assert.match(source, /transaction\.get\(claimRef\)/);
  assert.match(source, /const courierId = clean\(claim\.courierId\)/);
  assert.doesNotMatch(source, /input\.courierId/);
});

test('responsibility and economic policy snapshots are required fail-closed', () => {
  assert.match(source, /responsibilityPolicySnapshot/);
  assert.match(source, /waitingPolicySnapshot/);
  assert.match(source, /if \(!responsibilityPolicy \|\| !economicPolicy\) return null/);
  assert.match(policySource, /platformEconomicPolicies\/deliveryOperationalResponsibility/);
  assert.doesNotMatch(policySource, /7 \* 60|5 \* 60|2 \* 60|storeFreeWaitingSeconds:\s*\d+/);
});

test('orchestrator persists assessment and decision before economic materialization', () => {
  const persistence = source.indexOf('responsibilityAssessment: assessment');
  const materialization = source.indexOf('createPaidWaitingObligationFromApprovedDecision');
  assert.ok(persistence >= 0);
  assert.ok(materialization > persistence);
});

test('orchestrator contains no settlement payout wallet or custody action', () => {
  assert.doesNotMatch(source, /economicSettlements|buildEconomicSettlement|payout|transfer|wallet|custod/i);
});
