import { adminDb } from '../firebaseAdmin.js';

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const positiveAmount = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : 0;

export interface ConfirmedPartialRefundSummary {
  count: number;
  amount: number;
}

export const getConfirmedPartialRefundSummary = async (input: {
  storeId: string;
  orderId: string;
}): Promise<ConfirmedPartialRefundSummary> => {
  const storeId = clean(input.storeId);
  const orderId = clean(input.orderId);
  if (!storeId || !orderId) {
    throw new Error('PAYMENT_REFUND_TARGET_REQUIRED');
  }

  const snapshot = await adminDb
    .collection(`stores/${storeId}/paymentPartialRefunds`)
    .where('orderId', '==', orderId)
    .limit(50)
    .get();

  let count = 0;
  let amount = 0;
  for (const document of snapshot.docs) {
    const data = document.data() as Record<string, unknown>;
    if (clean(data.status) !== 'refunded') continue;
    const refundedAmount = positiveAmount(data.amount);
    if (refundedAmount <= 0) continue;
    count += 1;
    amount += refundedAmount;
  }

  return {
    count,
    amount: Math.round((amount + Number.EPSILON) * 100) / 100,
  };
};

export const assertFullRefundHasNoConfirmedPartialHistory = async (input: {
  storeId: string;
  orderId: string;
}): Promise<void> => {
  const summary = await getConfirmedPartialRefundSummary(input);
  if (summary.count > 0 && summary.amount > 0) {
    throw new Error('PAYMENT_REFUND_PARTIAL_HISTORY_REQUIRES_RESIDUAL');
  }
};
