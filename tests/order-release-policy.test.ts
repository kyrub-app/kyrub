import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { resolveOrderReleaseDecision } from '../shared/orderReleasePolicy';

describe('order release decision (no side effects)', () => {
  test('pending approval never exposes payment or fulfillment', () => {
    assert.deepEqual(resolveOrderReleaseDecision({
      mode: 'pay_before_fulfillment', approval: 'pending',
      settlement: 'paid', paymentVerifiedByServer: true,
    }), { paymentAvailable: false, fulfillmentAuthorized: false, reason: 'pending_approval' });
  });

  test('approved open tab permits fulfillment before settlement', () => {
    assert.deepEqual(resolveOrderReleaseDecision({
      mode: 'open_tab', approval: 'approved',
      settlement: 'unpaid', paymentVerifiedByServer: false,
    }), { paymentAvailable: true, fulfillmentAuthorized: true, reason: 'open_tab_approved' });
  });

  test('approved prepaid order awaits verified full payment', () => {
    for (const settlement of ['unpaid', 'partial', 'paid'] as const) {
      const result = resolveOrderReleaseDecision({
        mode: 'pay_before_fulfillment', approval: 'approved',
        settlement, paymentVerifiedByServer: false,
      });
      assert.equal(result.fulfillmentAuthorized, false);
      assert.equal(result.paymentAvailable, true);
    }
  });

  test('verified full payment releases approved prepaid order', () => {
    const result = resolveOrderReleaseDecision({
      mode: 'pay_before_fulfillment', approval: 'approved',
      settlement: 'paid', paymentVerifiedByServer: true,
    });
    assert.equal(result.fulfillmentAuthorized, true);
    assert.equal(result.paymentAvailable, false);
  });

  test('rejection and cancellation override even verified payment', () => {
    for (const input of [
      { approval: 'rejected' as const, orderCancelled: false },
      { approval: 'approved' as const, orderCancelled: true },
    ]) {
      const result = resolveOrderReleaseDecision({
        mode: 'pay_before_fulfillment', settlement: 'paid',
        paymentVerifiedByServer: true, ...input,
      });
      assert.equal(result.fulfillmentAuthorized, false);
      assert.equal(result.paymentAvailable, false);
    }
  });
});
