import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getKyrubiaAwarenessCapability,
  KYRUBIA_AWARENESS_CAPABILITIES,
  KYRUBIA_AWARENESS_PRECEDENCE,
} from '../shared/kyrubiaAwarenessMatrix';

test('authoritative Kyrub data has precedence over manual and external AI', () => {
  assert.deepEqual(KYRUBIA_AWARENESS_PRECEDENCE, [
    'authoritative_kyrub_data',
    'official_kyrub_action',
    'conversation_context',
    'manual_rag',
    'external_ai',
  ]);
});

test('awareness matrix covers every planned operational domain', () => {
  assert.deepEqual(
    new Set(KYRUBIA_AWARENESS_CAPABILITIES.map(capability => capability.domain)),
    new Set(['store', 'catalog', 'inventory', 'orders', 'logistics', 'payments', 'account'])
  );
});

test('store awareness is active and writes stay behind official actions', () => {
  const capability = getKyrubiaAwarenessCapability('store');
  assert.equal(capability?.status, 'active');
  assert.equal(capability?.writePath, 'official_action');
  assert.match(capability?.authoritativeSource ?? '', /private store/i);
});

test('payments remain planned until the Payments Foundation is authoritative', () => {
  const capability = getKyrubiaAwarenessCapability('payments');
  assert.equal(capability?.status, 'planned');
  assert.equal(capability?.writePath, 'foundation_pending');
});
