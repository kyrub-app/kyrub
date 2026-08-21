import type { PaymentStatus } from './canonicalPayment';
import type { PaymentIntentStatus } from './canonicalPaymentIntent';

export type MarketplacePaymentUxState =
  | 'awaiting_payment'
  | 'payment_confirmed'
  | 'payment_failed'
  | 'payment_expired'
  | 'refund_requested'
  | 'refund_processing'
  | 'refunded'
  | 'refund_failed';

export interface MarketplacePaymentUxPolicy {
  state: MarketplacePaymentUxState;
  canMaterializeOrder: boolean;
  canReleaseToKds: boolean;
  canRetryPayment: boolean;
  canRequestRefund: boolean;
  shouldShowPixPaymentInstructions: boolean;
}

export const derivePaymentIntentUxPolicy = (input: {
  status: PaymentIntentStatus;
  method: 'pix' | 'card' | 'cash' | 'other';
}): MarketplacePaymentUxPolicy => {
  switch (input.status) {
    case 'pending':
      return {
        state: 'awaiting_payment',
        canMaterializeOrder: false,
        canReleaseToKds: false,
        canRetryPayment: false,
        canRequestRefund: false,
        shouldShowPixPaymentInstructions: input.method === 'pix',
      };
    case 'paid':
      return {
        state: 'payment_confirmed',
        canMaterializeOrder: true,
        canReleaseToKds: true,
        canRetryPayment: false,
        canRequestRefund: true,
        shouldShowPixPaymentInstructions: false,
      };
    case 'failed':
      return {
        state: 'payment_failed',
        canMaterializeOrder: false,
        canReleaseToKds: false,
        canRetryPayment: true,
        canRequestRefund: false,
        shouldShowPixPaymentInstructions: false,
      };
    case 'expired':
      return {
        state: 'payment_expired',
        canMaterializeOrder: false,
        canReleaseToKds: false,
        canRetryPayment: true,
        canRequestRefund: false,
        shouldShowPixPaymentInstructions: false,
      };
  }
};

/**
 * Post-payment UX uses the canonical Payment state machine. Refund states never
 * create a second KDS release signal; an already materialized order remains a
 * separate operational entity.
 */
export const deriveCanonicalPaymentUxPolicy = (
  status: PaymentStatus
): MarketplacePaymentUxPolicy => {
  switch (status) {
    case 'pending':
      return {
        state: 'awaiting_payment',
        canMaterializeOrder: false,
        canReleaseToKds: false,
        canRetryPayment: false,
        canRequestRefund: false,
        shouldShowPixPaymentInstructions: false,
      };
    case 'paid':
      return {
        state: 'payment_confirmed',
        canMaterializeOrder: true,
        canReleaseToKds: true,
        canRetryPayment: false,
        canRequestRefund: true,
        shouldShowPixPaymentInstructions: false,
      };
    case 'failed':
      return {
        state: 'payment_failed',
        canMaterializeOrder: false,
        canReleaseToKds: false,
        canRetryPayment: true,
        canRequestRefund: false,
        shouldShowPixPaymentInstructions: false,
      };
    case 'expired':
      return {
        state: 'payment_expired',
        canMaterializeOrder: false,
        canReleaseToKds: false,
        canRetryPayment: true,
        canRequestRefund: false,
        shouldShowPixPaymentInstructions: false,
      };
    case 'refund_requested':
      return {
        state: 'refund_requested',
        canMaterializeOrder: false,
        canReleaseToKds: false,
        canRetryPayment: false,
        canRequestRefund: false,
        shouldShowPixPaymentInstructions: false,
      };
    case 'refund_processing':
      return {
        state: 'refund_processing',
        canMaterializeOrder: false,
        canReleaseToKds: false,
        canRetryPayment: false,
        canRequestRefund: false,
        shouldShowPixPaymentInstructions: false,
      };
    case 'refunded':
      return {
        state: 'refunded',
        canMaterializeOrder: false,
        canReleaseToKds: false,
        canRetryPayment: false,
        canRequestRefund: false,
        shouldShowPixPaymentInstructions: false,
      };
    case 'refund_failed':
      return {
        state: 'refund_failed',
        canMaterializeOrder: false,
        canReleaseToKds: false,
        canRetryPayment: false,
        canRequestRefund: true,
        shouldShowPixPaymentInstructions: false,
      };
  }
};

export const canExposeMarketplaceOrderToKds = (
  intentStatus: PaymentIntentStatus
): boolean => intentStatus === 'paid';
