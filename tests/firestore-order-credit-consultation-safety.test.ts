import assert from 'node:assert/strict';
import { test } from 'node:test';
import { adminDb } from '../server/firebaseAdmin.js';
import { inspectOrderCreditInterestRefundSafety } from '../server/payments/orderCreditInterestRefundGuard.js';
import { isCreditInterestRefundStatusEligible } from '../server/payments/orderCreditInterestService.js';
import type { CanonicalPayment } from '../src/utils/canonicalPayment.js';

if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? '')) {
  throw new Error('LOCAL_FIRESTORE_EMULATOR_REQUIRED');
}

const paymentFor = (storeId: string, orderId: string): CanonicalPayment => ({
  id: 'pay_for_order', storeId, orderId, buyerId: 'demo_buyer',
  paymentIntentId: 'intent_demo', amount: 23.30, currency: 'BRL',
  context: 'marketplace', method: 'pix', status: 'paid',
  provider: 'mercado-pago', providerPaymentId: 'mp_approved_2330',
  idempotencyKey: 'payment_idempotency', createdAt: '2026-11-22T16:00:00.000Z',
  updatedAt: '2026-11-22T16:01:00.000Z', paidAt: '2026-11-22T16:01:00.000Z',
  refundedAt: '',
});

const provider = async () => ({
  source: 'mercado_pago_read_only' as const,
  paymentStatus: 'approved',
  paymentAmountMinor: 2330,
  storedPaymentAmountMinor: 2330,
  amountMatches: true,
  refundedAmountReportedMinor: 0,
  refunds: {
    refundCount: 0, approvedRefundCount: 0,
    approvedAmountMinor: 0, uncertainRefundCount: 0, statuses: {},
  },
  partialAttempt: {count: 1, statusCounts: {failed: 1}},
  blockers: ['failed_partial_still_requires_reconciliation'],
  assessment: {
    state: 'verified_zero_refund_observation' as const,
    eligibleToRecordEvidence: true,
    remainingFinancialObligationMinor: 2330,
    message: 'Verified read for test',
  },
  residual: {state:'review_required' as const,remainingMinor:null,reason:'local_history_uncertain',executionEnabled:false as const},
  notice: 'GET only',
});

test('a clean payment may be consulted but no credit is issued', async () => {
  const payment = paymentFor('consult_clean_owner', 'consult_clean_order');
  const result = await inspectOrderCreditInterestRefundSafety({
    legacyStoreId: payment.storeId, orderId: payment.orderId, payment,
    diagnoseProvider: async () => { throw new Error('Provider must not be queried for empty history'); },
  });
  assert.equal(result.mode, 'no_partial_history');
  assert.deepEqual(result.roots, [payment.storeId]);
  assert.equal(result.failedAttemptId, '');
});

test('a failed partial requires recorded evidence and a fresh conclusive provider GET', async () => {
  const storeId = 'consult_audited_owner';
  const orderId = 'consult_audited_order';
  const payment = paymentFor(storeId, orderId);
  const failed = adminDb.doc('stores/' + storeId + '/paymentPartialRefunds/attempt_failed');
  const evidence = adminDb.doc('stores/' + storeId + '/orderRefundReconciliationEvidence/' + orderId);
  await failed.set({
    orderId, status: 'failed', providerPaymentId: payment.providerPaymentId,
    amount: 5, providerRefundId: '',
  });
  await assert.rejects(inspectOrderCreditInterestRefundSafety({
    legacyStoreId: storeId, orderId, payment, diagnoseProvider: provider,
  }), /CREDIT_INTEREST_REFUND_EVIDENCE_REQUIRED/);
  await evidence.set({
    schemaVersion: 1, state: 'observed_no_refund_not_settled',
    storeId, orderId, paymentId: payment.id,
    providerPaymentId: payment.providerPaymentId,
    failedAttemptId: failed.id,
    providerAmountMinor: 2330, providerRefundedAmountMinor: 0,
    providerRefundCount: 0, paymentRefunded: false, creditIssued: false,
  });
  const verified = await inspectOrderCreditInterestRefundSafety({
    legacyStoreId: storeId, orderId, payment, diagnoseProvider: provider,
  });
  assert.equal(verified.mode, 'audited_failed_attempt');
  assert.equal(verified.failedAttemptId, failed.id);
  assert.equal((await failed.get()).get('status'), 'failed');
  await assert.rejects(inspectOrderCreditInterestRefundSafety({
    legacyStoreId: storeId, orderId, payment,
    diagnoseProvider: async () => ({
      ...await provider(),
      refundedAmountReportedMinor: null,
      assessment: {
        state: 'provider_no_refund_listed_but_incomplete',
        eligibleToRecordEvidence: false,
        remainingFinancialObligationMinor: null,
        message: 'Incomplete',
      },
    }),
  }), /CREDIT_INTEREST_PROVIDER_NOT_CONCLUSIVE/);

  await adminDb.doc('stores/' + storeId + '/paymentRefunds/' + payment.id).set({
    orderId, status: 'requested',
  });
  await assert.rejects(inspectOrderCreditInterestRefundSafety({
    legacyStoreId: storeId, orderId, payment, diagnoseProvider: provider,
  }), /CREDIT_INTEREST_REFUND_UNRESOLVED/);
});

test('a locally confirmed partial refund is never eligible for full principal consultation', async () => {
  const storeId = 'consult_partial_paid_owner';
  const orderId = 'consult_partial_paid_order';
  const payment = paymentFor(storeId, orderId);
  await adminDb.doc('stores/' + storeId + '/paymentPartialRefunds/attempt_refunded').set({
    orderId, status: 'refunded', amount: 2, providerRefundId: 'mp_refunded_2',
  });
  await assert.rejects(inspectOrderCreditInterestRefundSafety({
    legacyStoreId: storeId, orderId, payment,
    diagnoseProvider: async () => {throw new Error('Should not call provider');},
  }), /CREDIT_INTEREST_REFUND_UNRESOLVED/);
});


test('failed refund status permits consultation only after audited failed-partial evidence', () => {
  for (const mode of ['no_partial_history', 'audited_failed_attempt'] as const) {
    assert.equal(isCreditInterestRefundStatusEligible('required', mode), true);
    assert.equal(isCreditInterestRefundStatusEligible('', mode), true);
    for (const status of ['refunded', 'processing', 'refund_processing', 'requested', 'not_required']) {
      assert.equal(isCreditInterestRefundStatusEligible(status, mode), false, status + ' / ' + mode);
    }
  }
  assert.equal(isCreditInterestRefundStatusEligible('failed', 'no_partial_history'), false);
  assert.equal(isCreditInterestRefundStatusEligible('failed', 'audited_failed_attempt'), true);
  assert.equal(isCreditInterestRefundStatusEligible(null, 'no_partial_history'), true);
});
