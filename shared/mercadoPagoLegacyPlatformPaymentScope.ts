/**
 * Fail-closed identity check for historical Pix created with the platform's
 * Mercado Pago credential, before store-scoped provider bindings were created.
 *
 * Provider API access alone is not ownership proof. The signed-in store owner
 * has already been authorized by the route; this verifies that the provider
 * resource belongs to the exact canonical store/payment/intent and to the
 * credential's own collector account before recording any fee evidence.
 */
export type LegacyPlatformPaymentScope = {
  storeId: string;
  paymentId: string;
  providerPaymentId: string;
  canonicalPaymentIntentId?: string;
  providerId: unknown;
  externalReference: unknown;
  metadata: unknown;
  collectorId: unknown;
  platformAccountId: unknown;
};

const clean = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';

export const assertLegacyPlatformMercadoPagoPaymentScope = (
  input: LegacyPlatformPaymentScope
): void => {
  const metadata = input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata)
    ? input.metadata as Record<string, unknown>
    : {};
  const intentId = clean(metadata.kyrub_payment_intent_id);
  const externalReference = clean(input.externalReference);
  if (
    !clean(input.storeId) || !clean(input.paymentId) || !clean(input.providerPaymentId)
    || clean(input.providerId) !== input.providerPaymentId
    || clean(metadata.kyrub_store_id) !== input.storeId
    || clean(metadata.kyrub_payment_id) !== input.paymentId
    || !intentId || !externalReference || intentId !== externalReference
    || (clean(input.canonicalPaymentIntentId) && clean(input.canonicalPaymentIntentId) !== intentId)
    || !clean(input.collectorId) || !clean(input.platformAccountId)
    || clean(input.collectorId) !== clean(input.platformAccountId)
  ) {
    throw new Error('STORE_PROVIDER_RECONCILIATION_LEGACY_SCOPE_UNVERIFIED');
  }
};
