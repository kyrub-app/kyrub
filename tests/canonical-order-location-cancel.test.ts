import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const navigationSource = readFileSync(
  'src/utils/canonicalOrderNavigation.ts',
  'utf8'
);
const handoffSource = readFileSync(
  'src/utils/resolvedRetryHandoff.ts',
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
const portalSource = readFileSync(
  'src/components/store/StoreConnectionsPortalBridge.tsx',
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

test('successful exact focus emits a separate acknowledgement event while cancel does not', () => {
  const cancelStart = navigationSource.indexOf('export const cancelCanonicalOrderNavigation = (');
  const acknowledgeStart = navigationSource.indexOf(
    'export const acknowledgeCanonicalOrderNavigation = (',
    cancelStart
  );
  const consumeStart = navigationSource.indexOf(
    'export const consumeCanonicalOrderNavigation = (',
    acknowledgeStart
  );
  const cancelSection = navigationSource.slice(cancelStart, acknowledgeStart);
  const acknowledgeSection = navigationSource.slice(acknowledgeStart, consumeStart);

  assert.match(
    navigationSource,
    /KYRUB_CANONICAL_ORDER_NAVIGATION_ACKNOWLEDGED_EVENT =\n  'kyrub:canonical-order-navigation-acknowledged'/
  );
  assert.doesNotMatch(cancelSection, /KYRUB_CANONICAL_ORDER_NAVIGATION_ACKNOWLEDGED_EVENT/);
  assert.match(acknowledgeSection, /KYRUB_CANONICAL_ORDER_NAVIGATION_ACKNOWLEDGED_EVENT/);
  assert.match(acknowledgeSection, /storeId: normalizedStoreId/);
  assert.match(acknowledgeSection, /orderId: normalizedOrderId/);
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

test('resolved 99Food retry handoff remains memory-only and is cleared only by matching exact focus acknowledgement', () => {
  assert.match(handoffSource, /const handoffByStore = new Map<string, NinetyNineFoodRetryResolvedDetail>\(\);/);
  assert.match(handoffSource, /retainResolvedRetryHandoff/);
  assert.match(handoffSource, /readResolvedRetryHandoff/);
  assert.match(handoffSource, /clearResolvedRetryHandoff/);
  assert.match(
    handoffSource,
    /KYRUB_CANONICAL_ORDER_NAVIGATION_ACKNOWLEDGED_EVENT/
  );
  assert.match(handoffSource, /current\.orderId !== normalizedOrderId/);
  assert.match(handoffSource, /handoffByStore\.delete\(normalizedStoreId\)/);
  assert.doesNotMatch(
    handoffSource,
    /localStorage|sessionStorage|firebase|firestore|\bfetch\(|setTimeout|setInterval/i
  );
});

test('cancelling order location cannot clear the retained resolved retry handoff', () => {
  assert.doesNotMatch(
    navigationSource.slice(
      navigationSource.indexOf('export const cancelCanonicalOrderNavigation = ('),
      navigationSource.indexOf('export const acknowledgeCanonicalOrderNavigation = (')
    ),
    /resolvedRetry|handoff|KYRUB_CANONICAL_ORDER_NAVIGATION_ACKNOWLEDGED_EVENT/i
  );
  assert.doesNotMatch(handoffSource, /KYRUB_CANONICAL_ORDER_NAVIGATION_CHANGED_EVENT/);
});

test('store connections portal restores the retained handoff and opening Pedidos does not consume it', () => {
  const retryEffectStart = portalSource.indexOf('const syncResolvedRetry = (): void =>');
  const portalReturnStart = portalSource.indexOf('  if (!host || user.uid !== storeId) return null;', retryEffectStart);
  const retrySection = portalSource.slice(retryEffectStart, portalReturnStart);
  const buttonStart = portalSource.indexOf('id="kyrub-open-resolved-99food-order"');
  const buttonEnd = portalSource.indexOf('</button>', buttonStart);
  const buttonSection = portalSource.slice(buttonStart, buttonEnd);

  assert.ok(retryEffectStart >= 0);
  assert.ok(portalReturnStart > retryEffectStart);
  assert.match(retrySection, /readResolvedRetryHandoff\(storeId\)/);
  assert.match(retrySection, /retainResolvedRetryHandoff\(\{ \.\.\.detail, storeId, orderId \}\)/);
  assert.match(retrySection, /KYRUB_RESOLVED_RETRY_HANDOFF_CHANGED_EVENT/);

  assert.ok(buttonStart >= 0);
  assert.ok(buttonEnd > buttonStart);
  assert.match(buttonSection, /requestCanonicalOrderNavigation\(\{/);
  assert.doesNotMatch(buttonSection, /setResolvedRetry\(null\)|clearResolvedRetryHandoff/);
  assert.doesNotMatch(
    buttonSection,
    /retryNinetyNineFoodBlockedOrderReservation|updateOrderStatusWithDecision|sendNinetyNineFoodOrderStatus|\bfetch\(/
  );
});
