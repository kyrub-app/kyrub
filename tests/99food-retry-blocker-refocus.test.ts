import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const queueSource = readFileSync(
  'src/components/store/StoreChannelOperationsQueue.tsx',
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
