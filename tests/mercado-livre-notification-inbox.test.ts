import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parseMercadoLivreNotification } from '../server/integrations/mercadoLivreNotificationInboxService.js';

test('Mercado Livre notification parser accepts the provider envelope without treating it as catalog state', () => {
  const parsed = parseMercadoLivreNotification({
    _id: 'notification-1',
    resource: '/items/MLB123',
    user_id: 123456789,
    topic: 'items',
    application_id: 987654321,
    attempts: 1,
    sent: '2026-08-31T11:00:00.000Z',
  });
  assert.equal(parsed.notificationId, 'notification-1');
  assert.equal(parsed.externalAccountId, '123456789');
  assert.equal(parsed.applicationId, '987654321');
  assert.equal(parsed.resource, '/items/MLB123');
  assert.equal(parsed.topic, 'items');
});

test('Mercado Livre notification parser accepts orders_v2 envelopes for durable order ingress', () => {
  const parsed = parseMercadoLivreNotification({
    _id: 'notification-order-1',
    resource: '/orders/2000012345678901',
    user_id: 123456789,
    topic: 'orders_v2',
    application_id: 987654321,
    attempts: 1,
    sent: '2026-09-15T17:00:00.000Z',
  });
  assert.equal(parsed.resource, '/orders/2000012345678901');
  assert.equal(parsed.topic, 'orders_v2');
});

test('Mercado Livre notification parser fails closed on invalid resource paths', () => {
  assert.throws(
    () => parseMercadoLivreNotification({
      _id: 'notification-2',
      resource: 'https://attacker.example/items/MLB123',
      user_id: 123456789,
      topic: 'items',
      application_id: 987654321,
      attempts: 1,
    }),
    /MERCADO_LIVRE_NOTIFICATION_RESOURCE_INVALID/
  );
});

test('notification inbox binds provider user id only to an existing connected Mercado Livre Store Connection', () => {
  const source = readFileSync('server/integrations/mercadoLivreNotificationInboxService.ts', 'utf8');
  assert.match(source, /collectionGroup\('storeConnections'\)/);
  assert.match(source, /where\('externalAccountId', '==', externalAccountId\)/);
  assert.match(source, /record\.provider === 'mercado_livre'/);
  assert.match(source, /record\.status === 'connected'/);
  assert.match(source, /MERCADO_LIVRE_NOTIFICATION_ACCOUNT_AMBIGUOUS/);
});

test('notification application id is checked against the platform credential vault in the durable consumer', () => {
  const source = readFileSync('server/integrations/mercadoLivreNotificationInboxService.ts', 'utf8');
  assert.match(source, /resolvePlatformCredentials/);
  assert.match(source, /MERCADO_LIVRE_PLATFORM_PROVIDER_ID/);
  assert.match(source, /notification\.applicationId !== configuredApplicationId/);
  assert.match(source, /ignored_application/);
});

test('notification persistence is deterministic and idempotent after queue delivery', () => {
  const source = readFileSync('server/integrations/mercadoLivreNotificationInboxService.ts', 'utf8');
  assert.match(source, /createHash\('sha256'\)/);
  assert.match(source, /integrationWebhookInbox/);
  assert.match(source, /runTransaction/);
  assert.match(source, /if \(existing\.exists\)/);
  assert.match(source, /transaction\.create/);
  assert.match(source, /authority: 'provider_notification_trigger'/);
  assert.match(source, /processingStatus: disposition === 'pending_fetch' \? 'pending' : 'ignored'/);
  assert.doesNotMatch(source, /mercadoLivreOrderIngressQueue|CRON_SECRET/);
  assert.doesNotMatch(source, /saveStoreConnectionRegistryRecord|updateStoreConnectionSyncAuthority/);
});

test('orders_v2 is recognized by the inbox but is not synchronously refetched there', () => {
  const inbox = readFileSync('server/integrations/mercadoLivreNotificationInboxService.ts', 'utf8');
  assert.match(inbox, /new Set\(\['items', 'items_prices', 'orders_v2'\]\)/);
  assert.doesNotMatch(inbox, /processMercadoLivreOrderNotificationInboxItem/);
  assert.doesNotMatch(inbox, /mercadoLivreGetJson/);
});

test('orders_v2 public ingress sends to Vercel Queue while catalog notifications fall through to manual-review router', () => {
  const ingress = readFileSync('server/integrations/mercadoLivreOrderQueueIngressRouter.ts', 'utf8');
  const transport = readFileSync('server/integrations/storeConnectionsServerlessTransport.ts', 'utf8');
  assert.match(ingress, /notification\.topic !== 'orders_v2'/);
  assert.match(ingress, /next\(\)/);
  assert.match(ingress, /enqueueMercadoLivreOrderNotification\(request\.body\)/);
  assert.match(ingress, /response\.status\(200\)/);
  assert.match(ingress, /response\.status\(503\)/);
  assert.match(transport, /createMercadoLivreOrderQueueIngressRouter\(\)/);
  assert.ok(
    transport.indexOf('createMercadoLivreOrderQueueIngressRouter()') <
      transport.indexOf('createMercadoLivreRouter()'),
    'orders_v2 queue ingress must run before the legacy Mercado Livre router'
  );
});

test('Vercel Queue publication is durable and deduplicated by Mercado Livre notification id', () => {
  const queue = readFileSync('server/integrations/mercadoLivreOrderQueueService.ts', 'utf8');
  assert.match(queue, /send\(/);
  assert.match(queue, /MERCADO_LIVRE_ORDERS_V2_QUEUE_TOPIC/);
  assert.match(queue, /idempotencyKey: queueIdempotencyKey\(notification\.notificationId\)/);
  assert.match(queue, /retentionSeconds: 86_400/);
  assert.match(queue, /ingestMercadoLivreNotification\(input\)/);
  assert.match(queue, /processMercadoLivreOrderNotificationInboxItem/);
  assert.doesNotMatch(queue, /CRON_SECRET|mercadoLivreOrderIngressQueue/);
});

test('orders_v2 retry resumes the same durable inbox after worker interruption instead of fabricating a replacement event', () => {
  const inbox = readFileSync('server/integrations/mercadoLivreNotificationInboxService.ts', 'utf8');
  const queue = readFileSync('server/integrations/mercadoLivreOrderQueueService.ts', 'utf8');
  assert.match(inbox, /if \(existing\.exists\) \{/);
  assert.match(inbox, /duplicate = true/);
  assert.match(inbox, /return \{\n    accepted: true,\n    duplicate,/);
  assert.match(queue, /const ingested = await ingestMercadoLivreNotification\(input\)/);
  assert.doesNotMatch(queue, /if \(ingested\.duplicate\)/);
  const ingestAt = queue.indexOf('const ingested = await ingestMercadoLivreNotification(input)');
  const leaseAt = queue.indexOf('lease = await acquireOrderProcessingLease', ingestAt);
  const processAt = queue.indexOf('processMercadoLivreOrderNotificationInboxItem', leaseAt);
  assert.ok(ingestAt >= 0 && leaseAt > ingestAt && processAt > leaseAt);
});

test('same-message redelivery cannot share an active order lease and expired leases are replaceable', () => {
  const queue = readFileSync('server/integrations/mercadoLivreOrderQueueService.ts', 'utf8');
  assert.match(queue, /randomUUID\(\)/);
  assert.match(queue, /holderToken/);
  assert.match(queue, /currentHolderToken/);
  assert.match(queue, /Date\.parse\(currentLeaseUntil\) > now/);
  assert.match(queue, /MERCADO_LIVRE_ORDER_PROCESSING_LEASE_BUSY/);
  assert.doesNotMatch(queue, /currentHolder !== input\.notification\.notificationId/);
});

test('active Mercado Livre order processing lease is renewed while provider and Firestore work is in flight', () => {
  const queue = readFileSync('server/integrations/mercadoLivreOrderQueueService.ts', 'utf8');
  assert.match(queue, /ORDER_PROCESSING_LEASE_MS = 120_000/);
  assert.match(queue, /ORDER_PROCESSING_HEARTBEAT_MS = 30_000/);
  assert.match(queue, /renewOrderProcessingLease/);
  assert.match(queue, /startOrderProcessingLeaseHeartbeat/);
  assert.match(queue, /setInterval/);
  assert.match(queue, /timer\.unref\?\.\(\)/);
  assert.match(queue, /MERCADO_LIVRE_ORDER_PROCESSING_LEASE_LOST/);
  assert.match(queue, /holderToken !== lease\.holderToken/);
});

test('transient consumer failures stay pending until the explicit retry budget is exhausted', () => {
  const queue = readFileSync('server/integrations/mercadoLivreOrderQueueService.ts', 'utf8');
  assert.match(queue, /MAX_RETRYABLE_FAILURES = 12/);
  assert.match(queue, /recordRetryableFailure/);
  assert.match(queue, /processingOutcome: 'retryable_infrastructure_failure'/);
  assert.match(queue, /retryableFailureCount: failureCount/);
  assert.match(queue, /retryableFailureBudget: MAX_RETRYABLE_FAILURES/);
  assert.match(queue, /firstRetryableFailureAt/);
  assert.match(queue, /lastRetryableFailureAt: FieldValue\.serverTimestamp\(\)/);
  assert.match(queue, /coordinationRetryErrors/);
  assert.match(queue, /MERCADO_LIVRE_ORDER_PROCESSING_LEASE_BUSY/);
  assert.match(queue, /MERCADO_LIVRE_ORDER_PROCESSING_LEASE_LOST/);
});

test('retry exhaustion preserves the inbox and escalates to manual review instead of throwing forever', () => {
  const queue = readFileSync('server/integrations/mercadoLivreOrderQueueService.ts', 'utf8');
  assert.match(queue, /failureCount >= MAX_RETRYABLE_FAILURES/);
  assert.match(queue, /processingStatus: 'failed'/);
  assert.match(queue, /processingOutcome: 'retry_exhausted'/);
  assert.match(queue, /processingAuthority: 'manual_review_required'/);
  assert.match(queue, /resolutionAuthority: 'manual_review_required'/);
  assert.match(queue, /manualReviewRequired: true/);
  assert.match(queue, /retryExhaustedAt: FieldValue\.serverTimestamp\(\)/);
  assert.match(queue, /exhaustedInboxDisposition/);
  assert.match(queue, /disposition: 'retry_exhausted'/);
  assert.match(queue, /outcome: 'manual_review_required'/);
  const catchStart = queue.indexOf('const retry = await recordRetryableFailure');
  const throwAt = queue.indexOf('throw error;', catchStart);
  const exhaustedReturnAt = queue.indexOf("disposition: 'retry_exhausted'", catchStart);
  assert.ok(catchStart >= 0 && exhaustedReturnAt > catchStart && throwAt > exhaustedReturnAt);
});

test('already exhausted inbox is acknowledged deterministically on redelivery without another provider refetch', () => {
  const queue = readFileSync('server/integrations/mercadoLivreOrderQueueService.ts', 'utf8');
  const ingestAt = queue.indexOf('const ingested = await ingestMercadoLivreNotification(input)');
  const exhaustedAt = queue.indexOf('const alreadyExhausted = await exhaustedInboxDisposition', ingestAt);
  const leaseAt = queue.indexOf('lease = await acquireOrderProcessingLease', exhaustedAt);
  assert.ok(ingestAt >= 0 && exhaustedAt > ingestAt && leaseAt > exhaustedAt);
  assert.match(queue, /if \(alreadyExhausted\) return alreadyExhausted/);
});

test('Mercado Livre provider reads classify timeout network 429 and 5xx as retryable infrastructure failures', () => {
  const oauth = readFileSync('server/integrations/mercadoLivreOauthService.ts', 'utf8');
  assert.match(oauth, /MERCADO_LIVRE_PROVIDER_TIMEOUT_MS = 12_000/);
  assert.match(oauth, /new AbortController\(\)/);
  assert.match(oauth, /controller\.abort\(\)/);
  assert.match(oauth, /MERCADO_LIVRE_API_TRANSIENT:\$\{operation\}_TIMEOUT/);
  assert.match(oauth, /MERCADO_LIVRE_API_TRANSIENT:\$\{operation\}_NETWORK/);
  assert.match(oauth, /status === 408 \|\| status === 425 \|\| status === 429 \|\| status >= 500/);
  assert.match(oauth, /MERCADO_LIVRE_API_TRANSIENT:GET_HTTP_\$\{response\.status\}/);
  assert.match(oauth, /MERCADO_LIVRE_API_TRANSIENT:TOKEN_HTTP_\$\{response\.status\}/);
});

test('Firestore failure between Queue delivery and durable inbox remains retryable because no acknowledgement path swallows ingest failure', () => {
  const queue = readFileSync('server/integrations/mercadoLivreOrderQueueService.ts', 'utf8');
  const ingestAt = queue.indexOf('const ingested = await ingestMercadoLivreNotification(input)');
  const returnDispositionAt = queue.indexOf('if (!ingested.accepted', ingestAt);
  const leaseAt = queue.indexOf('lease = await acquireOrderProcessingLease', ingestAt);
  assert.ok(ingestAt >= 0 && returnDispositionAt > ingestAt && leaseAt > returnDispositionAt);
  const beforeLease = queue.slice(ingestAt, leaseAt);
  assert.doesNotMatch(beforeLease, /catch \(/);
});

test('Vercel Queue consumer is a dedicated private trigger and cannot air-gap public health', () => {
  const consumer = readFileSync('api/mercado-livre-orders-v2-consumer.ts', 'utf8');
  const health = readFileSync('api/health.ts', 'utf8');
  const vercel = JSON.parse(readFileSync('vercel.json', 'utf8')) as {
    functions?: Record<string, { experimentalTriggers?: Array<Record<string, unknown>> }>;
  };
  assert.match(consumer, /new QueueClient\(\)/);
  assert.match(consumer, /handleNodeCallback/);
  assert.match(consumer, /consumeMercadoLivreOrderQueueMessage\(message\)/);
  const trigger = vercel.functions?.['api/mercado-livre-orders-v2-consumer.ts']?.experimentalTriggers?.[0];
  assert.equal(trigger?.type, 'queue/v2beta');
  assert.equal(trigger?.topic, 'mercado_livre_orders_v2');
  assert.equal(trigger?.retryAfterSeconds, 30);
  assert.equal(vercel.functions?.['api/health.ts'], undefined);
  assert.doesNotMatch(health, /QueueClient|com\.vercel\.queue\.v2beta/);
});

test('Drive media keeps its public URL through health transport so Queue consumer stays inside Hobby function budget', () => {
  const health = readFileSync('api/health.ts', 'utf8');
  const vercel = readFileSync('vercel.json', 'utf8');
  assert.match(vercel, /"source": "\/api\/media\/drive"/);
  assert.match(vercel, /"destination": "\/api\/health\?transport=drive-media"/);
  assert.match(health, /transport === 'drive-media'/);
  assert.match(health, /driveMediaProxy\.js/);
  assert.match(health, /proxyPublicGoogleDriveImage/);
});

test('catalog notification callback preserves the existing manual-review retry behavior', () => {
  const router = readFileSync('server/integrations/mercadoLivreRouter.ts', 'utf8');
  assert.match(router, /router\.post\('\/notifications'/);
  assert.match(router, /ingestMercadoLivreNotification\(request\.body\)/);
  assert.match(router, /response\.status\(200\)\.json\(\{ received: true \}\)/);
  assert.match(router, /response\.status\(503\)\.json\(\{ received: false \}\)/);
});

test('notification inbox does not enable automatic Mercado Livre catalog sync authority', () => {
  const inbox = readFileSync('server/integrations/mercadoLivreNotificationInboxService.ts', 'utf8');
  const registry = readFileSync('server/integrations/storeConnectionRegistry.ts', 'utf8');
  assert.doesNotMatch(inbox, /external_to_kyrub|kyrub_to_external|bidirectional/);
  assert.match(registry, /record\.provider === 'mercado_livre'/);
  assert.match(registry, /syncAuthority !== 'manual_review'/);
  assert.match(registry, /STORE_CONNECTION_SYNC_AUTHORITY_UNAVAILABLE/);
});
