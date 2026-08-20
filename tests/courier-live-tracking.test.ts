import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const serverSource = readFileSync('server.ts', 'utf8');
const trackingRouterSource = readFileSync(
  'server/delivery/deliveryTrackingRouter.ts',
  'utf8'
);
const trackingBridgeSource = readFileSync(
  'src/components/store/CourierLiveTrackingBridge.tsx',
  'utf8'
);
const mapSource = readFileSync(
  'src/components/store/CourierGoogleMap.tsx',
  'utf8'
);
const appSource = readFileSync('src/App.tsx', 'utf8');

test('courier location endpoint is mounted behind delivery work eligibility', () => {
  assert.match(serverSource, /\/api\/delivery-tracking/);
  assert.match(serverSource, /enforceDeliveryWorkEligibility,[\s\S]*createDeliveryTrackingRouter/);
});

test('precise courier position is written to a private tracking collection', () => {
  assert.match(trackingRouterSource, /deliveryTracking/);
  assert.match(trackingRouterSource, /claim\.courierId/);
  assert.match(trackingRouterSource, /Este entregador não é o responsável/);
  assert.match(trackingRouterSource, /\['accepted', 'delivering'\]/);
  assert.doesNotMatch(trackingRouterSource, /hub\/renda\/deliveries.*latitude/);
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
