import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const queueSource = readFileSync(
  'src/components/store/StoreChannelOperationsQueue.tsx',
  'utf8'
);
const operationsSource = readFileSync(
  'src/utils/storeChannelOperations.ts',
  'utf8'
);
const navigationSource = readFileSync(
  'src/utils/canonicalOrderNavigation.ts',
  'utf8'
);
const portalSource = readFileSync(
  'src/components/store/StoreConnectionsPortalBridge.tsx',
  'utf8'
);
const retailerSource = readFileSync(
  'src/components/RetailerPanel.tsx',
  'utf8'
);
const inboxSource = readFileSync(
  'src/components/customer/CustomerOrderInbox.tsx',
  'utf8'
);

test('blocked retry refocus uses only the authoritative refreshed queue and exact 99Food order identity', () => {
  const effectStart = queueSource.indexOf("useEffect(() => {\n    if (!refocusOrderId || loading) return;");
  const effectEnd = queueSource.indexOf('  const preflightReservation = async', effectStart);
  const effectSection = queueSource.slice(effectStart, effectEnd);

  assert.ok(effectStart >= 0);
  assert.ok(effectEnd > effectStart);
  assert.match(effectSection, /candidate\.provider === '99food' && candidate\.reference === refocusOrderId/);
  assert.match(effectSection, /document\.getElementById\(operationElementId\(matchingItem\)\)/);
  assert.match(effectSection, /scrollIntoView\(\{ behavior: 'smooth', block: 'center' \}\)/);
  assert.match(effectSection, /focus\(\{ preventScroll: true \}\)/);
  assert.match(effectSection, /setRefocusOrderId\(''\)/);
  assert.doesNotMatch(
    effectSection,
    /retryNinetyNineFoodBlockedOrderReservation|openRemediation|requestPhysicalInventoryFocus|requestNinetyNineFoodBindingRemediation|preflightNinetyNineFoodBlockedOrderReservation|diagnoseNinetyNineFoodBlockedOrderInventoryAuthority/
  );
});

test('retry schedules refocus only after authoritative refresh and only while the readback remains blocked', () => {
  const helperStart = queueSource.indexOf('const retryStateRemainsBlocked =');
  const helperEnd = queueSource.indexOf('const retryFeedbackTone =', helperStart);
  const helperSection = queueSource.slice(helperStart, helperEnd);
  const handlerStart = queueSource.indexOf('const retryReservation = async');
  const handlerEnd = queueSource.indexOf('const operationBusy', handlerStart);
  const handlerSection = queueSource.slice(handlerStart, handlerEnd);

  assert.ok(helperStart >= 0);
  assert.ok(helperEnd > helperStart);
  assert.match(helperSection, /state === 'blocked_insufficient_atp'/);
  assert.match(helperSection, /state === 'blocked_product_binding_unresolved'/);
  assert.match(helperSection, /state === 'blocked_authority_unresolved'/);
  assert.doesNotMatch(helperSection, /reserved|released|consumed|waiting_physical_consumption|not_applicable/);

  const retryIndex = handlerSection.indexOf('const result = await retryNinetyNineFoodBlockedOrderReservation');
  const refreshIndex = handlerSection.indexOf('await refresh()');
  const blockedCheckIndex = handlerSection.indexOf('if (retryStateRemainsBlocked(result.state))');
  const refocusIndex = handlerSection.indexOf('setRefocusOrderId(result.orderId)');

  assert.ok(retryIndex >= 0);
  assert.ok(refreshIndex > retryIndex);
  assert.ok(blockedCheckIndex > refreshIndex);
  assert.ok(refocusIndex > blockedCheckIndex);
  assert.equal(handlerSection.match(/retryNinetyNineFoodBlockedOrderReservation/g)?.length, 1);
});

test('queue rows expose a deterministic focus target without making remediation automatic', () => {
  assert.match(queueSource, /const operationElementId = \(item: StoreChannelOperationalItem\): string =>/);
  assert.match(queueSource, /`kyrub-channel-operation-\$\{item\.provider\}-\$\{encodeURIComponent\(item\.reference\)\}`/);
  assert.match(queueSource, /id=\{operationElementId\(item\)\}/);
  assert.match(queueSource, /tabIndex=\{-1\}/);
});

test('resolved retry signal is emitted only after validated authoritative readback and never for blocked states', () => {
  const retryStart = operationsSource.indexOf('export const retryNinetyNineFoodBlockedOrderReservation = async');
  const retryEnd = operationsSource.indexOf('export const buildStoreChannelOperationalItems', retryStart);
  const retrySection = operationsSource.slice(retryStart, retryEnd);

  assert.ok(retryStart >= 0);
  assert.ok(retryEnd > retryStart);
  const validationIndex = retrySection.indexOf("throw new Error('A resposta autoritativa da nova tentativa de reserva está incompleta.')");
  const resultIndex = retrySection.indexOf('const result: NinetyNineFoodReservationRetryResult =');
  const resolvedCheckIndex = retrySection.indexOf('if (!RETRY_BLOCKED_STATES.has(result.state))');
  const eventIndex = retrySection.indexOf('KYRUB_99FOOD_RETRY_RESOLVED_EVENT');
  const returnIndex = retrySection.indexOf('return result;');

  assert.ok(validationIndex >= 0);
  assert.ok(resultIndex > validationIndex);
  assert.ok(resolvedCheckIndex > resultIndex);
  assert.ok(eventIndex > resolvedCheckIndex);
  assert.ok(returnIndex > eventIndex);
  assert.match(operationsSource, /const RETRY_BLOCKED_STATES = new Set<NinetyNineFoodReservationRetryState>\(\[/);
  assert.match(operationsSource, /'blocked_product_binding_unresolved'/);
  assert.match(operationsSource, /'blocked_insufficient_atp'/);
  assert.match(operationsSource, /'blocked_authority_unresolved'/);
  assert.doesNotMatch(retrySection, /sendNinetyNineFoodOrderStatus|updateOrderStatusWithDecision/);
});

test('canonical order navigation stays memory-only and carries exact store and order identity', () => {
  assert.match(navigationSource, /let pendingNavigation: CanonicalOrderNavigationRequest \| null = null;/);
  assert.match(navigationSource, /pendingNavigation = normalized;/);
  assert.match(navigationSource, /KYRUB_CANONICAL_ORDER_NAVIGATION_REQUESTED_EVENT/);
  assert.match(navigationSource, /\{ detail: normalized \}/);
  assert.match(navigationSource, /pendingNavigation\?\.storeId !== normalizedStoreId/);
  assert.match(navigationSource, /pendingNavigation = null;/);
  assert.doesNotMatch(navigationSource, /localStorage|sessionStorage|\bfetch\(|firebase|firestore/i);
});

test('canonical order navigation is retained across inbox remounts until exact focus acknowledgement', () => {
  const readStart = navigationSource.indexOf('export const readCanonicalOrderNavigation = (');
  const currentStart = navigationSource.indexOf('export const isCurrentCanonicalOrderNavigation = (', readStart);
  const acknowledgeStart = navigationSource.indexOf('export const acknowledgeCanonicalOrderNavigation = (', currentStart);
  const consumeStart = navigationSource.indexOf('export const consumeCanonicalOrderNavigation = (', acknowledgeStart);
  const readSection = navigationSource.slice(readStart, currentStart);
  const currentSection = navigationSource.slice(currentStart, acknowledgeStart);
  const acknowledgeSection = navigationSource.slice(acknowledgeStart, consumeStart);

  assert.ok(readStart >= 0);
  assert.ok(currentStart > readStart);
  assert.ok(acknowledgeStart > currentStart);
  assert.ok(consumeStart > acknowledgeStart);
  assert.match(readSection, /pendingNavigation\?\.storeId !== normalizedStoreId/);
  assert.match(readSection, /return pendingNavigation;/);
  assert.doesNotMatch(readSection, /pendingNavigation = null/);
  assert.match(currentSection, /pendingNavigation\?\.storeId === normalizedStoreId/);
  assert.match(currentSection, /pendingNavigation\.orderId === normalizedOrderId/);
  assert.match(acknowledgeSection, /if \(!isCurrentCanonicalOrderNavigation\(storeId, orderId\)\)/);
  assert.match(acknowledgeSection, /pendingNavigation = null;/);
  assert.match(acknowledgeSection, /replacedNavigationOrderId = '';/);
  assert.match(acknowledgeSection, /return true;/);
});

test('latest explicit canonical order navigation replaces the older target for the same store', () => {
  const requestStart = navigationSource.indexOf('export const requestCanonicalOrderNavigation = (');
  const readStart = navigationSource.indexOf('export const readCanonicalOrderNavigation = (', requestStart);
  const requestSection = navigationSource.slice(requestStart, readStart);
  const replacementStart = navigationSource.indexOf('export const readReplacedCanonicalOrderNavigationId = (');
  const currentStart = navigationSource.indexOf('export const isCurrentCanonicalOrderNavigation = (', replacementStart);
  const replacementSection = navigationSource.slice(replacementStart, currentStart);

  assert.ok(requestStart >= 0);
  assert.ok(readStart > requestStart);
  assert.match(requestSection, /const previous = pendingNavigation;/);
  assert.match(requestSection, /previous\.storeId === normalized\.storeId/);
  assert.match(requestSection, /previous\.orderId !== normalized\.orderId/);
  assert.match(requestSection, /\? previous\.orderId/);
  assert.match(requestSection, /pendingNavigation = normalized;/);
  assert.match(replacementSection, /return replacedNavigationOrderId;/);
  assert.doesNotMatch(requestSection, /push\(|queue|localStorage|sessionStorage|\bfetch\(/i);
});

test('resolved retry handoff is an explicit navigation button and not an operational write', () => {
  const effectStart = portalSource.indexOf('const handleRetryResolved = (event: Event): void =>');
  const effectEnd = portalSource.indexOf('  if (!host || user.uid !== storeId) return null;', effectStart);
  const effectSection = portalSource.slice(effectStart, effectEnd);
  const handoffStart = portalSource.indexOf('id="kyrub-99food-retry-resolved-handoff"');
  const handoffEnd = portalSource.indexOf('<StoreChannelOperationsQueue', handoffStart);
  const handoffSection = portalSource.slice(handoffStart, handoffEnd);

  assert.ok(effectStart >= 0);
  assert.ok(effectEnd > effectStart);
  assert.match(effectSection, /detail\?\.storeId\?\.trim\(\) !== storeId/);
  assert.match(effectSection, /user\.uid !== storeId/);
  assert.match(effectSection, /setResolvedRetry\(\{ \.\.\.detail, storeId, orderId \}\)/);

  assert.ok(handoffStart >= 0);
  assert.ok(handoffEnd > handoffStart);
  assert.match(handoffSection, /id="kyrub-open-resolved-99food-order"/);
  assert.match(handoffSection, /requestCanonicalOrderNavigation\(\{/);
  assert.match(handoffSection, /storeId,/);
  assert.match(handoffSection, /orderId: resolvedRetry\.orderId/);
  assert.match(handoffSection, /if \(requested\) setResolvedRetry\(null\)/);
  assert.doesNotMatch(
    handoffSection,
    /retryNinetyNineFoodBlockedOrderReservation|updateOrderStatusWithDecision|sendNinetyNineFoodOrderStatus|\bfetch\(/
  );
});

test('retailer navigation listener only opens Pedidos for the authenticated exact store', () => {
  const listenerStart = retailerSource.indexOf('const handleCanonicalOrderNavigation = (event: Event): void =>');
  const listenerEnd = retailerSource.indexOf('  useEffect(() => {\n    const handlePublicProductCreate', listenerStart);
  const listenerSection = retailerSource.slice(listenerStart, listenerEnd);

  assert.ok(listenerStart >= 0);
  assert.ok(listenerEnd > listenerStart);
  assert.match(listenerSection, /detail\?\.storeId\?\.trim\(\) !== activeRetailerId/);
  assert.match(listenerSection, /user\.uid !== activeRetailerId/);
  assert.match(listenerSection, /setCanonicalNavigationOrderId\(detail\.orderId\.trim\(\)\)/);
  assert.match(listenerSection, /setActiveSubTab\('pedidos'\)/);
  assert.doesNotMatch(listenerSection, /updateOrderStatusWithDecision|setCustomerOrders|\bfetch\(/);
  assert.match(retailerSource, /<CustomerOrderInbox\s+storeId=\{activeRetailerId\}/);
});

test('customer order inbox reads exact pending identity, clears hiding filters, and acknowledges only after current exact focus', () => {
  const navigationStart = inboxSource.indexOf('const acceptNavigation = (');
  const navigationEnd = inboxSource.indexOf('  const filterOptions:', navigationStart);
  const navigationSection = inboxSource.slice(navigationStart, navigationEnd);

  assert.ok(navigationStart >= 0);
  assert.ok(navigationEnd > navigationStart);
  assert.match(navigationSection, /readCanonicalOrderNavigation\(storeId\)/);
  assert.doesNotMatch(navigationSection, /consumeCanonicalOrderNavigation\(storeId\)/);
  assert.match(navigationSection, /request\.storeId !== storeId/);
  assert.match(navigationSection, /setFocusOrderId\(request\.orderId\)/);
  assert.match(navigationSection, /readReplacedCanonicalOrderNavigationId\(storeId\)/);
  assert.match(navigationSection, /orders\.find\(order => order\.id === focusOrderId\)/);
  assert.match(navigationSection, /setOriginFilter\('all'\)/);
  assert.match(navigationSection, /setStationFilter\('all'\)/);
  assert.match(navigationSection, /\['completed', 'rejected', 'cancelled'\]\.includes\(target\.status\)/);

  const currentIndex = navigationSection.indexOf('isCurrentCanonicalOrderNavigation(storeId, focusedOrderId)');
  const elementIndex = navigationSection.indexOf('document.getElementById(orderElementId(focusedOrderId))');
  const scrollIndex = navigationSection.indexOf("scrollIntoView({ behavior: 'smooth', block: 'center' })");
  const focusIndex = navigationSection.indexOf('focus({ preventScroll: true })');
  const acknowledgeIndex = navigationSection.indexOf('acknowledgeCanonicalOrderNavigation(storeId, focusedOrderId)');
  const clearLocalIndex = navigationSection.indexOf("setFocusOrderId(current => current === focusedOrderId ? '' : current)");

  assert.ok(currentIndex >= 0);
  assert.ok(elementIndex > currentIndex);
  assert.ok(scrollIndex > elementIndex);
  assert.ok(focusIndex > scrollIndex);
  assert.ok(acknowledgeIndex > focusIndex);
  assert.ok(clearLocalIndex > acknowledgeIndex);
  assert.match(navigationSection, /if \(!acknowledgeCanonicalOrderNavigation\(storeId, focusedOrderId\)\) return;/);
  assert.doesNotMatch(navigationSection, /onChangeStatus|updateOrderStatusWithDecision|\bfetch\(/);
  assert.match(inboxSource, /id=\{orderElementId\(order\.id\)\}/);
  assert.match(inboxSource, /tabIndex=\{-1\}/);
});

test('inbox explicitly reports when a newer order navigation replaces an older pending target', () => {
  const bannerStart = inboxSource.indexOf('id="kyrub-canonical-order-navigation-replaced"');
  const bannerEnd = inboxSource.indexOf('<div className="rounded-2xl border border-cyan-500/20', bannerStart);
  const bannerSection = inboxSource.slice(bannerStart, bannerEnd);

  assert.ok(bannerStart >= 0);
  assert.ok(bannerEnd > bannerStart);
  assert.match(bannerSection, /replacedFocusOrderId/);
  assert.match(bannerSection, /focusOrderId/);
  assert.match(bannerSection, /Pedido mais recente priorizado/);
  assert.match(bannerSection, /O Kyrub seguirá somente o destino explícito mais recente/);
  assert.doesNotMatch(bannerSection, /onChangeStatus|updateOrderStatusWithDecision|\bfetch\(/);
});

test('pending canonical order location is visible, exact, and never falls back to a similar order', () => {
  const stateStart = retailerSource.indexOf("const [canonicalNavigationOrderId, setCanonicalNavigationOrderId] = useState('');");
  const visibleStart = retailerSource.indexOf('const canonicalNavigationOrderVisible = useMemo(', stateStart);
  const listenerStart = retailerSource.indexOf('const handleCanonicalOrderNavigation = (event: Event): void =>', visibleStart);
  const bannerStart = retailerSource.indexOf('id="kyrub-canonical-order-location-pending"', listenerStart);
  const bannerEnd = retailerSource.indexOf('<CustomerOrderInbox', bannerStart);
  const visibilitySection = retailerSource.slice(visibleStart, listenerStart);
  const bannerSection = retailerSource.slice(bannerStart, bannerEnd);

  assert.ok(stateStart >= 0);
  assert.ok(visibleStart > stateStart);
  assert.ok(listenerStart > visibleStart);
  assert.ok(bannerStart > listenerStart);
  assert.ok(bannerEnd > bannerStart);
  assert.match(visibilitySection, /kdsOrders\.some\(order => order\.id === canonicalNavigationOrderId\)/);
  assert.match(bannerSection, /canonicalNavigationOrderId/);
  assert.match(bannerSection, /Nenhum outro pedido será escolhido por nome, cliente, SKU ou similaridade/);
  assert.doesNotMatch(
    `${visibilitySection}\n${bannerSection}`,
    /includes\(canonicalNavigationOrderId\)|localeCompare|toLocaleLowerCase|fuzzy|similarity|updateOrderStatusWithDecision|onChangeStatus|\bfetch\(/
  );
});
