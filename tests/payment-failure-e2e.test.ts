import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ALL_PAYMENT_FAILURE_SCENARIOS,
  decidePaymentFailure,
} from '../src/utils/paymentFailurePolicy';
import {
  canTransitionPaymentStatus,
  isPaymentAuthoritativelyPaid,
} from '../src/utils/canonicalPayment';

test('the official Failure E2E matrix contains every checklist scenario', () => {
  assert.deepEqual(ALL_PAYMENT_FAILURE_SCENARIOS, [
    'pix_expired',
    'payment_cancelled',
    'provider_timeout',
    'duplicate_webhook',
    'delayed_webhook',
    'out_of_order_webhook',
    'webhook_replay',
    'provider_unavailable',
    'unknown_provider_response',
  ]);
});

test('no failure disposition can mark a payment paid', () => {
  for (const scenario of ALL_PAYMENT_FAILURE_SCENARIOS) {
    assert.equal(decidePaymentFailure(scenario).mayMarkPaid, false, scenario);
  }
});

test('expired and cancelled payments have terminal fail-closed transitions', () => {
  const expired = decidePaymentFailure('pix_expired');
  const cancelled = decidePaymentFailure('payment_cancelled');
  assert.equal(expired.targetStatus, 'expired');
  assert.equal(cancelled.targetStatus, 'failed');
  assert.equal(canTransitionPaymentStatus('pending', expired.targetStatus!), true);
  assert.equal(canTransitionPaymentStatus('pending', cancelled.targetStatus!), true);
  assert.equal(isPaymentAuthoritativelyPaid(expired.targetStatus!), false);
  assert.equal(isPaymentAuthoritativelyPaid(cancelled.targetStatus!), false);
});

test('timeouts and PSP outages preserve current payment state and are retryable', () => {
  for (const scenario of ['provider_timeout', 'provider_unavailable'] as const) {
    const decision = decidePaymentFailure(scenario);
    assert.equal(decision.disposition, 'keep_current_retryable');
    assert.equal(decision.retryable, true);
    assert.equal(decision.targetStatus, undefined);
  }
});

test('duplicates, stale/out-of-order events, replay and unknown responses fail closed', () => {
  assert.equal(decidePaymentFailure('duplicate_webhook').disposition, 'idempotent_noop');
  assert.equal(decidePaymentFailure('delayed_webhook').disposition, 'reject_stale_event');
  assert.equal(decidePaymentFailure('out_of_order_webhook').disposition, 'reject_stale_event');
  assert.equal(decidePaymentFailure('webhook_replay').disposition, 'reject_unverified_or_unknown');
  assert.equal(decidePaymentFailure('unknown_provider_response').disposition, 'reject_unverified_or_unknown');
});

test('terminal failure states cannot later become paid through canonical transitions', () => {
  assert.equal(canTransitionPaymentStatus('expired', 'paid'), false);
  assert.equal(canTransitionPaymentStatus('failed', 'paid'), false);
});
