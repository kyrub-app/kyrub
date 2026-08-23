import type { PaymentStatus } from './canonicalPayment';

export type PaymentFailureScenario =
  | 'pix_expired'
  | 'payment_cancelled'
  | 'provider_timeout'
  | 'duplicate_webhook'
  | 'delayed_webhook'
  | 'out_of_order_webhook'
  | 'webhook_replay'
  | 'provider_unavailable'
  | 'unknown_provider_response';

export type PaymentFailureDisposition =
  | 'transition_expired'
  | 'transition_failed'
  | 'keep_current_retryable'
  | 'idempotent_noop'
  | 'reject_stale_event'
  | 'reject_unverified_or_unknown';

export interface PaymentFailureDecision {
  scenario: PaymentFailureScenario;
  disposition: PaymentFailureDisposition;
  mayMarkPaid: false;
  targetStatus?: Extract<PaymentStatus, 'failed' | 'expired'>;
  retryable: boolean;
}

export const decidePaymentFailure = (
  scenario: PaymentFailureScenario
): PaymentFailureDecision => {
  switch (scenario) {
    case 'pix_expired':
      return {
        scenario,
        disposition: 'transition_expired',
        mayMarkPaid: false,
        targetStatus: 'expired',
        retryable: false,
      };
    case 'payment_cancelled':
      return {
        scenario,
        disposition: 'transition_failed',
        mayMarkPaid: false,
        targetStatus: 'failed',
        retryable: false,
      };
    case 'provider_timeout':
    case 'provider_unavailable':
      return {
        scenario,
        disposition: 'keep_current_retryable',
        mayMarkPaid: false,
        retryable: true,
      };
    case 'duplicate_webhook':
      return {
        scenario,
        disposition: 'idempotent_noop',
        mayMarkPaid: false,
        retryable: false,
      };
    case 'delayed_webhook':
    case 'out_of_order_webhook':
      return {
        scenario,
        disposition: 'reject_stale_event',
        mayMarkPaid: false,
        retryable: false,
      };
    case 'webhook_replay':
    case 'unknown_provider_response':
      return {
        scenario,
        disposition: 'reject_unverified_or_unknown',
        mayMarkPaid: false,
        retryable: false,
      };
  }
};

export const ALL_PAYMENT_FAILURE_SCENARIOS: readonly PaymentFailureScenario[] = [
  'pix_expired',
  'payment_cancelled',
  'provider_timeout',
  'duplicate_webhook',
  'delayed_webhook',
  'out_of_order_webhook',
  'webhook_replay',
  'provider_unavailable',
  'unknown_provider_response',
];
