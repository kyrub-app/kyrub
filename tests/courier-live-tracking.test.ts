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
const navigationSource = readFileSync('src/utils/googleMapsDirections.ts', 'utf8');

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

test('buyer identity is attached to the delivery opportunity and precise destination coordinates remain server-authoritative', () => {
  assert.match(opportunitySource, /buyerId: clean\(order\.buyerId\)/);
  assert.match(opportunitySource, /buildDeliveryCustomerDestinationSnapshot/);
  assert.doesNotMatch(opportunitySource, /request\.body\?\.latitude|request\.body\?\.longitude/);
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
  assert.match(navigationSource, /www\.google\.com\/maps\/dir/);
  assert.match(navigationSource, /two-wheeler/);
  assert.match(navigationSource, /bicycling/);
  assert.match(mapSource, /decideCourierRoute\(/);
  assert.match(navigationSource, /buildCourierDeliveryNavigationUrl/);
  assert.doesNotMatch(mapSource, /travelmode: 'driving'/);
});

test('live tracking bridge lives outside the remounted legacy application', () => {
  const trackingIndex = appSource.indexOf('<CourierLiveTrackingBridge />');
  const legacyIndex = appSource.indexOf('<LegacyApp key=');
  assert.ok(trackingIndex >= 0);
  assert.ok(legacyIndex > trackingIndex);
});

test('live navigation uses confirmed vehicle and the active phase, never the public offer', () => {
  assert.match(trackingBridgeSource, /where\('acceptedBy', '==', user\.uid\)/);
  assert.match(trackingBridgeSource, /vehicleType: isCourierVehicleType\(data\.vehicleType\)/);
  assert.match(trackingBridgeSource, /navigation=\{\{ status: activeDelivery\.status, vehicleType: activeDelivery\.vehicleType \}\}/);
  assert.match(trackingBridgeSource, /activeDelivery\.status === 'accepted'/);
  assert.match(navigationSource, /input\.status === 'accepted' \? input\.pickup : input\.dropoff/);
  assert.match(mapSource, /const route = navigation \? decideCourierRoute\(/);
  assert.match(trackingBridgeSource, /returnStatus=\{returnRouteStatus\}/);
  assert.doesNotMatch(viewerSource, /navigation=\{/);
  assert.match(trackingBridgeSource, /error\.code === error\.PERMISSION_DENIED/);
  assert.match(trackingBridgeSource, /void stopRemoteTracking\(trackingDeliveryId\)/);
});

test('tracking endpoint rejects stale coordinates while retaining private authorization boundary', () => {
  assert.match(trackingRouterSource, /isFreshCourierTrackingTimestamp\(tracking\?\.updatedAt\)/);
  assert.match(trackingRouterSource, /tracking\?\.active === true && fresh/);
  assert.match(trackingRouterSource, /if \(!active\) \{[\s\S]*?json\(\{ deliveryId, active: false \}\)/);
});
