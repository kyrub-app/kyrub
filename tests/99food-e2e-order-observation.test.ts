import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const serviceSource = readFileSync(
  'server/integrations/ninetyNineFoodE2EOrderObservationService.ts',
  'utf8'
);
const routerSource = readFileSync(
  'server/integrations/ninetyNineFoodRouter.ts',
  'utf8'
);
const clientSource = readFileSync(
  'src/utils/ninetyNineFoodE2EOrderObservation.ts',
  'utf8'
);
const panelSource = readFileSync(
  'src/components/store/NinetyNineFoodE2EOrderObservationPanel.tsx',
  'utf8'
);
const bridgeSource = readFileSync(
  'src/components/store/NinetyNineFoodE2ETestBridge.tsx',
  'utf8'
);
const evidenceSource = readFileSync(
  'src/utils/omnichannelE2EEvidence.ts',
  'utf8'
);

test('server observation projects only canonical 99Food orders and correlates existing ingress event evidence', () => {
  assert.match(serviceSource, /stores\/\$\{canonicalStoreId\}\/orders/);
  assert.match(serviceSource, /tenants\/\$\{tenantId\}\/integrationEvents/);
  assert.match(serviceSource, /clean\(integration\.provider, 120\) !== '99food'/);
  assert.match(serviceSource, /clean\(integration\.externalOrderId, 240\)/);
  assert.match(serviceSource, /clean\(event\.provider, 120\) !== '99food'/);
  assert.match(serviceSource, /eventByExternalOrderId/);
  assert.match(serviceSource, /candidateProcessed && !currentProcessed/);
  assert.match(serviceSource, /inboundEvent: ingress/);
});

test('recent-order observation bounds Firestore reads around recent ingress evidence instead of scanning whole collections', () => {
  assert.match(serviceSource, /\.orderBy\('receivedAt', 'desc'\)/);
  assert.match(serviceSource, /\.limit\(eventReadLimit\)/);
  assert.match(serviceSource, /Math\.max\(50, Math\.min\(500, limit \* 20\)\)/);
  assert.match(serviceSource, /chunks\(externalOrderIds, 10\)/);
  assert.match(serviceSource, /\.where\('integration\.externalOrderId', 'in', ids\)/);
  assert.match(serviceSource, /\.slice\(0, Math\.max\(limit \* 3, limit\)\)/);
  assert.doesNotMatch(
    serviceSource,
    /const \[ordersSnapshot, eventsSnapshot\] = await Promise\.all/
  );
});

test('observation exposes reservation state already written on the order without recalculating ATP', () => {
  assert.match(serviceSource, /'reserved'/);
  assert.match(serviceSource, /'waiting_physical_consumption'/);
  assert.match(serviceSource, /'blocked_product_binding_unresolved'/);
  assert.match(serviceSource, /'blocked_insufficient_atp'/);
  assert.match(serviceSource, /'blocked_authority_unresolved'/);
  assert.match(serviceSource, /reservationState\(reservation\)/);
  assert.match(serviceSource, /reconciledAt/);
  assert.doesNotMatch(
    serviceSource,
    /reconcileNinetyNineFoodOrderReservation|reserveCanonicalOrderInventory|inspectCanonicalOrderInventoryAvailability|transitionCanonicalInventoryReservation/
  );
});

test('server observation service is owner-scoped, bounded and strictly read-only', () => {
  assert.match(serviceSource, /requestedByUserId !== tenantId/);
  assert.match(serviceSource, /NINETY_NINE_FOOD_E2E_ORDER_OBSERVATION_FORBIDDEN/);
  assert.match(serviceSource, /Math\.max\(1, Math\.min\(50, requestedLimit\)\)/);
  assert.doesNotMatch(
    serviceSource,
    /\.set\(|\.update\(|\.create\(|\.delete\(|runTransaction|\.batch\(|sendAction|writeNinetyNineFood|retry|reconcile/i
  );
});

test('99Food router exposes observation as authenticated GET only', () => {
  const routeIndex = routerSource.indexOf("router.get('/e2e/recent-orders'");
  const bindingsIndex = routerSource.indexOf("router.get('/product-bindings'", routeIndex);
  const section = routerSource.slice(routeIndex, bindingsIndex);
  assert.ok(routeIndex >= 0);
  assert.ok(bindingsIndex > routeIndex);
  assert.match(section, /authenticatedTenantId\(request\)/);
  assert.match(section, /listRecentNinetyNineFoodE2EObservedOrders/);
  assert.match(section, /requestedByUserId: tenantId/);
  assert.doesNotMatch(section, /router\.post|router\.put|router\.delete|sendAction|retry|reconcile/);
});

test('client validates canonical observation before recording canonical-readback evidence', () => {
  const fetchIndex = clientSource.indexOf('const response = await fetch(');
  const validationIndex = clientSource.indexOf("throw new Error('A leitura autoritativa dos pedidos 99Food está incompleta.')", fetchIndex);
  const parseIndex = clientSource.indexOf('const items = payload.items', validationIndex);
  const evidenceIndex = clientSource.indexOf('recordOmnichannelE2EEvidence({', parseIndex);
  assert.ok(fetchIndex >= 0);
  assert.ok(validationIndex > fetchIndex);
  assert.ok(parseIndex > validationIndex);
  assert.ok(evidenceIndex > parseIndex);
  assert.match(clientSource, /method: 'GET'/);
  assert.match(clientSource, /kind: '99food_order_observation'/);
  assert.match(clientSource, /source: 'canonical_readback'/);
  assert.match(clientSource, /inboundEvent\.status === 'processed'/);
  assert.match(clientSource, /reservationState: item\.reservation\.state/);
});

test('canonical readback is a distinct evidence source and cannot become provider authority', () => {
  assert.match(evidenceSource, /'99food_order_observation'/);
  assert.match(evidenceSource, /'canonical_readback'/);
  assert.doesNotMatch(
    evidenceSource,
    /providerWriteAuthorization|authorizationToken|sendAction|retryNinetyNineFood|reconcileNinetyNineFood/
  );
});

test('observation panel only re-reads persisted evidence and never polls, retries or mutates the order', () => {
  assert.match(panelSource, /loadNinetyNineFoodE2EObservedOrders\(user, 20\)/);
  assert.match(panelSource, /id="kyrub-observe-real-99food-orders"/);
  assert.match(panelSource, /Não cria pedido, não executa polling, não refaz reserva ATP, não muda status e não envia ação à 99Food/);
  assert.match(panelSource, /ingress \{item\.inboundEvent\.status\}/);
  assert.match(panelSource, /reservationLabel\(item\)/);
  assert.doesNotMatch(
    panelSource,
    /pollNinetyNineFood|retryNinetyNineFood|updateOrderStatus|sendNinetyNineFood|authorize|execute|reconcile|setInterval|setTimeout|\bfetch\(/
  );
});

test('existing connected 99Food E2E bridge mounts observation without replacing the catalog bench', () => {
  const workspaceIndex = bridgeSource.indexOf('<NinetyNineFoodE2ETestWorkspace');
  const observationIndex = bridgeSource.indexOf('<NinetyNineFoodE2EOrderObservationPanel');
  assert.match(bridgeSource, /getNinetyNineFoodConnectionStatus/);
  assert.match(bridgeSource, /auth\.currentUser/);
  assert.ok(workspaceIndex >= 0);
  assert.ok(observationIndex > workspaceIndex);
});
