import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mayApplyNinetyNineFoodInboundStatus, mayTransitionNinetyNineFoodTerminalOrder } from '../server/inventory/ninetyNineFoodInboundStatusAuthorityService';

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
  it('does not apply informational events without mapped status', () => {
    assert.equal(mayApplyNinetyNineFoodInboundStatus(null, 'paid'), false);
  });
});
