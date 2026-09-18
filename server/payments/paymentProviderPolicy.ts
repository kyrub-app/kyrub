import {
  getPaymentProviderAdapter,
  isPaymentProviderId,
  type PaymentProviderAdapter,
  type PaymentProviderId,
} from './paymentProviderAdapter.js';

export interface PaymentProviderPolicy {
  primaryProvider: PaymentProviderId;
  fallbackProvider?: PaymentProviderId;
}

/**
 * The first operational provider remains Mercado Pago. This is deliberately a
 * policy choice rather than an order/payment dependency so a store-scoped BaaS
 * provider can replace it later without changing canonical payment contracts.
 */
export const DEFAULT_PAYMENT_PROVIDER_POLICY: PaymentProviderPolicy = {
  primaryProvider: 'mercado-pago',
};

export const normalizePaymentProviderPolicy = (
  value: PaymentProviderPolicy = DEFAULT_PAYMENT_PROVIDER_POLICY
): PaymentProviderPolicy => {
  if (!isPaymentProviderId(value.primaryProvider)) {
    throw new Error('PAYMENT_PROVIDER_PRIMARY_UNSUPPORTED');
  }
  if (value.fallbackProvider !== undefined) {
    if (!isPaymentProviderId(value.fallbackProvider)) {
      throw new Error('PAYMENT_PROVIDER_FALLBACK_UNSUPPORTED');
    }
    if (value.fallbackProvider === value.primaryProvider) {
      throw new Error('PAYMENT_PROVIDER_FALLBACK_DUPLICATES_PRIMARY');
    }
  }
  return { ...value };
};

export const resolvePrimaryPaymentProvider = (
  policy: PaymentProviderPolicy = DEFAULT_PAYMENT_PROVIDER_POLICY
): PaymentProviderAdapter =>
  getPaymentProviderAdapter(normalizePaymentProviderPolicy(policy).primaryProvider);

/**
 * Once a provider has created a charge, that binding is immutable for the
 * attempt. Fallback is only eligible before a provider payment id exists.
 */
export const assertPaymentProviderBinding = (input: {
  selectedProvider: PaymentProviderId;
  boundProvider?: string;
  providerPaymentId?: string;
}): void => {
  const boundProvider = input.boundProvider?.trim() ?? '';
  const providerPaymentId = input.providerPaymentId?.trim() ?? '';
  if (providerPaymentId && boundProvider !== input.selectedProvider) {
    throw new Error('PAYMENT_PROVIDER_SWITCH_AFTER_CHARGE_FORBIDDEN');
  }
  if (boundProvider && boundProvider !== input.selectedProvider) {
    throw new Error('PAYMENT_PROVIDER_BINDING_CONFLICT');
  }
};
