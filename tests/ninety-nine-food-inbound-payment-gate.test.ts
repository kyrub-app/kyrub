import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mayApplyNinetyNineFoodInboundStatus, mayTransitionNinetyNineFoodTerminalOrder, mayAdvanceNinetyNineFoodFulfillment, resolveNinetyNineFoodPayOnDelivery } from '../server/inventory/ninetyNineFoodInboundStatusAuthorityService';

describe('99Food inbound KDS payment gate', () => {
  it('blocks preparation and fulfillment without confirmed payment', () => {
    for (const status of ['preparing', 'ready', 'out_for_delivery', 'completed'] as const) {
      assert.equal(mayApplyNinetyNineFoodInboundStatus(status, 'unpaid'), false);
      assert.equal(mayApplyNinetyNineFoodInboundStatus(status, 'partial'), false);
      assert.equal(mayApplyNinetyNineFoodInboundStatus(status, undefined), false);
      assert.equal(mayApplyNinetyNineFoodInboundStatus(status, 'paid'), true);
    }
  });
  it('allows explicitly identified pay-on-delivery production without recording payment', () => {
    assert.equal(mayApplyNinetyNineFoodInboundStatus('preparing', 'unpaid', true), true);
    assert.equal(mayApplyNinetyNineFoodInboundStatus('ready', 'unpaid', true), true);
    assert.equal(mayApplyNinetyNineFoodInboundStatus('preparing', 'unpaid', false), false);
  });
  it('preserves acceptance and cancellation independently of payment', () => {
    assert.equal(mayApplyNinetyNineFoodInboundStatus('accepted', 'unpaid'), true);
    assert.equal(mayApplyNinetyNineFoodInboundStatus('cancelled', 'unpaid'), true);
    assert.equal(mayApplyNinetyNineFoodInboundStatus('rejected', 'unpaid'), true);
  });
  it('does not revive cancelled, rejected, or completed orders with stale provider events', () => {
    for (const terminal of ['cancelled', 'rejected', 'completed'] as const) {
      assert.equal(mayTransitionNinetyNineFoodTerminalOrder(terminal, 'preparing'), false);
      assert.equal(mayTransitionNinetyNineFoodTerminalOrder(terminal, 'accepted'), false);
      assert.equal(mayTransitionNinetyNineFoodTerminalOrder(terminal, terminal), true);
    }
    assert.equal(mayTransitionNinetyNineFoodTerminalOrder('accepted', 'preparing'), true);
    assert.equal(mayTransitionNinetyNineFoodTerminalOrder('pending', 'cancelled'), true);
  });
  it('does not roll back fulfillment on delayed acceptance', () => {
    for (const current of ['preparing', 'ready', 'out_for_delivery'] as const) {
      assert.equal(mayAdvanceNinetyNineFoodFulfillment(current, 'accepted'), false);
    }
    assert.equal(mayAdvanceNinetyNineFoodFulfillment('pending', 'accepted'), true);
    assert.equal(mayAdvanceNinetyNineFoodFulfillment('preparing', 'ready'), true);
  });
  it('preserves payment gate and terminal authority through a replayed event sequence', () => {
    type Stage = 'pending' | 'accepted' | 'preparing' | 'ready' | 'completed' | 'cancelled';
    let stage: Stage = 'pending';
    let payment: 'unpaid' | 'paid' = 'unpaid';
    const event = (incoming: Stage) => {
      const allowed = mayTransitionNinetyNineFoodTerminalOrder(stage, incoming) &&
        mayAdvanceNinetyNineFoodFulfillment(stage, incoming) &&
        mayApplyNinetyNineFoodInboundStatus(incoming, payment);
      if (allowed) stage = incoming;
      return allowed;
    };
    assert.equal(event('accepted'), true);
    assert.equal(event('preparing'), false);
    assert.equal(stage, 'accepted');
    payment = 'paid';
    assert.equal(event('preparing'), true);
    assert.equal(event('accepted'), false);
    assert.equal(event('ready'), true);
    assert.equal(event('completed'), true);
    assert.equal(event('preparing'), false);
    assert.equal(event('cancelled'), false);
    assert.equal(stage, 'completed');
  });
  it('allows pay-on-delivery preparation but not false paid settlement', () => {
    const paymentStatus = 'unpaid';
    assert.equal(mayApplyNinetyNineFoodInboundStatus('preparing', paymentStatus, true), true);
    assert.equal(paymentStatus, 'unpaid');
  });
  it('rejects replayed earlier fulfillment stages without blocking cancellation', () => {
    assert.equal(mayAdvanceNinetyNineFoodFulfillment('accepted', 'pending'), false);
    assert.equal(mayAdvanceNinetyNineFoodFulfillment('preparing', 'pending'), false);
    assert.equal(mayAdvanceNinetyNineFoodFulfillment('pending', 'accepted'), true);
    assert.equal(mayAdvanceNinetyNineFoodFulfillment('ready', 'preparing'), false);
    assert.equal(mayAdvanceNinetyNineFoodFulfillment('out_for_delivery', 'ready'), false);
    assert.equal(mayAdvanceNinetyNineFoodFulfillment('preparing', 'accepted'), false);
    assert.equal(mayAdvanceNinetyNineFoodFulfillment('ready', 'ready'), true);
    assert.equal(mayAdvanceNinetyNineFoodFulfillment('preparing', 'out_for_delivery'), true);
    assert.equal(mayAdvanceNinetyNineFoodFulfillment('ready', 'cancelled'), true);
  });
  it('revokes stale pay-on-delivery permission when fresh provider details disagree', () => {
    assert.equal(resolveNinetyNineFoodPayOnDelivery(
      { payOnDelivery: false }, { payOnDelivery: true }, true
    ), false);
    assert.equal(resolveNinetyNineFoodPayOnDelivery(
      { payOnDelivery: true }, { payOnDelivery: false }, false
    ), true);
    assert.equal(resolveNinetyNineFoodPayOnDelivery(
      undefined, { payOnDelivery: true }, false
    ), true);
    assert.equal(resolveNinetyNineFoodPayOnDelivery(
      undefined, {}, true
    ), true);
  });
  it('does not apply informational events without mapped status', () => {
    assert.equal(mayApplyNinetyNineFoodInboundStatus(null, 'paid'), false);
  });
});
