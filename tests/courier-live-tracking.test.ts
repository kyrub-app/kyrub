import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const serverSource = readFileSync('server.ts', 'utf8');
const eligibilitySource = readFileSync(
  'server/identity/workEligibilityMiddleware.ts',
  'utf8'
);
const trackingRouterSource = readFileSync(
  'server/delivery/deliveryTrackingRouter.ts',
  'utf8'
);
const opportunitySource = readFileSync(
  'server/delivery/deliveryOpportunityRouter.ts',
  'utf8'
);
const trackingBridgeSource = readFileSync(
  'src/components/store/CourierLiveTrackingBridge.tsx',
  'utf8'
);
const viewerSource = readFileSync(
  'src/components/store/AuthorizedDeliveryTrackingViewer.tsx',
  'utf8'
);
const buyerViewerSource = readFileSync(
  'src/components/store/BuyerDeliveryTrackingBridge.tsx',
  'utf8'
);
const merchantViewerSource = readFileSync(
  'src/components/store/StoreDeliveryTrackingBridge.tsx',
  'utf8'
);
const storefrontSource = readFileSync(
  'src/components/PublicStorefrontApp.tsx',
  'utf8'
);
const retailerSource = readFileSync('src/components/RetailerPanel.tsx', 'utf8');
const mapSource = readFileSync(
  'src/components/store/CourierGoogleMap.tsx',
  'utf8'
);
const appSource = readFileSync('src/App.tsx', 'utf8');

test('courier tracking router is mounted and tracking writes require approved courier identity', () => {
  assert.match(serverSource, /\/api\/delivery-tracking/);
  assert.match(serverSource, /enforceDeliveryWorkEligibility,[\s\S]*createDeliveryTrackingRouter/);
  assert.match(eligibilitySource, /\(\?:location\|stop\)/);
  assert.match(eligibilitySource, /return 'courier'/);
});

test('precise courier position is written to a private tracking collection', () => {
  assert.match(trackingRouterSource, /deliveryTracking/);
  assert.match(trackingRouterSource, /claim\.courierId/);
  assert.match(trackingRouterSource, /Este entregador não é o responsável/);
  assert.match(trackingRouterSource, /\['accepted', 'delivering'\]/);
  assert.doesNotMatch(trackingRouterSource, /hub\/renda\/deliveries.*latitude/);
});

test('buyer, merchant and assigned courier can read active tracking while strangers are forbidden', () => {
  assert.match(trackingRouterSource, /router\.get\('\/:deliveryId\/location'/);
  assert.match(trackingRouterSource, /order\.buyerId/);
  assert.match(
    trackingRouterSource,
    /actorId === storeId \|\| actorId === buyerId \|\| actorId === courierId/
  );
  assert.match(trackingRouterSource, /TRACKING_FORBIDDEN/);
  assert.match(trackingRouterSource, /response\.status\(403\)/);
});

test('inactive tracking never returns stale coordinates', () => {
  assert.match(
    trackingRouterSource,
    /deliveryInProgress[\s\S]*tracking\?\.active === true/
  );
  assert.match(
    trackingRouterSource,
    /if \(!active\) \{[\s\S]*json\(\{ deliveryId, active: false \}\)/
  );
  const inactiveBranch = trackingRouterSource.match(
    /if \(!active\) \{[\s\S]*?return;\n\s*\}/
  )?.[0] ?? '';
  assert.doesNotMatch(inactiveBranch, /latitude|longitude/);
});

test('tracking requires explicit browser geolocation permission and opt-in', () => {
  assert.match(trackingBridgeSource, /Ativar localização/);
  assert.match(trackingBridgeSource, /navigator\.geolocation\.watchPosition/);
  assert.match(trackingBridgeSource, /PERMISSION_DENIED/);
  assert.match(trackingBridgeSource, /MIN_SEND_INTERVAL_MS = 5_000/);
  assert.match(trackingBridgeSource, /Parar rastreio/);
});

test('tracking bridge stops when assigned delivery is no longer active', () => {
  assert.match(trackingBridgeSource, /assignedDeliveries\.some/);
  assert.match(trackingBridgeSource, /clearWatch/);
  assert.match(trackingBridgeSource, /stopRemoteTracking/);
});

test('buyer identity is attached to the delivery opportunity without exposing precise GPS', () => {
  assert.match(opportunitySource, /buyerId: clean\(order\.buyerId\)/);
  assert.doesNotMatch(opportunitySource, /latitude:|longitude:/);
});

test('buyer and merchant viewers consume only the authorized tracking endpoint', () => {
  assert.match(viewerSource, /\/api\/delivery-tracking\/\$\{encodeURIComponent\(deliveryId\)\}\/location/);
  assert.match(viewerSource, /authorization: `Bearer \$\{token\}`/);
  assert.match(viewerSource, /REFRESH_INTERVAL_MS = 5_000/);
  assert.match(viewerSource, /CourierGoogleMap/);
  assert.doesNotMatch(viewerSource, /deliveryTracking/);
  assert.match(buyerViewerSource, /data\.buyerId/);
  assert.match(merchantViewerSource, /data\.storeId/);
  assert.match(storefrontSource, /<BuyerDeliveryTrackingBridge storeId=\{store\.id\} buyerId=\{user\.uid\} \/>/);
  assert.match(retailerSource, /<StoreDeliveryTrackingBridge storeId=\{activeRetailerId\} \/>/);
});

test('Google Maps is optional and only loads from configured environment key', () => {
  assert.match(mapSource, /VITE_GOOGLE_MAPS_API_KEY/);
  assert.match(mapSource, /maps\.googleapis\.com\/maps\/api\/js/);
  assert.match(mapSource, /A calcular|GPS ativo/);
  assert.match(mapSource, /www\.google\.com\/maps\/dir/);
});

test('live tracking bridge lives outside the remounted legacy application', () => {
  const trackingIndex = appSource.indexOf('<CourierLiveTrackingBridge />');
  const legacyIndex = appSource.indexOf('<LegacyApp key=');
  assert.ok(trackingIndex >= 0);
  assert.ok(legacyIndex > trackingIndex);
});
