import assert from 'node:assert/strict';
import { test } from 'node:test';
import { adminDb } from '../server/firebaseAdmin.js';
import { diagnoseOrderRefundReadOnly } from '../server/payments/orderRefundReadOnlyDiagnosis.js';

if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')) {
  throw new Error('LOCAL_FIRESTORE_EMULATOR_REQUIRED');
}

test('read-only check explains R$0 operational order and unresolved partial history without changing payment', async () => {
  const storeId = 'refund_diagnosis_erp';
  const canonicalStoreId = 'refund_diagnosis_canonical';
  const orderId = 'refund_diagnosis_cancelled';
  const order = adminDb.doc('artifacts/' + storeId + '/public/data/customerOrders/' + orderId);
  const payment = adminDb.doc('stores/' + canonicalStoreId + '/payments/refund_diagnosis_payment');
  const partial = adminDb.doc('stores/' + storeId + '/paymentPartialRefunds/refund_diagnosis_partial');
  await Promise.all([
    adminDb.doc('tenants/' + storeId).set({ canonicalStoreId }),
    order.set({ id: orderId, storeId, status: 'rejected', paymentStatus: 'paid',
      refundStatus: 'required', total: 0, buyerName: 'teste sem PII' }),
    payment.set({ orderId, amount: 30.01, provider: 'mercado-pago', status: 'paid' }),
    partial.set({ orderId, amount: 7.5, status: 'required' }),
  ]);
  const first = await diagnoseOrderRefundReadOnly({ storeId, orderId });
  assert.equal(first.source, 'firestore_read_only');
  assert.equal(first.order.status, 'rejected');
  assert.equal(first.order.operationalTotalMinor, null);
  assert.equal(first.payments.count, 1);
  assert.deepEqual(first.payments.records, [{
    scope: 'canonical', status: 'paid', provider: 'mercado-pago', amountMinor: 3001,
  }]);
  assert.equal(first.partialRefunds.unresolvedCount, 1);
  assert.equal(first.partialRefunds.statusCounts.required, 1);
  assert.ok(first.blockers.includes('valor_operacional_ausente'));
  assert.ok(first.blockers.includes('historico_parcial_incerto'));
  assert.deepEqual(await diagnoseOrderRefundReadOnly({ storeId, orderId }), first);
  assert.equal((await payment.get()).get('status'), 'paid');
  assert.equal((await order.get()).get('refundStatus'), 'required');
  assert.equal((await partial.get()).get('status'), 'required');
});

test('history confirmed as partially refunded is not described as full-refund eligibility', async () => {
  const storeId = 'refund_diagnosis_erp_two';
  const orderId = 'refund_diagnosis_second';
  await Promise.all([
    adminDb.doc('artifacts/' + storeId + '/public/data/customerOrders/' + orderId).set({
      id: orderId, storeId, status: 'cancelled', paymentStatus: 'paid', total: 25,
    }),
    adminDb.doc('stores/' + storeId + '/payments/refund_diag_payment_2').set({
      orderId, amount: 25, provider: 'mercado-pago', status: 'paid',
    }),
    adminDb.doc('stores/' + storeId + '/paymentPartialRefunds/refund_diag_partial_2').set({
      orderId, amount: 5.01, status: 'refunded',
    }),
  ]);
  const result = await diagnoseOrderRefundReadOnly({storeId, orderId});
  assert.equal(result.partialRefunds.confirmedCount, 1);
  assert.equal(result.partialRefunds.confirmedAmountMinor, 501);
  assert.equal(result.partialRefunds.unresolvedCount, 0);
  assert.ok(result.blockers.includes('reembolso_parcial_confirmado_exige_residual'));
});
