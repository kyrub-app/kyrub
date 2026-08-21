export interface PaymentFoundationReadinessInput {
  canonicalPaymentContract: boolean;
  paymentIntentSeparatedFromOrder: boolean;
  verifiedWebhookOnly: boolean;
  webhookIdempotency: boolean;
  marketplaceMaterializesAfterPaid: boolean;
  refundRequiresProviderConfirmation: boolean;
  courierPayableOnlyAfterDelivery: boolean;
  providerSpecificCredentialsAbsent: boolean;
}

export interface PaymentFoundationReadinessResult {
  ready: boolean;
  missing: string[];
}

export const evaluatePaymentFoundationReadiness = (
  input: PaymentFoundationReadinessInput
): PaymentFoundationReadinessResult => {
  const checks: Array<[keyof PaymentFoundationReadinessInput, string]> = [
    ['canonicalPaymentContract', 'canonical_payment_contract'],
    ['paymentIntentSeparatedFromOrder', 'payment_intent_separated_from_order'],
    ['verifiedWebhookOnly', 'verified_webhook_only'],
    ['webhookIdempotency', 'webhook_idempotency'],
    ['marketplaceMaterializesAfterPaid', 'marketplace_materializes_after_paid'],
    ['refundRequiresProviderConfirmation', 'refund_requires_provider_confirmation'],
    ['courierPayableOnlyAfterDelivery', 'courier_payable_only_after_delivery'],
    ['providerSpecificCredentialsAbsent', 'provider_specific_credentials_absent'],
  ];

  const missing = checks
    .filter(([key]) => !input[key])
    .map(([, label]) => label);

  return {
    ready: missing.length === 0,
    missing,
  };
};
