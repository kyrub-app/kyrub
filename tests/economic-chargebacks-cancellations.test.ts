import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  canTransitionPaymentStatus,
  isPaymentAuthoritativelyPaid,
  isPaymentTerminal,
} from '../src/utils/canonicalPayment';
import { paymentStatusFromProviderEvent } from '../src/utils/paymentProvider';

describe('economic chargebacks and cancellations', () => {
  test('pending payment can be cancelled without pretending it was refunded', () => {
    assert.equal(canTransitionPaymentStatus('pending', 'cancelled'), true);
    assert.equal(canTransitionPaymentStatus('paid', 'cancelled'), false);
    assert.equal(isPaymentTerminal('cancelled'), true);
    assert.equal(paymentStatusFromProviderEvent('payment.cancelled'), 'cancelled');
  });

  test('chargeback has its own lifecycle distinct from refund', () => {
    assert.equal(canTransitionPaymentStatus('paid', 'charged_back'), true);
    assert.equal(canTransitionPaymentStatus('charged_back', 'chargeback_reversed'), true);
    assert.equal(paymentStatusFromProviderEvent('chargeback.debited'), 'charged_back');
    assert.equal(paymentStatusFromProviderEvent('chargeback.reversed'), 'chargeback_reversed');
  });

  test('a reversed chargeback restores authoritative paid economics without rewriting history', () => {
    assert.equal(isPaymentAuthoritativelyPaid('charged_back'), false);
    assert.equal(isPaymentAuthoritativelyPaid('chargeback_reversed'), true);
    assert.equal(isPaymentTerminal('charged_back'), false);
  });

  test('refund and chargeback routes cannot be conflated from terminal refund state', () => {
    assert.equal(canTransitionPaymentStatus('refunded', 'charged_back'), false);
    assert.equal(canTransitionPaymentStatus('charged_back', 'refunded'), false);
  });
});
