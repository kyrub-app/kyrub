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

test('courier acceptance is server-authoritative and checks approved documents before changing UI', () => {
  const modal = readFileSync('src/components/modals/DeliveryManagerModal.tsx','utf8');
  const eligibility = readFileSync('server/identity/workEligibilityMiddleware.ts','utf8');
  assert.match(serverSource,/enforceDeliveryWorkEligibility,\s*createDeliveryOpportunityRouter\(\)/);
  assert.match(eligibility,/requireApprovedWorkProfile\(actor.uid, profile\)/);
  assert.match(eligibility,/profile === 'courier'/);
  assert.match(eligibility,/approvedProfiles/);
  assert.match(modal,/operational.source === 'kyrub-order'/);
  assert.match(modal,/await updateKyrubDeliveryOpportunityStatus\(jobId, 'accepted', currentUser\)/);
  const acceptStart=modal.indexOf('const handleAcceptDelivery = async');
  const acceptEnd=modal.indexOf('const isMine =',acceptStart);
  const body=modal.slice(acceptStart,acceptEnd);
  assert.ok(body.indexOf("await updateKyrubDeliveryOpportunityStatus(jobId, 'accepted', currentUser)")<
            body.indexOf("status: 'accepted', acceptedBy: currentUser.uid"));
  assert.match(modal,/disabled=\{Boolean\(acceptingKyrubDeliveryId\)\}/);
  assert.match(modal,/onClick=\{\(\) => void handleAcceptDelivery\(job.id\)\}/);
  assert.match(modal,/setFazerEntregasModalTab\('trajeto'\)/);
  assert.match(modal,/isMine\(d\)/);
  assert.match(modal,/openGoogleMapsDirections\(\{ destination: job.from, travelMode: 'driving' \}\)/);
});

test('Vercel dispatches authenticated courier publish and acceptance through existing serverless handler', async () => {
  const {parseDeliveryWorkRoute}=await import('../server/delivery/deliveryServerlessPolicy.js');
  assert.deepEqual(parseDeliveryWorkRoute('POST','orders/order-test/publish'),{kind:'publish',id:'order-test'});
  assert.deepEqual(parseDeliveryWorkRoute('POST','order-abc123/status'),{kind:'status',id:'order-abc123'});
  assert.deepEqual(parseDeliveryWorkRoute('POST','order-abc123/secure-pickup'),{kind:'secure-pickup',id:'order-abc123'});
  assert.deepEqual(parseDeliveryWorkRoute('POST','order-abc123/customer-arrival'),{kind:'customer-arrival',id:'order-abc123'});
  assert.deepEqual(parseDeliveryWorkRoute('POST','order-abc123/buyer-confirmation'),{kind:'buyer-confirmation',id:'order-abc123'});
  assert.deepEqual(parseDeliveryWorkRoute('GET','order-abc123/pickup-code'),{kind:'pickup-code',id:'order-abc123'});
  assert.deepEqual(parseDeliveryWorkRoute('GET','earnings'),{kind:'earnings'});
  for(const [method,path] of [['GET','order-abc123/status'],['POST','earnings'],['POST','orders/id/../../publish'],['POST','order-abc123/pickup-code'],['POST','order-abc123/status/other']]){
    assert.equal(parseDeliveryWorkRoute(method,path),null);
  }
  const vercel=JSON.parse(readFileSync('vercel.json','utf8'));
  const pub=vercel.rewrites.findIndex((x:{source:string})=>x.source==='/api/delivery-opportunities/public');
  const auth=vercel.rewrites.findIndex((x:{source:string})=>x.source==='/api/delivery-opportunities/:path*');
  assert.ok(pub>=0&&auth>pub);
  assert.equal(vercel.rewrites[auth].destination,'/api/health?transport=kyrub-delivery-work&path=:path*');
  const health=readFileSync('api/health.ts','utf8');
  assert.match(health,/transport === 'kyrub-delivery-work'/);
  assert.match(health,/handleDeliveryWorkServerless\(request, response, queryValue\(request\.query\?\.path\)\)/);
  const source=readFileSync('server/delivery/deliveryServerlessTransport.ts','utf8');
  assert.match(source,/adminAuth\.verifyIdToken\(token,true\)/);
  assert.match(source,/requireApprovedWorkProfile\(uid,'requester'\)/);
  assert.match(source,/requireApprovedWorkProfile\(uid,'courier'\)/);
  assert.match(source,/await updateKyrubDeliveryStatus\(action\.id,status/);
  assert.match(source,/publishKyrubDeliveryOpportunity\(uid,action\.id\)/);
  assert.match(source,/IDENTITY_VERIFICATION_REQUIRED/);
  assert.doesNotMatch(source,/platformMercadoPagoRequest|resolveMercadoPagoAccessToken|createStoreScopedMercadoPagoMarketplacePix/);
});
