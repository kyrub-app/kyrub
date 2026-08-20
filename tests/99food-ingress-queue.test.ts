import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  advanceOmnichannelCursor,
  buildOmnichannelIdempotencyKey,
  calculateOmnichannelRetryDelayMs,
  canReserveOmnichannelWork,
  decideOmnichannelReconciliation,
} from '../src/utils/omnichannelSyncEngine';

const queueSource = readFileSync(
  'server/integrations/ninetyNineFoodIngressQueue.ts',
  'utf8'
);
const routerSource = readFileSync(
  'server/integrations/ninetyNineFoodRouter.ts',
  'utf8'
);
const protocolSource = readFileSync(
  'server/integrations/openDelivery.ts',
  'utf8'
);
const cursorSource = readFileSync(
  'server/integrations/omnichannelSyncCursorService.ts',
  'utf8'
);

test('webhook validates, persists and returns before business processing', () => {
  assert.match(queueSource, /verifyOpenDeliverySignature/);
  assert.match(queueSource, /integrationIngress/);
  assert.match(queueSource, /status: 'queued'/);
  assert.match(routerSource, /enqueueNinetyNineFoodWebhook/);
  assert.match(routerSource, /response\.status\(200\)\.end\(\)/);
  assert.doesNotMatch(routerSource, /receiveNinetyNineFoodWebhook\(\{/);
});

test('worker applies lease, shared retry policy and idempotent processing', () => {
  assert.match(queueSource, /leaseExpiresAt/);
  assert.match(queueSource, /nextAttemptAt/);
  assert.match(queueSource, /status: 'failed'/);
  assert.match(queueSource, /receiveNinetyNineFoodWebhook/);
  assert.match(queueSource, /calculateOmnichannelRetryDelayMs\(attempts\)/);
  assert.doesNotMatch(queueSource, /15_000 \* 2 \*\*/);
  assert.match(routerSource, /internal\/drain/);
  assert.match(routerSource, /INTEGRATION_CRON_SECRET|cronAuthorized/);
});

test('sync cursor storage is internal, scoped and transactionally monotonic', () => {
  assert.match(cursorSource, /integrationSyncCursors/);
  assert.match(cursorSource, /storeId/);
  assert.match(cursorSource, /channelId/);
  assert.match(cursorSource, /entityType/);
  assert.match(cursorSource, /direction/);
  assert.match(cursorSource, /adminDb\.runTransaction/);
  assert.match(cursorSource, /advanceOmnichannelCursor/);
  assert.doesNotMatch(routerSource, /integrationSyncCursors/);
});

test('OAuth client requests the Open Delivery scope', () => {
  assert.match(protocolSource, /scope: 'od\.all'/);
});

test('omnichannel idempotency key is stable and scoped by channel', () => {
  const first = buildOmnichannelIdempotencyKey({
    storeId: 'store-1',
    channelId: '99food',
    direction: 'inbound',
    entityType: 'order',
    externalEventId: 'event/123',
  });
  const second = buildOmnichannelIdempotencyKey({
    storeId: ' store-1 ',
    channelId: '99food',
    direction: 'inbound',
    entityType: 'order',
    externalEventId: ' event/123 ',
  });

  assert.equal(first, second);
  assert.notEqual(
    first,
    buildOmnichannelIdempotencyKey({
      storeId: 'store-1',
      channelId: 'ifood',
      direction: 'inbound',
      entityType: 'order',
      externalEventId: 'event/123',
    })
  );
});

test('omnichannel retry is exponential and bounded', () => {
  assert.equal(calculateOmnichannelRetryDelayMs(1), 30_000);
  assert.equal(calculateOmnichannelRetryDelayMs(2), 60_000);
  assert.equal(calculateOmnichannelRetryDelayMs(20), 15 * 60_000);
  assert.throws(() => calculateOmnichannelRetryDelayMs(0), /positive integer/i);
});

test('omnichannel work respects processed state, leases and future retry', () => {
  assert.equal(
    canReserveOmnichannelWork({ status: 'processed', nowMs: 100 }),
    false
  );
  assert.equal(
    canReserveOmnichannelWork({
      status: 'processing',
      nowMs: 100,
      leaseExpiresAtMs: 200,
    }),
    false
  );
  assert.equal(
    canReserveOmnichannelWork({
      status: 'failed',
      nowMs: 100,
      nextAttemptAtMs: 200,
    }),
    false
  );
  assert.equal(
    canReserveOmnichannelWork({
      status: 'processing',
      nowMs: 300,
      leaseExpiresAtMs: 200,
    }),
    true
  );
});

test('omnichannel cursor advances monotonically', () => {
  assert.deepEqual(
    advanceOmnichannelCursor(
      { checkpoint: 'page-1', observedAtMs: 100 },
      { checkpoint: 'page-2', observedAtMs: 200 }
    ),
    { checkpoint: 'page-2', observedAtMs: 200 }
  );
  assert.throws(
    () => advanceOmnichannelCursor(
      { checkpoint: 'page-2', observedAtMs: 200 },
      { checkpoint: 'page-1', observedAtMs: 100 }
    ),
    /cannot move backwards/i
  );
});

test('omnichannel reconciliation exposes concurrent divergence as conflict', () => {
  assert.equal(
    decideOmnichannelReconciliation({
      canonicalVersion: 'c2',
      externalVersion: 'e1',
      lastSyncedCanonicalVersion: 'c1',
      lastSyncedExternalVersion: 'e1',
    }),
    'push-canonical'
  );
  assert.equal(
    decideOmnichannelReconciliation({
      canonicalVersion: 'c1',
      externalVersion: 'e2',
      lastSyncedCanonicalVersion: 'c1',
      lastSyncedExternalVersion: 'e1',
    }),
    'pull-external'
  );
  assert.equal(
    decideOmnichannelReconciliation({
      canonicalVersion: 'c2',
      externalVersion: 'e2',
      lastSyncedCanonicalVersion: 'c1',
      lastSyncedExternalVersion: 'e1',
    }),
    'conflict'
  );
  assert.equal(
    decideOmnichannelReconciliation({
      canonicalVersion: 'same',
      externalVersion: 'same',
      lastSyncedCanonicalVersion: 'old-c',
      lastSyncedExternalVersion: 'old-e',
    }),
    'noop'
  );
});
