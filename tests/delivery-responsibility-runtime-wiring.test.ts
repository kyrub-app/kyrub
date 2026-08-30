import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const router = readFileSync('server/delivery/deliveryOpportunityRouter.ts', 'utf8');
const orchestrator = readFileSync('server/delivery/deliveryResponsibilityDecisionOrchestrator.ts', 'utf8');
const policyService = readFileSync('server/delivery/deliveryResponsibilityPolicyService.ts', 'utf8');

test('delivery birth freezes responsibility and paid-waiting policy snapshots independently', () => {
  assert.match(router, /loadAuthoritativeDeliveryPaidWaitingPolicy\(\)/);
  assert.match(router, /loadAuthoritativeDeliveryResponsibilityPolicy\(nowIso\)/);
  assert.match(router, /responsibilityPolicySnapshot,/);
  assert.match(router, /responsibilityPolicySnapshotStatus:/);
  assert.match(router, /responsibilityPolicySnapshotAuthority: 'kyrub_platform'/);
  assert.match(router, /responsibilityPolicySnapshotSource: DELIVERY_RESPONSIBILITY_POLICY_PATH/);
  assert.match(policyService, /platformEconomicPolicies\/deliveryOperationalResponsibility/);
  assert.doesNotMatch(policyService, /7\s*\*\s*60|2\s*\*\s*60|DEFAULT_DELIVERY_RESPONSIBILITY_FREE_WINDOWS/);
});

test('post-pickup responsibility orchestration runs only after secure pickup has committed', () => {
  const routeStart = router.indexOf("router.post('/:deliveryId/secure-pickup'");
  const routeEnd = router.indexOf("router.post('/:deliveryId/customer-arrival'");
  const route = router.slice(routeStart, routeEnd);
  const pickupIndex = route.indexOf('await confirmSecureCourierPickupAndStartRoute');
  const orchestratorIndex = route.indexOf('await materializeDeliveryResponsibilityAndWaitingDecision');
  assert.ok(pickupIndex >= 0);
  assert.ok(orchestratorIndex > pickupIndex);
  assert.match(route, /catch \(orchestrationError\)/);
  assert.match(route, /response\.json\(pickupResult\)/);
});

test('orchestration failure cannot roll back or falsely fail an already-confirmed physical pickup', () => {
  const routeStart = router.indexOf("router.post('/:deliveryId/secure-pickup'");
  const routeEnd = router.indexOf("router.post('/:deliveryId/customer-arrival'");
  const route = router.slice(routeStart, routeEnd);
  assert.match(route, /console\.error\('\[Delivery Responsibility Orchestrator\]'/);
  assert.match(route, /response\.json\(pickupResult\)/);
});

test('orchestrator resolves courier identity from authoritative delivery claim', () => {
  assert.match(orchestrator, /DELIVERY_CLAIM_COLLECTION = 'deliveryClaims'/);
  assert.match(orchestrator, /transaction\.get\(claimRef\)/);
  assert.match(orchestrator, /const courierId = clean\(claim\.courierId\)/);
  assert.doesNotMatch(orchestrator, /input\.courierId/);
});

test('missing frozen policy remains fail-closed and cannot materialize an obligation', () => {
  assert.match(orchestrator, /if \(!responsibilityPolicy \|\| !economicPolicy\) return null/);
  assert.match(orchestrator, /decision\.status === 'approved'/);
  assert.match(orchestrator, /createPaidWaitingObligationFromApprovedDecision/);
});
