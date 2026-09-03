import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const portal = readFileSync(
  'src/components/store/StoreConnectionsPortalBridge.tsx',
  'utf8'
);
const actionService = readFileSync(
  'src/actions/kyrubActionService.ts',
  'utf8'
);
const activityBrowser = readFileSync(
  'src/observability/kyrubActivityBrowser.ts',
  'utf8'
);

test('inventory post-confirmation refresh is driven only by an authoritative successful receipt event', () => {
  assert.match(portal, /KYRUB_ACTIVITY_UPDATED_EVENT/);
  assert.match(portal, /readRecentKyrubActivityEvents/);
  assert.match(portal, /receiptEvent\?\.type !== 'result\.action_succeeded'/);
  assert.match(portal, /receiptEvent\.actionId !== 'adjust_inventory'/);
  assert.match(portal, /receiptEvent\.source !== 'authoritative_write_ack'/);
  assert.match(portal, /receiptEvent\.authority !== 'confirmed_result'/);

  assert.match(actionService, /source: 'authoritative_write_ack'/);
  assert.match(actionService, /proposal\.type === 'adjust_inventory'/);
  assert.match(actionService, /invalidateKyrubErpContext\(user\.uid\)/);
  assert.match(activityBrowser, /window\.dispatchEvent/);
});

test('inventory receipt refresh waits until the synchronous action path can invalidate ERP cache', () => {
  assert.match(portal, /window\.setTimeout\(\(\) => \{/);
  assert.match(portal, /setInventoryRefreshVersion\(version => version \+ 1\)/);
});

test('post-adjustment refresh remounts only physical inventory and operational queue', () => {
  assert.match(
    portal,
    /<StoreChannelOperationsQueue\s+key=\{`channel-operations-\$\{inventoryRefreshVersion\}`\}/
  );
  assert.match(
    portal,
    /<PhysicalInventoryWorkspace\s+key=\{`physical-inventory-\$\{inventoryRefreshVersion\}`\}/
  );

  assert.doesNotMatch(portal, /<StoreChannelCenter[^>]*key=/);
  assert.doesNotMatch(portal, /<StoreConnectionsWorkspace[^>]*key=/);
  assert.doesNotMatch(portal, /<MercadoLivreE2ETestBridge[^>]*key=/);
  assert.doesNotMatch(portal, /<NinetyNineFoodE2ETestBridge[^>]*key=/);
});

test('post-adjustment refresh does not retry reservation or write to providers', () => {
  assert.doesNotMatch(
    portal,
    /retryNinetyNineFoodBlockedOrderReservation|retry-reservation|sendNinetyNineFoodOrderStatus|fetch\(/
  );
  assert.doesNotMatch(
    portal,
    /mercado.*write|quantityAvailable|item-offers|orders\/.*status/i
  );
});

test('tenant scope is checked before accepting an activity receipt for refresh', () => {
  assert.match(portal, /detail\?\.actorUid\?\.trim\(\) !== user\.uid/);
  assert.match(portal, /user\.uid !== storeId/);
  assert.match(portal, /candidate\.id === eventId/);
});
