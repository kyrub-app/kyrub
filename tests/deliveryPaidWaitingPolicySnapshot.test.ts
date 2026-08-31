import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const policyService = readFileSync(
  'server/delivery/deliveryPaidWaitingPolicyService.ts',
  'utf8'
);
const opportunityRouter = readFileSync(
  'server/delivery/deliveryOpportunityRouter.ts',
  'utf8'
);

test('paid waiting policy comes only from the platform authority document', () => {
  assert.match(
    policyService,
    /platformEconomicPolicies\/deliveryPaidWaiting/
  );
  assert.match(policyService, /raw\.enabled !== true/);
  assert.match(policyService, /return null/);
  assert.match(policyService, /payer === 'store' \|\| raw\.payer === 'kyrub'/);
});

test('new delivery freezes the current policy snapshot and records its authority', () => {
  assert.match(
    opportunityRouter,
    /existing\.exists\s*\? null\s*:\s*await loadAuthoritativeDeliveryPaidWaitingPolicy\(\)/
  );
  assert.match(opportunityRouter, /waitingPolicySnapshotAuthority: 'kyrub_platform'/);
  assert.match(
    opportunityRouter,
    /waitingPolicySnapshotSource: DELIVERY_PAID_WAITING_POLICY_PATH/
  );
  assert.match(opportunityRouter, /waitingPolicySnapshottedAt: now/);
});

test('republishing an existing delivery never refreshes its frozen waiting policy', () => {
  assert.match(
    opportunityRouter,
    /\.\.\.\(existing\.exists\s*\? \{\}\s*:\s*\{[\s\S]*waitingPolicySnapshot,[\s\S]*\}\)/
  );
});
