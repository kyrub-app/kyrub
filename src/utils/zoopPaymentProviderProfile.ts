import type { PaymentProviderQualification } from './paymentProviderCapabilities';

/**
 * Qualification profile only. This is not an API adapter and contains no credentials.
 * Capabilities that still depend on the Kyrub commercial/account contract remain false
 * until they are confirmed in sandbox/account provisioning.
 */
export const buildZoopQualificationProfile = (input?: {
  environment?: 'sandbox' | 'production';
  configured?: boolean;
  posteriorSplitConfirmed?: boolean;
}): PaymentProviderQualification => ({
  providerId: 'zoop',
  environment: input?.environment ?? 'sandbox',
  configured: input?.configured ?? false,
  capabilities: {
    pix: true,
    refunds: true,
    partialRefunds: false,
    split: true,
    posteriorSplit: input?.posteriorSplitConfirmed === true,
    sellerOnboarding: true,
    signedWebhooks: true,
    idempotency: true,
  },
});
