import type { PaymentStatus } from './canonicalPayment';

export type RefundRequesterRole = 'buyer' | 'merchant' | 'support' | 'system';

export interface PaymentRefundRequest {
  id: string;
  paymentId: string;
  orderId: string;
  storeId: string;
  requestedByUserId: string;
  requestedByRole: RefundRequesterRole;
  reason: string;
  amount: number;
  currency: 'BRL';
  createdAt: string;
}

export const canRequestRefundFromPaymentStatus = (status: PaymentStatus): boolean =>
  status === 'paid' || status === 'refund_failed';

export const assertRefundRequestAllowed = (input: {
  paymentStatus: PaymentStatus;
  paidAmount: number;
  request: PaymentRefundRequest;
}): void => {
  if (!canRequestRefundFromPaymentStatus(input.paymentStatus)) {
    throw new Error('REFUND_NOT_ALLOWED_FOR_PAYMENT_STATUS');
  }
  if (!Number.isFinite(input.paidAmount) || input.paidAmount <= 0) {
    throw new Error('PAID_AMOUNT_INVALID');
  }
  if (!Number.isFinite(input.request.amount) || input.request.amount <= 0) {
    throw new Error('REFUND_AMOUNT_INVALID');
  }
  if (Number(input.request.amount.toFixed(2)) > Number(input.paidAmount.toFixed(2))) {
    throw new Error('REFUND_AMOUNT_EXCEEDS_PAYMENT');
  }
  if (!input.request.id.trim() || !input.request.paymentId.trim() || !input.request.orderId.trim()) {
    throw new Error('REFUND_IDENTITY_REQUIRED');
  }
  if (!input.request.storeId.trim() || !input.request.requestedByUserId.trim()) {
    throw new Error('REFUND_ACTOR_REQUIRED');
  }
  if (!input.request.reason.trim()) throw new Error('REFUND_REASON_REQUIRED');
};
