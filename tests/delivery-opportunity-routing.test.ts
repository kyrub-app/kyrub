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
  const modal=readFileSync('src/components/modals/DeliveryManagerModal.tsx','utf8');
  const transport=readFileSync('server/delivery/deliveryAcceptanceTransport.ts','utf8');
  assert.doesNotMatch(statusBridgeSource,/localStorage|updateKyrubDeliveryOpportunityStatus|setInterval/);
  assert.match(bridgeSource,/acceptedBy:\s*clean\(data.acceptedBy\)/);
  assert.match(modal,/await confirmKyrubDeliveryAcceptance\(jobId,user\)/);
  assert.match(modal,/auth.currentUser\?\.uid!==user.uid/);
  assert.match(modal,/accepting.current=true/);
  assert.match(modal,/d.acceptedBy===auth.currentUser.uid/);
  assert.ok(modal.indexOf('await confirmKyrubDeliveryAcceptance')<modal.indexOf("status:'accepted',acceptedBy:user.uid"));
  assert.match(transport,/KYRUB_DELIVERY_ACCEPTANCE_ENABLED!=='true'/);
  assert.match(transport,/VERCEL_ENV!=='production'/);
  assert.match(transport,/verifyIdToken\(token,true\)/);
  assert.match(transport,/requireApprovedWorkProfile\(actor.uid,'courier'\)/);
  assert.match(transport,/requireCanonicalAcceptance:true/);
  assert.match(routerSource,/transaction.get\(adminDb.doc\('identity_verifications\/'\+actor.uid\)\)/);
  assert.match(routerSource,/deliveryJobId\(clean\(delivery.storeId\),clean\(delivery.sourceOrderId\)\) !== normalizedId/);
  assert.match(routerSource,/DELIVERY_ACCEPTANCE_CONFLICT/);
  assert.match(utilitySource,/receipt.courierId!==user.uid/);
  assert.match(utilitySource,/receipt.deliveryId!==deliveryId/);
  const rewrites=JSON.parse(readFileSync('vercel.json','utf8')).rewrites;
  assert.ok(rewrites.some((r:{source:string;destination:string})=>r.source==='/api/delivery-opportunities/:deliveryId/accept'&&r.destination==='/api/health?transport=kyrub-delivery-acceptance&deliveryId=:deliveryId'));
  assert.ok(!rewrites.some((r:{source:string})=>r.source==='/api/delivery-opportunities/:path*'));
  assert.match(readFileSync('api/health.ts','utf8'),/transport === 'kyrub-delivery-acceptance'/);
  assert.match(utilitySource, /delivery-opportunities\/\$\{encodeURIComponent/);
  assert.match(utilitySource, /authorization: `Bearer/);
  assert.match(routerSource, /runTransaction/);
  assert.match(routerSource, /transaction\.create\(claimReference/);
  assert.match(routerSource, /courierId === actor\.uid/);
  assert.match(routerSource, /fallbackStatus: 'accepted_by_kyrub'/);
  assert.match(routerSource, /scheduleSnapshot\.exists/);
  assert.match(appSource, /KyrubDeliveryStatusSyncBridge/);
});
