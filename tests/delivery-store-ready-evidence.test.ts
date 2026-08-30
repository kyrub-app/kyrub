import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const actionService = readFileSync(
  'server/actions/orderStatusExecutionService.ts',
  'utf8'
);
const manualOrderRouter = readFileSync(
  'server/inventory/orderInventoryRouter.ts',
  'utf8'
);
const inventoryService = readFileSync(
  'server/inventory/orderInventoryService.ts',
  'utf8'
);
const browserWorkflow = readFileSync(
  'src/utils/orderWorkflow.ts',
  'utf8'
);
const readyEvidenceService = readFileSync(
  'server/delivery/deliveryStoreReadyOperationalEventService.ts',
  'utf8'
);

test('manual KDS and Kyrubia share the same atomic ready transition path', () => {
  assert.match(manualOrderRouter, /transitionOrderStatusWithInventory/);
  assert.match(actionService, /transitionOrderStatusWithInventory/);
  assert.match(inventoryService, /nextStatus === 'ready'/);
  assert.match(inventoryService, /writeStoreMarkedReadyEvidenceInTransaction/);
  assert.doesNotMatch(manualOrderRouter, /persistStoreMarkedReadyOperationalEvent/);
  assert.doesNotMatch(actionService, /persistStoreMarkedReadyOperationalEvent/);
});

test('status inventory readyAt and ready evidence are committed by one Firestore transaction', () => {
  assert.match(inventoryService, /adminDb\.runTransaction/);
  assert.match(inventoryService, /await writeStoreMarkedReadyEvidenceInTransaction\(\{/);
  assert.match(inventoryService, /applyInventoryForStatus\(\{/);
  assert.match(readyEvidenceService, /transaction: Transaction/);
  assert.match(readyEvidenceService, /input\.transaction\.set/);
  assert.match(readyEvidenceService, /input\.transaction\.create/);
});

test('browser workflow sends status intent to backend instead of writing Firestore directly', () => {
  assert.match(browserWorkflow, /\/api\/orders\/\$\{encodeURIComponent\(orderId\.trim\(\)\)\}\/status/);
  assert.match(browserWorkflow, /body: JSON\.stringify\(\{ status: nextStatus, decision \}\)/);
  assert.doesNotMatch(browserWorkflow, /updateDoc\(|setDoc\(|writeBatch\(/);
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
  assert.match(readyEvidenceService, /clean\(input\.order\.status\) !== 'ready'/);
  assert.match(readyEvidenceService, /clean\(input\.order\.fulfillmentType\) === 'delivery'/);
  assert.match(readyEvidenceService, /clean\(input\.order\.deliveryProvider\) === 'kyrub'/);
});

test('ready event read happens before ready timestamp writes inside transaction helper', () => {
  const eventRead = readyEvidenceService.indexOf('await input.transaction.get(eventReference)');
  const readyWrite = readyEvidenceService.indexOf('input.transaction.set(');
  assert.ok(eventRead >= 0);
  assert.ok(readyWrite >= 0);
  assert.ok(eventRead < readyWrite);
});
