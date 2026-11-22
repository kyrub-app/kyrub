import { adminDb } from '../firebaseAdmin.js';
import type { CanonicalPayment } from '../../src/utils/canonicalPayment.js';
import { diagnoseMercadoPagoRefundReadOnly } from './providerRefundReadOnlyDiagnosisService.js';
import type { FailedRefundEvidenceReceipt } from './failedRefundEvidenceService.js';

export type PartialRefundGuard = {
  roots: string[];
  mode: 'no_partial_history' | 'audited_failed_attempt';
  failedAttemptId: string;
};

const minor = (amount: number): number => Math.round(amount * 100);
const clean = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

/**
 * A consultation is not financial settlement. A legacy failed partial may
 * be used ONLY after the separately recorded, owner-authorized provider
 * evidence is rechecked by a fresh read of Mercado Pago.
 *
 * IMPORTANT: this guard does not authorize refunds or issue store credits.
 * The existing full-refund safety guard remains unchanged.
 */
export const inspectOrderCreditInterestRefundSafety = async (input: {
  legacyStoreId: string;
  orderId: string;
  payment: CanonicalPayment;
  /** Test-only verifier seam; HTTP routes always use the live provider reader. */
  diagnoseProvider?: typeof diagnoseMercadoPagoRefundReadOnly;
}): Promise<PartialRefundGuard> => {
  const { legacyStoreId, orderId, payment } = input;
  const roots = [...new Set([legacyStoreId, payment.storeId])];
  const [fullRefund, snapshots] = await Promise.all([
    adminDb.doc('stores/' + payment.storeId + '/paymentRefunds/' + payment.id).get(),
    Promise.all(roots.map(root => adminDb.collection('stores/' + root + '/paymentPartialRefunds')
      .where('orderId', '==', orderId).limit(51).get())),
  ]);
  if (fullRefund.exists || snapshots.some(snapshot => snapshot.size > 50)) {
    throw new Error('CREDIT_INTEREST_REFUND_UNRESOLVED');
  }
  const partials = snapshots.flatMap((snapshot, index) =>
    snapshot.docs.map(doc => ({ storeId: roots[index], doc })));
  if (partials.length === 0) {
    return { roots, mode: 'no_partial_history', failedAttemptId: '' };
  }
  if (partials.length !== 1 || partials[0].storeId !== legacyStoreId ||
      clean(partials[0].doc.get('status')) !== 'failed' ||
      clean(partials[0].doc.get('providerRefundId')) ||
      (clean(partials[0].doc.get('providerPaymentId')) &&
       clean(partials[0].doc.get('providerPaymentId')) !== payment.providerPaymentId)) {
    throw new Error('CREDIT_INTEREST_REFUND_UNRESOLVED');
  }
  const attemptId = partials[0].doc.id;
  const evidence = (await adminDb.doc(
    'stores/' + legacyStoreId + '/orderRefundReconciliationEvidence/' + orderId
  ).get()).data() as FailedRefundEvidenceReceipt | undefined;
  if (!evidence || evidence.schemaVersion !== 1 ||
      evidence.state !== 'observed_no_refund_not_settled' ||
      evidence.storeId !== legacyStoreId ||
      evidence.orderId !== orderId ||
      evidence.paymentId !== payment.id ||
      evidence.providerPaymentId !== payment.providerPaymentId ||
      evidence.failedAttemptId !== attemptId ||
      evidence.providerAmountMinor !== minor(payment.amount) ||
      evidence.providerRefundedAmountMinor !== 0 ||
      evidence.providerRefundCount !== 0 ||
      evidence.paymentRefunded !== false ||
      evidence.creditIssued !== false) {
    throw new Error('CREDIT_INTEREST_REFUND_EVIDENCE_REQUIRED');
  }
  // The receipt describes an earlier moment. Only a fresh provider GET can
  // establish that its statement is still consistent for this consultation.
  const live = await (input.diagnoseProvider ?? diagnoseMercadoPagoRefundReadOnly)({
    storeId: legacyStoreId, orderId,
  });
  if (live.assessment.state !== 'verified_zero_refund_observation' ||
      live.assessment.eligibleToRecordEvidence !== true ||
      live.paymentAmountMinor !== evidence.providerAmountMinor ||
      live.refundedAmountReportedMinor !== 0) {
    throw new Error('CREDIT_INTEREST_PROVIDER_NOT_CONCLUSIVE');
  }
  return { roots, mode: 'audited_failed_attempt', failedAttemptId: attemptId };
};
