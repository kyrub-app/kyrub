import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import './courier-live-tracking.test';
import './delivery-pickup-handoff.test';
import './delivery-customer-handoff.test';
import './courier-earnings-projection.test';
import './paid-waiting-funding-responsibility-surfaces.test';
import './economic-settlement-funding.test';

const serverSource = readFileSync('server.ts', 'utf8');
const routerSource = readFileSync(
  'server/delivery/deliveryOpportunityRouter.ts',
  'utf8'
);
const pickupHandoffSource = readFileSync(
  'server/delivery/deliveryPickupHandoffService.ts',
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
const rendaSource = readFileSync(
  'src/components/tabs/RendaTab.tsx',
  'utf8'
);

test('ready delivery orders publish idempotent Kyrub Entregas jobs', () => {
  assert.match(serverSource, /createDeliveryOpportunityRouter/);
  assert.match(routerSource, /fulfillmentType !== 'delivery'/);
  assert.match(routerSource, /\['preparing', 'ready', 'out_for_delivery'\]/);
  assert.match(routerSource, /hub\/renda\/deliveries/);
  assert.match(routerSource, /deliveryEscalationQueue/);
  assert.match(routerSource, /sourceOrderId/);
  assert.match(bridgeSource, /orders\/:orderId\/publish|delivery-opportunities\/orders/);
});

test('secure courier pickup, not generic delivering, owns route-start readiness', () => {
  assert.match(pickupHandoffSource, /liveOrderStatus !== 'ready'/);
  assert.match(pickupHandoffSource, /courier_inside_store_geofence/);
  assert.match(routerSource, /Confirme a coleta segura antes de iniciar a rota/);
});

test('unaccepted jobs escalate after three minutes to admin control plane', () => {
  assert.match(routerSource, /3 \* 60 \* 1000/);
  assert.match(routerSource, /deliveryEscalationQueue/);
  assert.match(routerSource, /deliveryClaims/);
  assert.match(routerSource, /adminLogisticsEscalations/);
  assert.match(routerSource, /awaiting_provider_routing/);
  assert.match(routerSource, /admin\.kyrub\.com/);
  assert.match(routerSource, /internal\/escalate/);
});

test('delivery opportunities refresh the authorized Renda mural cache', () => {
  assert.match(bridgeSource, /kyrub_deliveries/);
  assert.match(bridgeSource, /hub\/renda\/deliveries/);
  assert.match(bridgeSource, /acceptedByName/);
  assert.match(appSource, /KyrubDeliveryOpportunityBridge/);
  assert.match(appSource, /onOpportunitiesChanged=\{refreshLegacyCache\}/);
});

test('Renda keeps delivery earnings behind the Kyrub Entregas shortcut', () => {
  assert.match(rendaSource, /id="btn-delivery-earnings"/);
  assert.match(rendaSource, /aria-label="Ver ganhos em entregas"/);
  assert.match(rendaSource, /isDeliveryEarningsOpen && createPortal/);
  assert.match(rendaSource, /id="delivery-earnings-sheet"/);
  assert.match(rendaSource, /aria-modal="true"/);
  assert.match(rendaSource, /<CourierEarningsProjectionCard \/>/);
  assert.doesNotMatch(
    rendaSource,
    /<CourierEarningsProjectionCard \/>\s*\n\s*<div className="grid gap-4 sm:grid-cols-2">/
  );
});

test('courier actions use a server-authoritative atomic claim', () => {
  assert.match(statusBridgeSource, /kyrub_deliveries/);
  assert.match(statusBridgeSource, /delivery\.id\.startsWith\('order-'\)/);
  assert.match(statusBridgeSource, /belongsToAuthenticatedCourier/);
  assert.match(statusBridgeSource, /identities\.has\(acceptedBy\)/);
  assert.match(statusBridgeSource, /updateKyrubDeliveryOpportunityStatus/);
  assert.match(utilitySource, /delivery-opportunities\/\$\{encodeURIComponent/);
  assert.match(utilitySource, /authorization: `Bearer/);
  assert.match(routerSource, /runTransaction/);
  assert.match(routerSource, /transaction\.create\(claimReference/);
  assert.match(routerSource, /courierId === actor\.uid/);
  assert.match(routerSource, /fallbackStatus: 'accepted_by_kyrub'/);
  assert.match(routerSource, /scheduleSnapshot\.exists/);
  assert.match(appSource, /KyrubDeliveryStatusSyncBridge/);
});
