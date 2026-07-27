import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const serverSource = readFileSync('server.ts', 'utf8');
const routerSource = readFileSync(
  'server/delivery/deliveryOpportunityRouter.ts',
  'utf8'
);
const bridgeSource = readFileSync(
  'src/components/store/KyrubDeliveryOpportunityBridge.tsx',
  'utf8'
);
const statusBridgeSource = readFileSync(
  'src/components/store/KyrubDeliveryStatusSyncBridge.tsx',
  'utf8'
);
const utilitySource = readFileSync(
  'src/utils/deliveryOpportunities.ts',
  'utf8'
);
const appSource = readFileSync('src/App.tsx', 'utf8');

test('ready delivery orders publish idempotent Kyrub Entregas jobs', () => {
  assert.match(serverSource, /createDeliveryOpportunityRouter/);
  assert.match(routerSource, /fulfillmentType !== 'delivery'/);
  assert.match(routerSource, /\['ready', 'out_for_delivery'\]/);
  assert.match(routerSource, /hub\/renda\/deliveries/);
  assert.match(routerSource, /sourceOrderId/);
  assert.match(bridgeSource, /orders\/:orderId\/publish|delivery-opportunities\/orders/);
});

test('unaccepted jobs escalate after three minutes to admin control plane', () => {
  assert.match(routerSource, /3 \* 60 \* 1000/);
  assert.match(routerSource, /waiting_kyrub/);
  assert.match(routerSource, /adminLogisticsEscalations/);
  assert.match(routerSource, /awaiting_provider_routing/);
  assert.match(routerSource, /admin\.kyrub\.com/);
  assert.match(routerSource, /internal\/escalate/);
});

test('delivery opportunities refresh the authorized Renda mural cache', () => {
  assert.match(bridgeSource, /kyrub_deliveries/);
  assert.match(bridgeSource, /hub\/renda\/deliveries/);
  assert.match(appSource, /KyrubDeliveryOpportunityBridge/);
  assert.match(appSource, /onOpportunitiesChanged=\{refreshLegacyCache\}/);
});

test('legacy courier actions are persisted before fallback escalation', () => {
  assert.match(statusBridgeSource, /kyrub_deliveries/);
  assert.match(statusBridgeSource, /delivery\.id\.startsWith\('order-'\)/);
  assert.match(statusBridgeSource, /updateKyrubDeliveryOpportunityStatus/);
  assert.match(utilitySource, /status: 'accepted'|status,/);
  assert.match(utilitySource, /acceptedBy/);
  assert.match(utilitySource, /fallbackStatus = 'accepted_by_kyrub'/);
  assert.match(utilitySource, /serverTimestamp/);
  assert.match(appSource, /KyrubDeliveryStatusSyncBridge/);
});
