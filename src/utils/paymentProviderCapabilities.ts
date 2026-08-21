export type PaymentProviderEnvironment = 'sandbox' | 'production';

export type PaymentProviderCapabilitySupport =
  | 'supported'
  | 'unsupported'
  | 'unconfirmed';

export interface PaymentProviderCapabilities {
  pix: PaymentProviderCapabilitySupport;
  card: PaymentProviderCapabilitySupport;
  boleto: PaymentProviderCapabilitySupport;
  refunds: PaymentProviderCapabilitySupport;
  partialRefunds: PaymentProviderCapabilitySupport;
  split: PaymentProviderCapabilitySupport;
  preRegisteredRecipients: PaymentProviderCapabilitySupport;
  dynamicRecipientSelection: PaymentProviderCapabilitySupport;
  splitAtAuthorization: PaymentProviderCapabilitySupport;
  splitAtCapture: PaymentProviderCapabilitySupport;
  splitAfterPayment: PaymentProviderCapabilitySupport;
  sellerOnboarding: PaymentProviderCapabilitySupport;
  walletAccount: PaymentProviderCapabilitySupport;
  cashIn: PaymentProviderCapabilitySupport;
  cashOut: PaymentProviderCapabilitySupport;
  p2pTransfer: PaymentProviderCapabilitySupport;
  kycPf: PaymentProviderCapabilitySupport;
  kycPj: PaymentProviderCapabilitySupport;
  signedWebhooks: PaymentProviderCapabilitySupport;
  idempotency: PaymentProviderCapabilitySupport;
  statement: PaymentProviderCapabilitySupport;
  recurringPayments: PaymentProviderCapabilitySupport;
  openFinance: PaymentProviderCapabilitySupport;
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
  'preRegisteredRecipients',
  'dynamicRecipientSelection',
];

export const KYRUB_EMBEDDED_FINANCE_CAPABILITIES: ReadonlyArray<keyof PaymentProviderCapabilities> = [
  'walletAccount',
  'cashIn',
  'cashOut',
  'p2pTransfer',
  'kycPf',
  'kycPj',
  'statement',
];

export const isPaymentProviderCapabilitySupported = (
  qualification: PaymentProviderQualification,
  capability: keyof PaymentProviderCapabilities
): boolean => qualification.capabilities[capability] === 'supported';

export const getMissingPaymentProviderCapabilities = (
  qualification: PaymentProviderQualification,
  required: ReadonlyArray<keyof PaymentProviderCapabilities> = KYRUB_MARKETPLACE_PSP_CAPABILITIES
): Array<keyof PaymentProviderCapabilities> =>
  required.filter(
    capability => qualification.capabilities[capability] !== 'supported'
  );

export const getUnconfirmedPaymentProviderCapabilities = (
  qualification: PaymentProviderQualification
): Array<keyof PaymentProviderCapabilities> =>
  (Object.keys(qualification.capabilities) as Array<keyof PaymentProviderCapabilities>)
    .filter(capability => qualification.capabilities[capability] === 'unconfirmed');

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
