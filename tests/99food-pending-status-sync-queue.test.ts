import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import './99food-status-sync-execution-claim.test.ts';

const routerSource = readFileSync(
  'server/inventory/ninetyNineFoodStatusSyncExecutionRouter.ts',
  'utf8'
);
const executionServiceSource = readFileSync(
  'server/inventory/ninetyNineFoodStatusSyncExecutionService.ts',
  'utf8'
);
const authorizationServiceSource = readFileSync(
  'server/inventory/ninetyNineFoodStatusWriteAuthorizationService.ts',
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
    routerSource.slice(routeStart, routerSource.indexOf("router.get('/provider-sync/99food/reconciliation'", routeStart)),
    /writeNinetyNineFoodOrderStatusToProvider\(|transitionOrderStatusWithInventory\(/
  );
});

test('manual pending sync requires a server-issued exact authority before atomic execution claim', () => {
  const authorizeStart = routerSource.indexOf("router.post('/:orderId/provider-sync/99food/authorize'");
  const executeStart = routerSource.indexOf("router.post('/:orderId/provider-sync/99food'", authorizeStart + 1);
  const claimIndex = routerSource.indexOf('claimNinetyNineFoodStatusSyncExecution({', executeStart);
  const writeIndex = routerSource.indexOf('writeNinetyNineFoodOrderStatusToProvider({', claimIndex);

  assert.ok(authorizeStart >= 0);
  assert.ok(executeStart > authorizeStart);
  assert.ok(claimIndex > executeStart);
  assert.ok(writeIndex > claimIndex);
  assert.match(routerSource, /issueNinetyNineFoodStatusWriteAuthorization/);
  assert.match(routerSource, /authorizationId: authorization\.authorizationId/);
  assert.match(routerSource, /authorizationToken: authorization\.authorizationToken/);
  assert.match(executionServiceSource, /transaction\.get\(authorizationRef\)/);
  assert.match(executionServiceSource, /actualRevision !== expectedOrderRevision/);
  assert.match(executionServiceSource, /currentStatus !== input\.status/);
  assert.match(executionServiceSource, /expectedStatus !== input\.status/);
  assert.match(executionServiceSource, /consumptionStatus: 'consumed'/);
  assert.match(authorizationServiceSource, /authoritySource: 'explicit_user_authorization'/);
});

test('manual pending sync never replays the local status transition', () => {
  const routeStart = routerSource.indexOf("router.post('/:orderId/provider-sync/99food'", routerSource.indexOf('/authorize') + 1);
  const routeEnd = routerSource.indexOf("router.post('/:orderId/status'", routeStart);
  const section = routerSource.slice(routeStart, routeEnd);

  assert.doesNotMatch(section, /transitionOrderStatusWithInventory\(/);
  assert.doesNotMatch(section, /persistDeliveryProvider\(/);
  assert.match(section, /localTransitionApplied: false/);
  assert.match(section, /partnerSync: 'reconciliation_required'/);
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

test('pending client obtains server authority only after the explicit UI action and then consumes it once', () => {
  const authorizeIndex = clientSource.indexOf('issueServerAuthorization(user, item)');
  const executeIndex = clientSource.indexOf('/provider-sync/99food`', authorizeIndex);
  assert.ok(authorizeIndex >= 0);
  assert.ok(executeIndex > authorizeIndex);
  assert.match(clientSource, /provider-sync\/99food\/authorize/);
  assert.match(clientSource, /authorizationId/);
  assert.match(clientSource, /authorizationToken/);
  assert.match(clientSource, /provider: '99food'/);
  assert.match(clientSource, /status: item\.status/);
  assert.doesNotMatch(clientSource, /confirmed:\s*true/);

  assert.match(bridgeSource, /Sincronizações de status pendentes/);
  assert.match(bridgeSource, /Revisar e enviar/);
  assert.match(bridgeSource, /Confirmar envio/);
  assert.match(bridgeSource, /confirmSyncOrderId !== item\.orderId/);
  assert.match(bridgeSource, /sendNinetyNineFoodPendingStatusSync\(user, item\)/);
});

test('successful manual provider write requires readback and unresolved results never schedule automatic retry', () => {
  const writeIndex = routerSource.indexOf('writeNinetyNineFoodOrderStatusToProvider({');
  const readbackIndex = routerSource.indexOf('inspectNinetyNineFoodProviderStatusForReconciliation({', writeIndex);
  const unresolvedIndex = routerSource.indexOf("observation.outcome !== 'confirmed'", readbackIndex);
  const markerIndex = routerSource.indexOf('markNinetyNineFoodProviderWriteOutcomeUnknown({', unresolvedIndex);
  assert.ok(writeIndex >= 0);
  assert.ok(readbackIndex > writeIndex);
  assert.ok(unresolvedIndex > readbackIndex);
  assert.ok(markerIndex > unresolvedIndex);
  assert.match(routerSource, /partnerSync: 'reconciliation_required'/);
  assert.match(bridgeSource, /status local não foi revertido/i);
  assert.match(bridgeSource, /não agenda retry automático/i);
  assert.doesNotMatch(
    bridgeSource,
    /setInterval|retryNinetyNineFoodBlockedOrderReservation|sendNinetyNineFoodOrderStatus/
  );
});
