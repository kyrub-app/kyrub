import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildPublicKyrubDeliveryOffer, PUBLIC_KYRUB_DESTINATION_LABEL } from '../server/delivery/deliveryPublicOfferProjection';

const source = (path: string): string => readFileSync(path, 'utf8');

test('the public projection only contains allowlisted non-identifying metadata', () => {
  const sensitiveInput = {
    id: 'opaque-order-hash',
    storeName: 'Loja Exemplo',
    status: 'available',
    orderStatus: 'preparing',
    distance: 4.2,
    payment: 17,
    buyerId: 'private-buyer-uid',
    buyerName: 'Nome Privado',
    deliveryAddress: 'Rua Privada, 999',
    customerDestinationResolutionSnapshot: { latitude: -23.5, longitude: -46.6 },
  };
  const offer = buildPublicKyrubDeliveryOffer(sensitiveInput);
  assert.deepEqual(Object.keys(offer).sort(), [
    'distance', 'from', 'id', 'orderStatus', 'payment',
    'requestedBy', 'source', 'status', 'to',
  ]);
  assert.equal(offer.to, PUBLIC_KYRUB_DESTINATION_LABEL);
  assert.equal(offer.from, 'Loja Exemplo');
  assert.equal(offer.source, 'kyrub-order');
  assert.doesNotMatch(JSON.stringify(offer), /private-buyer-uid|Nome Privado|Rua Privada|latitude|longitude/);
});

test('public offer lifecycle mirrors server-owned acceptance, pickup and buyer confirmation', () => {
  const router = source('server/delivery/deliveryOpportunityRouter.ts');
  const pickup = source('server/delivery/deliveryPickupHandoffService.ts');
  const handoff = source('server/delivery/deliveryCustomerHandoffService.ts');
  assert.match(router, /transaction\.set\(adminDb\.doc\(publicOfferPath\(id\)\)/);
  assert.match(router, /transaction\.get\(reference\)/);
  assert.doesNotMatch(router, /batch\.set\(reference, payload/);
  assert.match(router, /buildPublicKyrubDeliveryOffer/);
  assert.match(router, /transaction\.set\(publicOfferReference, \{ status: 'accepted'/);
  assert.match(pickup, /transaction\.set\(publicOfferRef, \{ status: 'delivering'/);
  assert.match(handoff, /transaction\.set\(publicOfferRef, \{ status: 'done'/);
});

test('public and private listeners preserve the Firestore ownership boundary', () => {
  const publicBridge = source('src/components/store/KyrubDeliveryOpportunityBridge.tsx');
  assert.match(publicBridge, /collection\(db, PUBLIC_OFFERS_PATH\)/);
  assert.match(publicBridge, /where\('acceptedBy', '==', user\.uid\)/);
  assert.match(publicBridge, /to: PUBLIC_DESTINATION/);
  assert.match(publicBridge, /to: PRIVATE_DESTINATION/);
  assert.doesNotMatch(publicBridge, /to: clean\(data\.to\)/);
  assert.match(publicBridge, /localStorage\.removeItem\(DELIVERY_STORAGE_KEY\)/);
  const requiredQueries = [
    ['CourierLiveTrackingBridge', "'acceptedBy', '==', user.uid"],
    ['KyrubDeliveryStatusSyncBridge', "'acceptedBy', '==', user.uid"],
    ['BuyerDeliveryTrackingBridge', "'buyerId', '==', buyerId"],
    ['StoreDeliveryTrackingBridge', "'storeId', '==', storeId"],
  ];
  for (const [name, predicate] of requiredQueries) {
    const file = source('src/components/store/' + name + '.tsx');
    assert.ok(file.includes("where(" + predicate + ")"), name + ' must query by owner');
  }
});

test('Firestore canonical delivery is never globally readable by a signed-in account', () => {
  const rules = source('scripts/firestore-rule-composition.mjs');
  assert.match(rules, /match \/hub\/renda\/deliveries\/\{deliveryId\}/);
  assert.match(rules, /resource\.data\.get\('storeId', ''\) == request\.auth\.uid/);
  assert.match(rules, /resource\.data\.get\('buyerId', ''\) == request\.auth\.uid/);
  assert.match(rules, /resource\.data\.get\('acceptedBy', ''\) == request\.auth\.uid/);
  assert.match(rules, /match \/hub\/renda\/deliveryOffers\/\{deliveryId\}/);
  assert.match(rules, /allow create, update, delete: if false/);
});

test('local cache sanitizes previously stored exact destinations and nested private fields', async () => {
  const { sanitizeDeliveryCache } = await import('../src/utils/courierDeliveryCache');
  const original = {
    id: 'order-abc', source: 'kyrub-order', status: 'accepted',
    from: 'Loja Exemplo', to: 'Rua do Comprador, 999',
    distance: 3, payment: 11, acceptedBy: 'courier-uid',
    buyerId: 'buyer-secret', customerName: 'Pessoa Secreta',
    customerGeofenceSnapshot: { latitude: -23.6, longitude: -46.7 },
  };
  const sanitized = sanitizeDeliveryCache([original, { ...original, id: 'del-1', source: 'manual' }]);
  assert.equal(sanitized.length, 1);
  assert.equal(sanitized[0]?.id, 'order-abc');
  assert.equal(sanitized[0]?.acceptedBy, 'courier-uid');
  assert.doesNotMatch(JSON.stringify(sanitized), /Rua do Comprador|buyer-secret|Pessoa Secreta|latitude|longitude|customerGeofenceSnapshot/);
  assert.deepEqual(sanitizeDeliveryCache(null), []);
  assert.deepEqual(sanitizeDeliveryCache({}), []);
  const legacy = source('src/LegacyApp.tsx');
  assert.match(legacy, /sanitizeDeliveryCache\(JSON\.parse\(saved\)/);
  assert.match(legacy, /JSON\.stringify\(sanitizeDeliveryCache\(deliveries\)\)/);
});
