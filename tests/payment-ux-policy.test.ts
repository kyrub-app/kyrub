import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  canExposeMarketplaceOrderToKds,
  deriveCanonicalPaymentUxPolicy,
  derivePaymentIntentUxPolicy,
} from '../src/utils/paymentUxPolicy';

describe('payment UX and KDS policy', () => {
  test('keeps a pending Pix intent outside the operational order and KDS', () => {
    const policy = derivePaymentIntentUxPolicy({ status: 'pending', method: 'pix' });

    assert.equal(policy.state, 'awaiting_payment');
    assert.equal(policy.canMaterializeOrder, false);
    assert.equal(policy.canReleaseToKds, false);
    assert.equal(policy.canRetryPayment, false);
    assert.equal(policy.shouldShowPixPaymentInstructions, true);
    assert.equal(canExposeMarketplaceOrderToKds('pending'), false);
  });

  test('releases marketplace order only after authoritative paid intent', () => {
    const policy = derivePaymentIntentUxPolicy({ status: 'paid', method: 'pix' });

    assert.equal(policy.state, 'payment_confirmed');
    assert.equal(policy.canMaterializeOrder, true);
    assert.equal(policy.canReleaseToKds, true);
    assert.equal(policy.canRequestRefund, true);
    assert.equal(canExposeMarketplaceOrderToKds('paid'), true);
  });

  test('failed and expired intents are retryable but never reach KDS', () => {
    for (const status of ['failed', 'expired'] as const) {
      const policy = derivePaymentIntentUxPolicy({ status, method: 'pix' });
      assert.equal(policy.canMaterializeOrder, false);
      assert.equal(policy.canReleaseToKds, false);
      assert.equal(policy.canRetryPayment, true);
      assert.equal(canExposeMarketplaceOrderToKds(status), false);
    }
  });

  test('refund states never emit a fresh KDS release signal', () => {
    for (const status of [
      'refund_requested',
      'refund_processing',
      'refunded',
      'refund_failed',
    ] as const) {
      const policy = deriveCanonicalPaymentUxPolicy(status);
      assert.equal(policy.canMaterializeOrder, false);
      assert.equal(policy.canReleaseToKds, false);
    }
  });

  test('failed refund can be requested again without retrying the original payment', () => {
    const policy = deriveCanonicalPaymentUxPolicy('refund_failed');

    assert.equal(policy.state, 'refund_failed');
    assert.equal(policy.canRequestRefund, true);
    assert.equal(policy.canRetryPayment, false);
  });
});
