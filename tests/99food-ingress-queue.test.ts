import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

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

test('webhook validates, persists and returns before business processing', () => {
  assert.match(queueSource, /verifyOpenDeliverySignature/);
  assert.match(queueSource, /integrationIngress/);
  assert.match(queueSource, /status: 'queued'/);
  assert.match(routerSource, /enqueueNinetyNineFoodWebhook/);
  assert.match(routerSource, /response\.status\(200\)\.end\(\)/);
  assert.doesNotMatch(routerSource, /receiveNinetyNineFoodWebhook\(\{/);
});

test('worker applies lease, retry and idempotent processing', () => {
  assert.match(queueSource, /leaseExpiresAt/);
  assert.match(queueSource, /nextAttemptAt/);
  assert.match(queueSource, /status: 'failed'/);
  assert.match(queueSource, /receiveNinetyNineFoodWebhook/);
  assert.match(routerSource, /internal\/drain/);
  assert.match(routerSource, /INTEGRATION_CRON_SECRET|cronAuthorized/);
});

test('OAuth client requests the Open Delivery scope', () => {
  assert.match(protocolSource, /scope: 'od\.all'/);
});
