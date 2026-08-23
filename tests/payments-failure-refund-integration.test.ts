import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ALL_PAYMENT_FAILURE_SCENARIOS, decidePaymentFailure } from '../src/utils/paymentFailurePolicy';
import { canTransitionPaymentStatus } from '../src/utils/canonicalPayment';
import { buildKyrubRefundPlan } from '../server/payments/paymentRefundReconciliation';
import { buildCourierObligations, buildSettlementInstructions } from '../server/payments/settlementAdapter';
import type { KyrubPaymentTransaction } from '../shared/kyrubPaymentAllocations';

const transaction: KyrubPaymentTransaction = {
  schemaVersion: 1,
  transactionId: 'txn-e2e-1',
  payerUserId: 'buyer-1',
  purpose: 'order-xburger',
  currency: 'BRL',
  amountMinor: 10_000,
  correlationId: 'corr-e2e-1',
  allocations: [
    { allocationId: 'merchant', recipientUserId: 'merchant-1', role: 'merchant', amountMinor: 8_500, status: 'locked' },
    { allocationId: 'courier', recipientUserId: 'courier-1', role: 'courier', amountMinor: 1_000, status: 'pending' },
    { allocationId: 'platform', recipientUserId: 'kyrub', role: 'platform', amountMinor: 500, status: 'pending' },
  ],
};

test('all official failure scenarios remain fail-closed and never synthesize paid', () => {
  for (const scenario of ALL_PAYMENT_FAILURE_SCENARIOS) {
    const decision = decidePaymentFailure(scenario);
    assert.equal(decision.mayMarkPaid, false, scenario);
  }
  assert.equal(canTransitionPaymentStatus('expired', 'paid'), false);
  assert.equal(canTransitionPaymentStatus('failed', 'paid'), false);
});

test('failure processor boundary is authoritative, idempotent and server-owned', () => {
  const source = readFileSync('server/payments/paymentWebhookProcessor.ts', 'utf8');
  assert.match(source, /runTransaction/);
  assert.match(source, /eventSnapshot\.exists/);
  assert.match(source, /buildPaymentWebhookIdempotencyKey/);
  assert.match(source, /assertPaymentStatusTransition/);
  assert.match(source, /paymentStatusFromProviderEvent/);
  assert.doesNotMatch(source, /request\.body\.paid|clientPaid|frontendPaid/);
});

test('partial refund reconciles allocations exactly and keeps courier obligation explicit', () => {
  const refund = buildKyrubRefundPlan({ transaction, refundAmountMinor: 3_333, correlationId: 'refund-partial' });
  assert.equal(refund.kind, 'partial');
  assert.equal(refund.allocations.reduce((sum, item) => sum + item.refundAmountMinor, 0), 3_333);
  const obligations = buildCourierObligations(transaction);
  assert.equal(obligations.length, 1);
  assert.equal(obligations[0].status, 'owed');
});

test('full refund reverses the entire allocation basis without creating settlement authority', () => {
  const refund = buildKyrubRefundPlan({ transaction, refundAmountMinor: 10_000, correlationId: 'refund-full' });
  assert.equal(refund.kind, 'full');
  assert.equal(refund.allocations.reduce((sum, item) => sum + item.refundAmountMinor, 0), transaction.amountMinor);
  const settlement = buildSettlementInstructions({ transaction, rail: 'manual_external' });
  assert.equal(settlement.every(item => item.status === 'planned'), true);
  assert.equal(transaction.allocations.some(item => item.status === 'settled'), false);
});

test('refund cannot exceed payment and cannot silently settle recipients', () => {
  assert.throws(() => buildKyrubRefundPlan({ transaction, refundAmountMinor: 10_001, correlationId: 'refund-too-large' }), /REFUND_EXCEEDS_PAYMENT/);
  const settlement = buildSettlementInstructions({ transaction, rail: 'mercado_pago_1_1' });
  assert.equal(settlement.some(item => item.status === 'settled'), false);
});
