/**
 * Conservative evidence assessment: a recorded failed refund attempt is not
 * by itself proof of no refund, but a live verified provider read can establish
 * a point-in-time no-refund observation. This does NOT clear the refund gate.
 */
export interface ProviderRefundObservation {
  paymentStatus: string;
  paymentAmountMinor: number;
  storedPaymentAmountMinor: number;
  amountMatches: boolean;
  refundedAmountReportedMinor: number | null;
  refunds: {
    refundCount: number;
    approvedRefundCount: number;
    approvedAmountMinor: number;
    uncertainRefundCount: number;
  };
  partialAttempt: {
    count: number;
    statusCounts: Record<string, number>;
  };
  blockers: string[];
}

export type FailedPartialRefundAssessment = {
  state: 'verified_zero_refund_observation' | 'provider_no_refund_listed_but_incomplete' | 'requires_manual_reconciliation';
  eligibleToRecordEvidence: boolean;
  remainingFinancialObligationMinor: number | null;
  message: string;
};

export const assessFailedPartialRefundObservation = (
  value: ProviderRefundObservation
): FailedPartialRefundAssessment => {
  const exactOneFailed = value.partialAttempt.count === 1 &&
    value.partialAttempt.statusCounts.failed === 1 &&
    Object.entries(value.partialAttempt.statusCounts)
      .every(([status, count]) => status === 'failed' && count === 1);
  const noListedRefunds = value.refunds.refundCount === 0 &&
    value.refunds.approvedRefundCount === 0 &&
    value.refunds.approvedAmountMinor === 0 &&
    value.refunds.uncertainRefundCount === 0;
  const validPayment =
    (value.paymentStatus === 'approved' || value.paymentStatus === 'paid') &&
    value.amountMatches === true &&
    Number.isSafeInteger(value.paymentAmountMinor) &&
    value.paymentAmountMinor > 0 &&
    value.paymentAmountMinor === value.storedPaymentAmountMinor;
  const safeBlockers = value.blockers.length === 1 &&
    value.blockers[0] === 'failed_partial_still_requires_reconciliation';

  if (validPayment && noListedRefunds && exactOneFailed && safeBlockers &&
      value.refundedAmountReportedMinor === 0) {
    return {
      state: 'verified_zero_refund_observation',
      eligibleToRecordEvidence: true,
      remainingFinancialObligationMinor: value.paymentAmountMinor,
      message: 'Consulta ao provedor indica cobrança aprovada e nenhum valor devolvido. A tentativa local failed pode receber uma evidência de conferência, sem apagar o histórico e sem quitar a pendência.',
    };
  }

  if (validPayment && noListedRefunds && exactOneFailed &&
      value.refundedAmountReportedMinor === null && safeBlockers) {
    return {
      state: 'provider_no_refund_listed_but_incomplete',
      eligibleToRecordEvidence: false,
      remainingFinancialObligationMinor: null,
      message: 'O Mercado Pago não listou devoluções, mas não forneceu um total estornado explícito. A conferência não autoriza conciliação conclusiva.',
    };
  }

  return {
    state: 'requires_manual_reconciliation',
    eligibleToRecordEvidence: false,
    remainingFinancialObligationMinor: null,
    message: 'Existem divergências, outros estados ou registros de devolução. Mantenha a pendência para análise financeira.',
  };
};
