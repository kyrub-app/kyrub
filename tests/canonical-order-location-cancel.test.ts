import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const navigationSource = readFileSync(
  'src/utils/canonicalOrderNavigation.ts',
  'utf8'
);
const controlSource = readFileSync(
  'src/components/customer/CanonicalOrderLocationControl.tsx',
  'utf8'
);
const trackingBridgeSource = readFileSync(
  'src/components/store/StoreDeliveryTrackingBridge.tsx',
  'utf8'
);
const retailerSource = readFileSync(
  'src/components/RetailerPanel.tsx',
  'utf8'
);

test('canonical order location cancellation requires the exact current store and order identity', () => {
  const cancelStart = navigationSource.indexOf(
    'export const cancelCanonicalOrderNavigation = ('
  );
  const acknowledgeStart = navigationSource.indexOf(
    'export const acknowledgeCanonicalOrderNavigation = (',
    cancelStart
  );
  const cancelSection = navigationSource.slice(cancelStart, acknowledgeStart);

  assert.ok(cancelStart >= 0);
  assert.ok(acknowledgeStart > cancelStart);
  assert.match(
    cancelSection,
    /if \(!isCurrentCanonicalOrderNavigation\(storeId, orderId\)\)/
  );
  assert.match(cancelSection, /return false;/);
  assert.match(cancelSection, /pendingNavigation = null;/);
  assert.match(cancelSection, /replacedNavigationOrderId = '';/);
  assert.match(cancelSection, /notifyNavigationChanged\(\);/);
  assert.match(cancelSection, /return true;/);
  assert.doesNotMatch(cancelSection, /setTimeout|setInterval|localStorage|sessionStorage|fetch\(/);
});

test('navigation state changes are announced in memory after request, cancel, acknowledgement and legacy consume', () => {
  assert.match(
    navigationSource,
    /KYRUB_CANONICAL_ORDER_NAVIGATION_CHANGED_EVENT =\n  'kyrub:canonical-order-navigation-changed'/
  );
  assert.match(
    navigationSource,
    /window\.dispatchEvent\(new Event\(KYRUB_CANONICAL_ORDER_NAVIGATION_CHANGED_EVENT\)\)/
  );

  const notifyCount = navigationSource.match(/notifyNavigationChanged\(\);/g)?.length ?? 0;
  assert.equal(notifyCount, 4);
  assert.doesNotMatch(
    navigationSource,
    /localStorage|sessionStorage|firebase|firestore|\bfetch\(/i
  );
});

test('Pedidos exposes an explicit cancel control without operational side effects or automatic timeout', () => {
  assert.match(controlSource, /id="kyrub-canonical-order-location-control"/);
  assert.match(controlSource, /id="kyrub-cancel-canonical-order-location"/);
  assert.match(controlSource, /Cancelar localização/);
  assert.match(controlSource, /o pedido continua inalterado/i);
  assert.match(controlSource, /user\.uid !== normalizedStoreId/);
  assert.match(
    controlSource,
    /cancelCanonicalOrderNavigation\(normalizedStoreId, targetOrderId\)/
  );
  assert.match(
    controlSource,
    /readCanonicalOrderNavigation\(normalizedStoreId\)\?\.orderId \?\? ''/
  );
  assert.doesNotMatch(
    controlSource,
    /setTimeout|setInterval|localStorage|sessionStorage|onChangeStatus|updateOrderStatusWithDecision|retryNinetyNineFoodBlockedOrderReservation|\bfetch\(|firestore|setDoc|updateDoc/i
  );
});

test('stale cancel UI preserves a newer explicit target instead of clearing it', () => {
  const handlerStart = controlSource.indexOf('const cancelLocation = (): void =>');
  const handlerEnd = controlSource.indexOf('  return (', handlerStart);
  const handlerSection = controlSource.slice(handlerStart, handlerEnd);

  assert.ok(handlerStart >= 0);
  assert.ok(handlerEnd > handlerStart);
  const cancelIndex = handlerSection.indexOf(
    'cancelCanonicalOrderNavigation(normalizedStoreId, targetOrderId)'
  );
  const rereadIndex = handlerSection.indexOf(
    'readCanonicalOrderNavigation(normalizedStoreId)?.orderId'
  );
  const clearIndex = handlerSection.lastIndexOf("setOrderId('')");

  assert.ok(cancelIndex >= 0);
  assert.ok(rereadIndex > cancelIndex);
  assert.ok(clearIndex > rereadIndex);
});

test('retailer pending banner follows the same in-memory navigation state after cancel or focus acknowledgement', () => {
  const syncStart = retailerSource.indexOf(
    'const syncCanonicalOrderNavigation = (): void =>'
  );
  const syncEnd = retailerSource.indexOf(
    '  useEffect(() => {\n    const handlePublicProductCreate',
    syncStart
  );
  const syncSection = retailerSource.slice(syncStart, syncEnd);

  assert.ok(syncStart >= 0);
  assert.ok(syncEnd > syncStart);
  assert.match(syncSection, /user\.uid !== activeRetailerId/);
  assert.match(
    syncSection,
    /readCanonicalOrderNavigation\(activeRetailerId\)\?\.orderId \?\? ''/
  );
  assert.match(
    syncSection,
    /KYRUB_CANONICAL_ORDER_NAVIGATION_CHANGED_EVENT/
  );
  assert.match(syncSection, /setCanonicalNavigationOrderId\(''\)/);
  assert.doesNotMatch(
    syncSection,
    /setActiveSubTab|updateOrderStatusWithDecision|onChangeStatus|\bfetch\(/
  );
});

test('order location control remains mounted even when there are no active deliveries', () => {
  const returnStart = trackingBridgeSource.indexOf('  return (');
  const returnSection = trackingBridgeSource.slice(returnStart);

  assert.match(
    trackingBridgeSource,
    /import \{ CanonicalOrderLocationControl \} from '\.\.\/customer\/CanonicalOrderLocationControl';/
  );
  assert.match(returnSection, /<CanonicalOrderLocationControl storeId=\{storeId\} \/>/);
  assert.match(returnSection, /\{deliveries\.length > 0 && \(/);
  assert.doesNotMatch(
    trackingBridgeSource,
    /if \(deliveries\.length === 0\) return null;/
  );
});
