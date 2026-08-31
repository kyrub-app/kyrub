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

test('notification application id is checked against the platform credential vault', () => {
  const source = readFileSync('server/integrations/mercadoLivreNotificationInboxService.ts', 'utf8');
  assert.match(source, /resolvePlatformCredentials/);
  assert.match(source, /MERCADO_LIVRE_PLATFORM_PROVIDER_ID/);
  assert.match(source, /notification\.applicationId !== configuredApplicationId/);
  assert.match(source, /ignored_application/);
});

test('notification persistence is deterministic, idempotent and only creates processing triggers', () => {
  const source = readFileSync('server/integrations/mercadoLivreNotificationInboxService.ts', 'utf8');
  assert.match(source, /createHash\('sha256'\)/);
  assert.match(source, /integrationWebhookInbox/);
  assert.match(source, /runTransaction/);
  assert.match(source, /if \(existing\.exists\)/);
  assert.match(source, /transaction\.create/);
  assert.match(source, /authority: 'provider_notification_trigger'/);
  assert.match(source, /processingStatus: disposition === 'pending_fetch' \? 'pending' : 'ignored'/);
  assert.doesNotMatch(source, /saveStoreConnectionRegistryRecord|updateStoreConnectionSyncAuthority/);
});

test('notification callback acknowledges durable triggers quickly and retries only transient inbox failures', () => {
  const router = readFileSync('server/integrations/mercadoLivreRouter.ts', 'utf8');
  assert.match(router, /router\.post\('\/notifications'/);
  assert.match(router, /ingestMercadoLivreNotification\(request\.body\)/);
  assert.match(router, /response\.status\(200\)\.json\(\{ received: true \}\)/);
  assert.match(router, /response\.status\(503\)\.json\(\{ received: false \}\)/);
});

test('notification inbox does not enable automatic Mercado Livre sync authority yet', () => {
  const inbox = readFileSync('server/integrations/mercadoLivreNotificationInboxService.ts', 'utf8');
  const registry = readFileSync('server/integrations/storeConnectionRegistry.ts', 'utf8');
  assert.doesNotMatch(inbox, /external_to_kyrub|kyrub_to_external|bidirectional/);
  assert.match(registry, /record\.provider === 'mercado_livre'/);
  assert.match(registry, /syncAuthority !== 'manual_review'/);
  assert.match(registry, /STORE_CONNECTION_SYNC_AUTHORITY_UNAVAILABLE/);
});
