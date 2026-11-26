import type { Transaction } from 'firebase-admin/firestore';
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
  unresolvedCount: number;
}

export const getConfirmedPartialRefundSummary = async (input: {
  storeId: string;
  orderId: string;
},transaction?:Transaction): Promise<ConfirmedPartialRefundSummary> => {
  const storeId = clean(input.storeId);
  const orderId = clean(input.orderId);
  if (!storeId || !orderId) {
    throw new Error('PAYMENT_REFUND_TARGET_REQUIRED');
  }

  const query=adminDb.collection(`stores/${storeId}/paymentPartialRefunds`).where('orderId','==',orderId).limit(51);
  const snapshot=transaction?await transaction.get(query):await query.get();

  // A capped scan must never silently treat omitted records as no history.
  // An oversized history needs independent reconciliation, not a blind refund.
  if (snapshot.size > 50) {
    throw new Error('PAYMENT_REFUND_PARTIAL_HISTORY_REVIEW_REQUIRED');
  }

  let count = 0;
  let amount = 0;
  let unresolvedCount = 0;
  for (const document of snapshot.docs) {
    const data = document.data() as Record<string, unknown>;
    if (clean(data.status) !== 'refunded') {
      // Includes required, processing, failed and unknown provider states.
      // Failed is not proof the provider did not refund the money.
      unresolvedCount += 1;
      continue;
    }
    const refundedAmount = positiveAmount(data.amount);
    if (refundedAmount <= 0) {
      throw new Error('PAYMENT_REFUND_PARTIAL_HISTORY_REVIEW_REQUIRED');
    }
    count += 1;
    amount += refundedAmount;
  }

  return {
    count,
    amount: Math.round((amount + Number.EPSILON) * 100) / 100,
    unresolvedCount,
  };
};

export const assertFullRefundHasNoConfirmedPartialHistory = async (input: {
  storeId: string;
  orderId: string;
},transaction?:Transaction): Promise<void> => {
  const summary = await getConfirmedPartialRefundSummary(input,transaction);
  if (summary.unresolvedCount > 0) {
    throw new Error('PAYMENT_REFUND_PARTIAL_HISTORY_REVIEW_REQUIRED');
  }
  if (summary.count > 0 && summary.amount > 0) {
    throw new Error('PAYMENT_REFUND_PARTIAL_HISTORY_REQUIRES_RESIDUAL');
  }
};
