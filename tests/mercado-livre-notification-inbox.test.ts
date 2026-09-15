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
  assert.doesNotMatch(queue, /CRON_SECRET|setInterval|mercadoLivreOrderIngressQueue/);
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
