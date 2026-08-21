export type PaymentProviderEnvironment = 'sandbox' | 'production';

export interface PaymentProviderCapabilities {
  pix: boolean;
  refunds: boolean;
  partialRefunds: boolean;
  split: boolean;
  posteriorSplit: boolean;
  sellerOnboarding: boolean;
  signedWebhooks: boolean;
  idempotency: boolean;
}

export interface PaymentProviderQualification {
  providerId: string;
  environment: PaymentProviderEnvironment;
  capabilities: PaymentProviderCapabilities;
  configured: boolean;
}

export const KYRUB_REQUIRED_PSP_CAPABILITIES: ReadonlyArray<keyof PaymentProviderCapabilities> = [
  'pix',
  'refunds',
  'signedWebhooks',
  'idempotency',
];

export const KYRUB_MARKETPLACE_PSP_CAPABILITIES: ReadonlyArray<keyof PaymentProviderCapabilities> = [
  ...KYRUB_REQUIRED_PSP_CAPABILITIES,
  'split',
  'sellerOnboarding',
];

export const getMissingPaymentProviderCapabilities = (
  qualification: PaymentProviderQualification,
  required: ReadonlyArray<keyof PaymentProviderCapabilities> = KYRUB_MARKETPLACE_PSP_CAPABILITIES
): Array<keyof PaymentProviderCapabilities> =>
  required.filter(capability => qualification.capabilities[capability] !== true);

export const isPaymentProviderReady = (
  qualification: PaymentProviderQualification,
  required?: ReadonlyArray<keyof PaymentProviderCapabilities>
): boolean =>
  qualification.configured &&
  getMissingPaymentProviderCapabilities(qualification, required).length === 0;

export const assertPaymentProviderEnvironment = (
  qualification: PaymentProviderQualification,
  expected: PaymentProviderEnvironment
): void => {
  if (qualification.environment !== expected) {
    throw new Error(`PAYMENT_PROVIDER_ENVIRONMENT_MISMATCH:${qualification.providerId}`);
  }
};
