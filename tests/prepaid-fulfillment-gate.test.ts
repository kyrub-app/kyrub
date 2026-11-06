import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync('server/inventory/orderInventoryService.ts', 'utf8');
const transition = source.slice(source.indexOf('export const transitionOrderStatusWithInventory'));

test('explicit prepaid release mode blocks all fulfillment status transitions', () => {
  assert.match(transition, /releaseMode === 'pay_before_fulfillment'/);
  for (const status of ['preparing', 'ready', 'out_for_delivery', 'completed']) {
    assert.ok(transition.includes("nextStatus === '" + status + "'"), status);
  }
  assert.match(transition, /aguardando liberação financeira autoritativa/);
});

test('prepaid release check occurs before inventory consumption or ready evidence', () => {
  const gate = transition.indexOf("releaseMode === 'pay_before_fulfillment'");
  assert.ok(gate > 0);
  assert.ok(gate < transition.indexOf('resolvePhysicalInventoryAuthority'));
  assert.ok(gate < transition.indexOf('writeStoreMarkedReadyEvidenceInTransaction'));
  assert.ok(gate < transition.indexOf('applyInventoryForStatus'));
});

test('legacy and partner orders are not reclassified as prepaid implicitly', () => {
  assert.match(transition, /orderSnapshot\.data\(\).*\?\.releaseMode/);
  assert.doesNotMatch(transition, /sourceChannel === '99food' && releaseMode/);
});
