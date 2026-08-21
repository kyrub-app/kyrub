import type { PaymentProviderQualification } from './paymentProviderCapabilities';

/**
 * Qualification profile only. This is not an API adapter and contains no credentials.
 * Capabilities that still depend on the Kyrub commercial/account contract remain
 * `unconfirmed` until they are proven by official docs plus sandbox/account evidence.
 */
export const buildZoopQualificationProfile = (input?: {
  environment?: 'sandbox' | 'production';
  configured?: boolean;
  dynamicRecipientSelectionConfirmed?: boolean;
  splitAfterPaymentConfirmed?: boolean;
}): PaymentProviderQualification => ({
  providerId: 'zoop',
  environment: input?.environment ?? 'sandbox',
  configured: input?.configured ?? false,
  capabilities: {
    pix: 'supported',
    card: 'supported',
    boleto: 'unconfirmed',
    refunds: 'supported',
    partialRefunds: 'unconfirmed',
    split: 'supported',
    preRegisteredRecipients: 'supported',
    dynamicRecipientSelection:
      input?.dynamicRecipientSelectionConfirmed === true
        ? 'supported'
        : 'unconfirmed',
    splitAtAuthorization: 'unconfirmed',
    splitAtCapture: 'unconfirmed',
    splitAfterPayment:
      input?.splitAfterPaymentConfirmed === true ? 'supported' : 'unconfirmed',
    sellerOnboarding: 'supported',
    walletAccount: 'unconfirmed',
    cashIn: 'unconfirmed',
    cashOut: 'unconfirmed',
    p2pTransfer: 'unconfirmed',
    kycPf: 'unconfirmed',
    kycPj: 'unconfirmed',
    signedWebhooks: 'supported',
    idempotency: 'supported',
    statement: 'unconfirmed',
    recurringPayments: 'unconfirmed',
    openFinance: 'unconfirmed',
  },
});
