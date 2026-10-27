import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mayApplyNinetyNineFoodInboundStatus } from '../server/inventory/ninetyNineFoodInboundStatusAuthorityService';

describe('99Food inbound KDS payment gate', () => {
  it('blocks preparation and fulfillment without confirmed payment', () => {
    for (const status of ['preparing', 'ready', 'out_for_delivery', 'completed'] as const) {
      assert.equal(mayApplyNinetyNineFoodInboundStatus(status, 'unpaid'), false);
      assert.equal(mayApplyNinetyNineFoodInboundStatus(status, 'partial'), false);
      assert.equal(mayApplyNinetyNineFoodInboundStatus(status, undefined), false);
      assert.equal(mayApplyNinetyNineFoodInboundStatus(status, 'paid'), true);
    }
  });
  it('preserves acceptance and cancellation independently of payment', () => {
    assert.equal(mayApplyNinetyNineFoodInboundStatus('accepted', 'unpaid'), true);
    assert.equal(mayApplyNinetyNineFoodInboundStatus('cancelled', 'unpaid'), true);
    assert.equal(mayApplyNinetyNineFoodInboundStatus('rejected', 'unpaid'), true);
  });
  it('does not apply informational events without mapped status', () => {
    assert.equal(mayApplyNinetyNineFoodInboundStatus(null, 'paid'), false);
  });
});
