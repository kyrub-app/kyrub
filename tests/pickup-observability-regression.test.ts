import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const buyerBridge = await readFile(
  new URL('../src/components/store/BuyerPickupCodeBridge.tsx', import.meta.url),
  'utf8'
);
const activityBrowser = await readFile(
  new URL('../src/observability/kyrubActivityBrowser.ts', import.meta.url),
  'utf8'
);
const activityRemote = await readFile(
  new URL('../src/observability/kyrubActivityRemote.ts', import.meta.url),
  'utf8'
);
const activityServer = await readFile(
  new URL('../server/observability/kyrubActivityTransport.ts', import.meta.url),
  'utf8'
);
const health = await readFile(
  new URL('../api/health.ts', import.meta.url),
  'utf8'
);
const orderWorkflow = await readFile(
  new URL('../src/utils/orderWorkflow.ts', import.meta.url),
  'utf8'
);

test('buyer pickup code read is guarded against render-loop requests', () => {
  assert.match(buyerBridge, /requestedOrderIds = useRef\(new Set<string>\(\)\)/);
  assert.match(buyerBridge, /requestedOrderIds\.current\.has\(order\.id\)/);
  assert.match(buyerBridge, /requestedOrderIds\.current\.add\(order\.id\)/);
  assert.doesNotMatch(buyerBridge, /\[codes, errors, orders, storeId, user\]/);
});

test('activity events are batched and sent through an existing serverless entrypoint', () => {
  assert.match(activityBrowser, /enqueueKyrubActivityEvent\(event\)/);
  assert.match(activityRemote, /transport=activity-events/);
  assert.match(activityRemote, /MAX_BATCH_SIZE = 20/);
  assert.match(health, /transport === 'activity-events'/);
});

test('remote activity transport only emits sanitized structured events', () => {
  assert.match(activityServer, /SAFE_IDENTIFIER/);
  assert.match(activityServer, /actorRef: actorReference\(identity\.uid\)/);
  assert.doesNotMatch(activityServer, /actorUid: identity\.uid/);
  assert.match(activityServer, /console\.info\('\[activity\]'/);
});

test('pickup handoff emits attempt and authoritative result semantics without the code', () => {
  assert.match(orderWorkflow, /decision\.handoffCode \? 'pickup\.handoff'/);
  assert.match(orderWorkflow, /interaction\.action_attempted/);
  assert.match(orderWorkflow, /result\.action_succeeded/);
  assert.match(orderWorkflow, /authoritative_write_ack/);
  assert.doesNotMatch(activityRemote, /handoffCode/);
});

test('health transport emits structured pickup and order transition diagnostics', () => {
  assert.match(health, /\[pickup-code-read\]/);
  assert.match(health, /\[order-status\]/);
  assert.match(health, /nextStatus: safeLogIdentifier\(body\.status\)/);
});
