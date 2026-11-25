import { adminDb } from '../firebaseAdmin.js';
import {requireRefundOwnerInTransaction,type RefundOwnerAuthority} from '../identity/refundOwnerAuthorization.js';
import { diagnoseMercadoPagoRefundReadOnly } from './providerRefundReadOnlyDiagnosisService.js';
import { assessFailedPartialRefundObservation } from '../../shared/orderRefundReconciliationEvidence.js';
import { normalizeCanonicalPayment, type CanonicalPayment } from '../../src/utils/canonicalPayment.js';

const validId = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

export interface FailedRefundEvidenceReceipt {
  schemaVersion: 1;
  state: 'observed_no_refund_not_settled';
  storeId: string;
  orderId: string;
  paymentId: string;
  providerPaymentId: string;
  failedAttemptId: string;
  providerAmountMinor: number;
  providerRefundedAmountMinor: 0;
  providerRefundCount: 0;
  providerStatus: string;
  checkedAt: string;
  recordedBy: string;
  paymentRefunded: false;
  creditIssued: false;
}

/**
 * Owner-initiated audit receipt. It never alters the failed refund record,
 * original payment/order, provider, customer balance or refund eligibility.
 * Another fresh provider read is mandatory for any future financial action.
 */
export const recordFailedRefundEvidence = async (input: {
  storeId: string;
  orderId: string;
  ownerId: string;
  authority?:RefundOwnerAuthority;
}): Promise<FailedRefundEvidenceReceipt> => {
  const { storeId, orderId, ownerId } = input;
  if (![storeId, orderId, ownerId].every(validId)) {
    throw new Error('REFUND_EVIDENCE_TARGET_INVALID');
  }
  // Verification happens on the server, not from a client-provided snapshot.
  const live = await diagnoseMercadoPagoRefundReadOnly({storeId, orderId});
  const assessment = assessFailedPartialRefundObservation(live);
  if (!assessment.eligibleToRecordEvidence ||
      live.refundedAmountReportedMinor !== 0 ||
      assessment.remainingFinancialObligationMinor !== live.paymentAmountMinor) {
    throw new Error('REFUND_EVIDENCE_PROVIDER_NOT_CONCLUSIVE');
  }
  const tenant = await adminDb.doc('tenants/' + storeId).get();
  const canonicalStoreId = clean(tenant.get('canonicalStoreId'));
  const roots = validId(canonicalStoreId) && canonicalStoreId !== storeId
    ? [storeId, canonicalStoreId]
    : [storeId];
  const [paymentSnapshots, partialSnapshot] = await Promise.all([
    Promise.all(roots.map(root =>
      adminDb.collection('stores/' + root + '/payments')
        .where('orderId', '==', orderId).limit(2).get()
    )),
    adminDb.collection('stores/' + storeId + '/paymentPartialRefunds')
      .where('orderId', '==', orderId).limit(2).get(),
  ]);
  if (paymentSnapshots.reduce((total, snapshot) => total + snapshot.size, 0) !== 1 ||
      partialSnapshot.size !== 1) {
    throw new Error('REFUND_EVIDENCE_RECORDS_CHANGED');
  }
  const paymentIndex = paymentSnapshots.findIndex(snapshot => !snapshot.empty);
  const paymentDoc = paymentSnapshots[paymentIndex].docs[0];
  const paymentStoreId = roots[paymentIndex];
  let payment: CanonicalPayment;
  try {
    payment = normalizeCanonicalPayment({
      ...(paymentDoc.data() as CanonicalPayment),
      id: paymentDoc.id,
      storeId: paymentStoreId,
    });
  } catch {
    throw new Error('REFUND_EVIDENCE_RECORDS_CHANGED');
  }
  const attempt = partialSnapshot.docs[0];
  const amountMinor = Math.round(payment.amount * 100);
  if (payment.provider !== 'mercado-pago' ||
      payment.status !== 'paid' ||
      payment.orderId !== orderId ||
      !payment.providerPaymentId ||
      !Number.isSafeInteger(amountMinor) ||
      amountMinor !== live.paymentAmountMinor ||
      clean(attempt.get('status')) !== 'failed' ||
      (clean(attempt.get('providerPaymentId')) &&
        clean(attempt.get('providerPaymentId')) !== payment.providerPaymentId) ||
      clean(attempt.get('providerRefundId'))) {
    throw new Error('REFUND_EVIDENCE_RECORDS_CHANGED');
  }
  const orderRef = adminDb.doc('artifacts/' + storeId + '/public/data/customerOrders/' + orderId);
  const paymentRef = adminDb.doc('stores/' + paymentStoreId + '/payments/' + payment.id);
  const attemptRef = adminDb.doc('stores/' + storeId + '/paymentPartialRefunds/' + attempt.id);
  const fullRefundRef = adminDb.doc('stores/' + paymentStoreId + '/paymentRefunds/' + payment.id);
  const evidenceRef = adminDb.doc('stores/' + storeId + '/orderRefundReconciliationEvidence/' + orderId);
  const at = new Date().toISOString();
  return adminDb.runTransaction(async transaction => {
    if(input.authority)await requireRefundOwnerInTransaction(transaction,storeId,input.authority);
    const [orderSnapshot, paymentSnapshot, attemptSnapshot, fullRefundSnapshot, evidenceSnapshot] =
      await Promise.all([
        transaction.get(orderRef),
        transaction.get(paymentRef),
        transaction.get(attemptRef),
        transaction.get(fullRefundRef),
        transaction.get(evidenceRef),
      ]);
    if (!orderSnapshot.exists || orderSnapshot.get('storeId') !== storeId ||
        !['rejected','cancelled'].includes(clean(orderSnapshot.get('status'))) ||
        orderSnapshot.get('paymentStatus') !== 'paid' ||
        !paymentSnapshot.exists || clean(paymentSnapshot.get('status')) !== 'paid' ||
        clean(paymentSnapshot.get('orderId')) !== orderId ||
        clean(paymentSnapshot.get('providerPaymentId')) !== payment.providerPaymentId ||
        Math.round(Number(paymentSnapshot.get('amount')) * 100) !== amountMinor ||
        !attemptSnapshot.exists || clean(attemptSnapshot.get('status')) !== 'failed' ||
        clean(attemptSnapshot.get('providerRefundId')) ||
        fullRefundSnapshot.exists) {
      throw new Error('REFUND_EVIDENCE_RECORDS_CHANGED');
    }
    if (evidenceSnapshot.exists) {
      const prior = evidenceSnapshot.data() as FailedRefundEvidenceReceipt;
      if (prior.schemaVersion !== 1 ||
          prior.state !== 'observed_no_refund_not_settled' ||
          prior.storeId !== storeId ||
          prior.orderId !== orderId ||
          prior.paymentId !== payment.id ||
          prior.failedAttemptId !== attempt.id ||
          prior.providerPaymentId !== payment.providerPaymentId ||
          prior.providerAmountMinor !== amountMinor ||
          prior.providerRefundedAmountMinor !== 0 ||
          prior.providerRefundCount !== 0 ||
          prior.paymentRefunded !== false ||
          prior.creditIssued !== false) {
        throw new Error('REFUND_EVIDENCE_ALREADY_CONFLICTED');
      }
      return prior;
    }
    const result: FailedRefundEvidenceReceipt = {
      schemaVersion: 1,
      state: 'observed_no_refund_not_settled',
      storeId, orderId,
      paymentId: payment.id,
      providerPaymentId: payment.providerPaymentId,
      failedAttemptId: attempt.id,
      providerAmountMinor: amountMinor,
      providerRefundedAmountMinor: 0,
      providerRefundCount: 0,
      providerStatus: live.paymentStatus,
      checkedAt: at,
      recordedBy: ownerId,
      paymentRefunded: false,
      creditIssued: false,
    };
    transaction.create(evidenceRef, result);
    return result;
  });
};
