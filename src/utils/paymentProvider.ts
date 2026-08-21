import type { PaymentMethod, PaymentStatus } from './canonicalPayment';

export type PaymentProviderEventType =
  | 'payment.paid'
  | 'payment.failed'
  | 'payment.expired'
  | 'refund.processing'
  | 'refund.succeeded'
  | 'refund.failed';

export interface VerifiedPaymentProviderEvent {
  provider: string;
  eventId: string;
  eventType: PaymentProviderEventType;
  providerPaymentId: string;
  paymentIntentId: string;
  amount: number;
  currency: 'BRL';
  method: PaymentMethod;
  occurredAt: string;
  signatureVerified: true;
}

export interface PaymentProviderAdapter {
  id: string;
  verifyWebhook(input: {
    headers: Record<string, string | string[] | undefined>;
    rawBody: string;
  }): Promise<VerifiedPaymentProviderEvent>;
}

const required = (label: string, value: string): string => {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
};

export const normalizeVerifiedProviderEvent = (
  input: VerifiedPaymentProviderEvent
): VerifiedPaymentProviderEvent => {
  if (input.signatureVerified !== true) {
    throw new Error('PAYMENT_WEBHOOK_NOT_VERIFIED');
  }
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new Error('PAYMENT_WEBHOOK_AMOUNT_INVALID');
  }
  const occurredAt = input.occurredAt.trim();
  if (!occurredAt || Number.isNaN(Date.parse(occurredAt))) {
    throw new Error('PAYMENT_WEBHOOK_TIMESTAMP_INVALID');
  }

  return {
    ...input,
    provider: required('payment provider', input.provider),
    eventId: required('payment provider event id', input.eventId),
    providerPaymentId: required('provider payment id', input.providerPaymentId),
    paymentIntentId: required('payment intent id', input.paymentIntentId),
    amount: Number(input.amount.toFixed(2)),
    currency: 'BRL',
    occurredAt,
    signatureVerified: true,
  };
};

export const buildPaymentWebhookIdempotencyKey = (
  event: VerifiedPaymentProviderEvent
): string => {
  const normalized = normalizeVerifiedProviderEvent(event);
  return [normalized.provider, normalized.eventId]
    .map(value => encodeURIComponent(value))
    .join('|');
};

export const paymentStatusFromProviderEvent = (
  eventType: PaymentProviderEventType
): PaymentStatus => {
  switch (eventType) {
    case 'payment.paid':
      return 'paid';
    case 'payment.failed':
      return 'failed';
    case 'payment.expired':
      return 'expired';
    case 'refund.processing':
      return 'refund_processing';
    case 'refund.succeeded':
      return 'refunded';
    case 'refund.failed':
      return 'refund_failed';
  }
};
