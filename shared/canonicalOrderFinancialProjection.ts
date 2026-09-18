export type CanonicalOrderFinancialState =
  | 'not_started'
  | 'pending'
  | 'partial'
  | 'paid'
  | 'refunded'
  | 'attention';

export type CanonicalOrderPaymentEvidenceStatus =
  | 'pending'
  | 'paid'
  | 'failed'
  | 'expired'
  | 'cancelled'
  | 'refund_requested'
  | 'refund_processing'
  | 'refunded'
  | 'refund_failed'
  | 'charged_back'
  | 'chargeback_reversed';

export interface CanonicalOrderPaymentEvidence {
  amount: number;
  status: CanonicalOrderPaymentEvidenceStatus;
}

export interface CanonicalOrderFinancialProjection {
  expectedAmount: number;
  authoritativelyPaidAmount: number;
  outstandingAmount: number;
  pendingPaymentCount: number;
  canonicalPaymentCount: number;
  state: CanonicalOrderFinancialState;
}

const isAuthoritativelyPaidStatus = (
  status: CanonicalOrderPaymentEvidenceStatus
): boolean =>
  status === 'paid' ||
  status === 'refund_requested' ||
  status === 'refund_processing' ||
  status === 'refund_failed' ||
  status === 'chargeback_reversed';

export const buildCanonicalOrderFinancialProjection = (input: {
  expectedAmount: number;
  payments: readonly CanonicalOrderPaymentEvidence[];
}): CanonicalOrderFinancialProjection => {
  if (!Number.isFinite(input.expectedAmount) || input.expectedAmount < 0) {
    throw new Error('CANONICAL_ORDER_FINANCIAL_EXPECTED_AMOUNT_INVALID');
  }

  const expectedAmount = Number(input.expectedAmount.toFixed(2));
  for (const payment of input.payments) {
    if (!Number.isFinite(payment.amount) || payment.amount <= 0) {
      throw new Error('CANONICAL_ORDER_FINANCIAL_PAYMENT_AMOUNT_INVALID');
    }
  }

  const authoritativelyPaidAmount = Number(
    input.payments
      .filter(payment => isAuthoritativelyPaidStatus(payment.status))
      .reduce((sum, payment) => sum + payment.amount, 0)
      .toFixed(2)
  );
  const outstandingAmount = Number(
    Math.max(0, expectedAmount - authoritativelyPaidAmount).toFixed(2)
  );
  const pendingPaymentCount = input.payments.filter(
    payment => payment.status === 'pending'
  ).length;

  let state: CanonicalOrderFinancialState = 'attention';
  if (input.payments.length === 0) {
    state = 'not_started';
  } else if (authoritativelyPaidAmount > 0) {
    state = expectedAmount > 0 && authoritativelyPaidAmount + 0.009 >= expectedAmount
      ? 'paid'
      : 'partial';
  } else if (pendingPaymentCount > 0) {
    state = 'pending';
  } else if (input.payments.every(payment => payment.status === 'refunded')) {
    state = 'refunded';
  }

  return {
    expectedAmount,
    authoritativelyPaidAmount,
    outstandingAmount,
    pendingPaymentCount,
    canonicalPaymentCount: input.payments.length,
    state,
  };
};
