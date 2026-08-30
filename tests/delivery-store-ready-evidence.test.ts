import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const actionService = readFileSync(
  'server/actions/orderStatusExecutionService.ts',
  'utf8'
);
const readyEvidenceService = readFileSync(
  'server/delivery/deliveryStoreReadyOperationalEventService.ts',
  'utf8'
);

test('ready transition invokes server-side operational evidence persistence', () => {
  assert.match(actionService, /normalizedProposal\.nextStatus === 'ready'/);
  assert.match(actionService, /persistStoreMarkedReadyOperationalEvent/);
  assert.match(actionService, /actorUid: actor\.uid/);
});

test('client cannot provide historical ready evidence timestamps', () => {
  assert.doesNotMatch(readyEvidenceService, /input\.readyAt|input\.occurredAt|input\.recordedAt/);
  assert.match(readyEvidenceService, /FieldValue\.serverTimestamp\(\)/);
  assert.match(readyEvidenceService, /Timestamp\.now\(\)/);
  assert.match(readyEvidenceService, /readyAtAuthority: 'kyrub_server'/);
});

test('store ready evidence is deterministic, idempotent and non-economic', () => {
  assert.match(readyEvidenceService, /store_marked_ready:v1/);
  assert.match(readyEvidenceService, /existingEvent\.exists/);
  assert.match(readyEvidenceService, /type: 'store_marked_ready'/);
  assert.match(readyEvidenceService, /authority: 'store_action'/);
  assert.match(readyEvidenceService, /actor: 'store'/);
  assert.doesNotMatch(
    readyEvidenceService,
    /economicObligations|economicSettlements|billableWaitingDecision|payout|transfer|wallet|custod/i
  );
});

test('operational event is only emitted for Kyrub delivery orders already in ready state', () => {
  assert.match(readyEvidenceService, /clean\(order\.status\) !== 'ready'/);
  assert.match(readyEvidenceService, /clean\(order\.fulfillmentType\) === 'delivery'/);
  assert.match(readyEvidenceService, /clean\(order\.deliveryProvider\) === 'kyrub'/);
});
