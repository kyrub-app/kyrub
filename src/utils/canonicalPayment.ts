export type PaymentStatus =
  | 'pending'
  | 'paid'
  | 'failed'
  | 'expired'
  | 'refund_requested'
  | 'refund_processing'
  | 'refunded'
  | 'refund_failed';

export type PaymentMethod = 'pix' | 'card' | 'cash' | 'other';
export type PaymentContext = 'marketplace' | 'table' | 'pos';

export interface CanonicalPayment {
  id: string;
  storeId: string;
  orderId: string;
  buyerId: string;
  amount: number;
  currency: 'BRL';
  method: PaymentMethod;
  context: PaymentContext;
  status: PaymentStatus;
  provider: string;
  providerPaymentId: string;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
  paidAt: string;
  refundedAt: string;
}

const REQUIRED_TRANSITIONS: Record<PaymentStatus, readonly PaymentStatus[]> = {
  pending: ['paid', 'failed', 'expired'],
  paid: ['refund_requested'],
  failed: [],
  expired: [],
  refund_requested: ['refund_processing', 'refund_failed'],
  refund_processing: ['refunded', 'refund_failed'],
  refunded: [],
  refund_failed: ['refund_requested'],
};

const required = (label: string, value: string): string => {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
};

export const normalizeCanonicalPayment = (
  input: CanonicalPayment
): CanonicalPayment => {
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new Error('Payment amount must be a positive finite number.');
  }

  return {
    ...input,
    id: required('payment id', input.id),
    storeId: required('store id', input.storeId),
    orderId: required('order id', input.orderId),
    buyerId: required('buyer id', input.buyerId),
    amount: Number(input.amount.toFixed(2)),
    currency: 'BRL',
    provider: input.provider.trim(),
    providerPaymentId: input.providerPaymentId.trim(),
    idempotencyKey: required('payment idempotency key', input.idempotencyKey),
    createdAt: input.createdAt.trim(),
    updatedAt: input.updatedAt.trim(),
    paidAt: input.paidAt.trim(),
    refundedAt: input.refundedAt.trim(),
  };
};

export const canTransitionPaymentStatus = (
  from: PaymentStatus,
  to: PaymentStatus
): boolean => REQUIRED_TRANSITIONS[from].includes(to);

export const assertPaymentStatusTransition = (
  from: PaymentStatus,
  to: PaymentStatus
): void => {
  if (!canTransitionPaymentStatus(from, to)) {
    throw new Error(`Invalid payment status transition: ${from} -> ${to}.`);
  }
};

export const isPaymentAuthoritativelyPaid = (
  status: PaymentStatus
): boolean => status === 'paid' || status === 'refund_requested' || status === 'refund_processing';

export const shouldReleaseMarketplaceOrder = (input: {
  context: PaymentContext;
  status: PaymentStatus;
}): boolean =>
  input.context !== 'marketplace' || isPaymentAuthoritativelyPaid(input.status);

export const isPaymentTerminal = (status: PaymentStatus): boolean =>
  ['failed', 'expired', 'refunded'].includes(status);
