import assert from 'node:assert/strict';
import test from 'node:test';
import { buildKyrubRefundPlan } from '../server/payments/paymentRefundReconciliation';
import type { KyrubPaymentTransaction } from '../shared/kyrubPaymentAllocations';

const transaction: KyrubPaymentTransaction = {
  schemaVersion: 1,
  transactionId: 'txn-1',
  payerUserId: 'buyer-1',
  purpose: 'order-1',
  currency: 'BRL',
  amountMinor: 10_000,
  allocations: [
    { allocationId: 'merchant', recipientUserId: 'merchant-1', role: 'merchant', amountMinor: 8_500, status: 'pending' },
    { allocationId: 'platform', recipientUserId: 'kyrub', role: 'platform', amountMinor: 1_000, status: 'pending' },
    { allocationId: 'courier', recipientUserId: 'courier-1', role: 'courier', amountMinor: 500, status: 'pending' },
  ],
  correlationId: 'payment-corr',
};

test('full refund reverses the full allocation total without inventing money', () => {
  const plan = buildKyrubRefundPlan({ transaction, refundAmountMinor: 10_000, correlationId: 'refund-1' });
  assert.equal(plan.kind, 'full');
  assert.equal(plan.allocations.reduce((sum, item) => sum + item.refundAmountMinor, 0), 10_000);
  assert.deepEqual(plan.allocations.map(item => item.refundAmountMinor), [8_500, 1_000, 500]);
});

test('partial refund is deterministic and preserves exact cent total after rounding', () => {
  const plan = buildKyrubRefundPlan({ transaction, refundAmountMinor: 3_333, correlationId: 'refund-2' });
  assert.equal(plan.kind, 'partial');
  assert.equal(plan.allocations.reduce((sum, item) => sum + item.refundAmountMinor, 0), 3_333);
});

test('refund cannot exceed the original payment', () => {
  assert.throws(
    () => buildKyrubRefundPlan({ transaction, refundAmountMinor: 10_001, correlationId: 'refund-3' }),
    /REFUND_EXCEEDS_PAYMENT/
  );
});
