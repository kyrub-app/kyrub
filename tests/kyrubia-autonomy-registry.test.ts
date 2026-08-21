import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluateKyrubAutonomy,
  KYRUB_AUTONOMY_REGISTRY,
} from '../shared/kyrubAutonomy';
import { KYRUB_ACTION_REGISTRY } from '../shared/kyrubActions';

test('every active action has an autonomy definition', () => {
  assert.deepEqual(
    Object.keys(KYRUB_AUTONOMY_REGISTRY).sort(),
    Object.keys(KYRUB_ACTION_REGISTRY).sort()
  );
});

test('global kill switch overrides an otherwise allowed action', () => {
  const decision = evaluateKyrubAutonomy('read_store_summary', 1, {
    globalKillSwitch: true,
  });
  assert.equal(decision.allowed, false);
  assert.deepEqual(decision.reasons, ['GLOBAL_KILL_SWITCH']);
});

test('domain and action kill switches are independently enforceable', () => {
  const domain = evaluateKyrubAutonomy('update_product', 3, {
    domainKillSwitches: { catalog: true },
  });
  const action = evaluateKyrubAutonomy('update_product', 3, {
    actionKillSwitches: { update_product: true },
  });
  assert.ok(domain.reasons.includes('DOMAIN_KILL_SWITCH'));
  assert.ok(action.reasons.includes('ACTION_KILL_SWITCH'));
});

test('feature flags can disable one capability without disabling its domain', () => {
  const flag = KYRUB_AUTONOMY_REGISTRY.create_note.featureFlag;
  const decision = evaluateKyrubAutonomy('create_note', 3, {
    featureFlags: { [flag]: false },
  });
  assert.equal(decision.allowed, false);
  assert.deepEqual(decision.reasons, ['FEATURE_DISABLED']);
});

test('medium-risk business mutations are not autonomous level 4 by default', () => {
  for (const actionType of [
    'create_product',
    'update_product',
    'adjust_inventory',
    'update_order_status',
  ] as const) {
    const decision = evaluateKyrubAutonomy(actionType, 4);
    assert.equal(decision.allowed, false);
    assert.ok(decision.reasons.includes('LEVEL_EXCEEDED'));
    assert.equal(decision.maximumLevel, 3);
  }
});

test('low-risk productivity actions can be eligible for explicit level 4 automation', () => {
  assert.equal(evaluateKyrubAutonomy('create_note', 4).allowed, true);
  assert.equal(evaluateKyrubAutonomy('create_task', 4).allowed, true);
});
