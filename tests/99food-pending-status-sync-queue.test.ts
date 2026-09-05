import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import './99food-status-sync-execution-claim.test.ts';

const routerSource = readFileSync(
  'server/inventory/orderInventoryRouter.ts',
  'utf8'
);
const legacyIntegrationRouterSource = readFileSync(
  'server/integrations/ninetyNineFoodRouter.ts',
  'utf8'
);
const clientSource = readFileSync(
  'src/utils/ninetyNineFoodPendingStatusSync.ts',
  'utf8'
);
const bridgeSource = readFileSync(
  'src/components/store/NinetyNineFoodOrderStatusBridge.tsx',
  'utf8'
);

test('pending 99Food status queue is projected from the order integration evidence', () => {
  const routeStart = routerSource.indexOf("router.get('/provider-sync/99food/pending'");
  assert.ok(routeStart >= 0);
  assert.match(routerSource, /integration\.outboundStatus/);
  assert.match(routerSource, /'authorization_required'/);
  assert.match(routerSource, /'attention'/);
  assert.match(routerSource, /provider !== '99food'/);
  assert.match(routerSource, /integration\.externalOrderId/);
  assert.doesNotMatch(
    routerSource.slice(routeStart, routerSource.indexOf("router.post('/:orderId/provider-sync/99food'", routeStart)),
    /sendNinetyNineFoodOrderStatus\(|transitionOrderStatusWithInventory\(/
  );
});

test('manual pending sync validates exact authority and current local status before provider write', () => {
  const routeStart = routerSource.indexOf("router.post('/:orderId/provider-sync/99food'");
  const routeEnd = routerSource.indexOf("router.post('/:orderId/reconcile-inventory'", routeStart);
  const section = routerSource.slice(routeStart, routeEnd);
  const parseIndex = section.indexOf('parseProviderWriteAuthorization(');
  const snapshotIndex = section.indexOf('orderReference(tenantId, orderId).get()');
  const pendingIndex = section.indexOf('PENDING_PARTNER_SYNC_STATUSES.has(outboundStatus)');
  const staleIndex = section.indexOf('currentStatus !== providerWriteAuthorization.status');
  const sendIndex = section.indexOf('sendNinetyNineFoodOrderStatus(');

  assert.ok(routeStart >= 0);
  assert.ok(parseIndex >= 0);
  assert.ok(snapshotIndex > parseIndex);
  assert.ok(pendingIndex > snapshotIndex);
  assert.ok(staleIndex > pendingIndex);
  assert.ok(sendIndex > staleIndex);
  assert.match(section, /currentProvider !== '99food'/);
  assert.match(section, /expectedStatus !== providerWriteAuthorization\.status/);
  assert.match(section, /externalOrderId/);
});

test('manual pending sync never replays the local status transition', () => {
  const routeStart = routerSource.indexOf("router.post('/:orderId/provider-sync/99food'");
  const routeEnd = routerSource.indexOf("router.post('/:orderId/reconcile-inventory'", routeStart);
  const section = routerSource.slice(routeStart, routeEnd);

  assert.doesNotMatch(section, /transitionOrderStatusWithInventory\(/);
  assert.doesNotMatch(section, /persistDeliveryProvider\(/);
  assert.match(section, /localTransitionApplied: false/);
  assert.match(section, /response\.status\(202\)\.json/);
  assert.match(section, /partnerSync: 'attention'/);
  assert.match(section, /partnerSync: 'sent'/);
});

test('legacy direct provider route is retained only as an authenticated disabled boundary', () => {
  const routeStart = legacyIntegrationRouterSource.indexOf(
    "router.post('/orders/:externalOrderId/status'"
  );
  const routeEnd = legacyIntegrationRouterSource.indexOf(
    'const webhookHandler',
    routeStart
  );
  const section = legacyIntegrationRouterSource.slice(routeStart, routeEnd);

  assert.ok(routeStart >= 0);
  assert.match(section, /authenticatedTenantId\(request\)/);
  assert.match(section, /response\.status\(410\)\.json/);
  assert.match(section, /NINETY_NINE_FOOD_DIRECT_STATUS_WRITE_DISABLED/);
  assert.doesNotMatch(section, /sendNinetyNineFoodOrderStatus\(/);
});

test('pending client sends structured status-scoped authorization only after an explicit UI action', () => {
  assert.match(clientSource, /providerWriteAuthorization/);
  assert.match(clientSource, /provider: '99food'/);
  assert.match(clientSource, /status: item\.status/);
  assert.match(clientSource, /confirmed: true/);
  assert.match(clientSource, /localTransitionApplied !== false/);

  assert.match(bridgeSource, /Sincronizações de status pendentes/);
  assert.match(bridgeSource, /Revisar e enviar/);
  assert.match(bridgeSource, /Confirmar envio/);
  assert.match(bridgeSource, /confirmSyncOrderId !== item\.orderId/);
  assert.match(bridgeSource, /sendNinetyNineFoodPendingStatusSync\(user, item\)/);
});

test('failed manual provider writes stay manual and do not roll back Kyrub', () => {
  assert.match(routerSource, /markPartnerSyncError\(/);
  assert.match(routerSource, /'integration\.outboundStatus': 'attention'/);
  assert.match(bridgeSource, /status local não foi revertido/i);
  assert.match(bridgeSource, /não agenda retry automático/i);
  assert.doesNotMatch(
    bridgeSource,
    /setInterval|retryNinetyNineFoodBlockedOrderReservation|sendNinetyNineFoodOrderStatus/
  );
});
