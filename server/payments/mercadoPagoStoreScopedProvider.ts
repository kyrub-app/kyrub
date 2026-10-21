import type { ExistingOrderCanonicalPaymentIntent, MarketplaceCanonicalPaymentIntent } from '../../src/utils/canonicalPaymentIntent.js';
import type { PaymentProviderEventType, VerifiedPaymentProviderEvent } from '../../src/utils/paymentProvider.js';
import { mercadoPagoStoreRequest, validateMercadoPagoStoreConnection } from '../integrations/mercadoPagoStoreOauthService.js';
import {
  loadMercadoPagoPaymentProviderBinding,
  saveMercadoPagoPaymentProviderBinding,
} from './paymentProviderBindingService.js';
import { resolveCommercialRecipientAuthority } from './commercialRecipientAuthorityService.js';
import { verifyMercadoPagoWebhookSignature } from './mercadoPagoPixProvider.js';

interface MercadoPagoPayment {
  id?: string | number;
  collector_id?: string | number;
  status?: string;
  status_detail?: string;
  transaction_amount?: number;
  date_created?: string;
  date_last_updated?: string;
  date_of_expiration?: string;
  external_reference?: string;
  metadata?: Record<string, unknown>;
  point_of_interaction?: {
    transaction_data?: {
      qr_code?: string;
      qr_code_base64?: string;
      ticket_url?: string;
    };
  };
}

const clean = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';

// Release switch controls the feature, not the ownership of a merchant account.
// Pilot mode authorizes one canonical store for the first controlled payment.
// Later, connected_stores permits each eligible store's OWN validated OAuth;
// no store receives another store's token or payment. Default stays disabled.
export const assertMerchantMarketplacePixCanaryAllowed = (storeId: string): void => {
  if (process.env.VERCEL_ENV !== 'production') {
    throw new Error('MERCADO_PAGO_STORE_PIX_PRODUCTION_ONLY');
  }
  if (process.env.KYRUB_MP_MERCHANT_PIX_ENABLED !== 'true') {
    throw new Error('MERCADO_PAGO_STORE_PIX_ROLLOUT_NOT_ENABLED');
  }
  const rolloutMode = clean(process.env.KYRUB_MP_MERCHANT_PIX_ROLLOUT_MODE);
  if (rolloutMode === 'canary') {
    const canaryStoreId = clean(process.env.KYRUB_MP_MERCHANT_PIX_CANARY_STORE_ID);
    if (!canaryStoreId || canaryStoreId !== clean(storeId)) {
      throw new Error('MERCADO_PAGO_STORE_PIX_ROLLOUT_NOT_ENABLED');
    }
  } else if (rolloutMode !== 'connected_stores') {
    // Refuse implicit general release if the mode is omitted or mistyped.
    throw new Error('MERCADO_PAGO_STORE_PIX_ROLLOUT_NOT_ENABLED');
  }
  // Recipient verification is performed per store immediately before the POST:
  // resolveCommercialRecipientAuthority -> live OAuth /users/me -> collector_id.
};

const checkout = (payment: MercadoPagoPayment) => {
  const providerPaymentId = clean(payment.id);
  if (!providerPaymentId) throw new Error('MERCADO_PAGO_PAYMENT_ID_MISSING');
  const transactionData = payment.point_of_interaction?.transaction_data;
  return {
    provider: 'mercado-pago' as const,
    providerPaymentId,
    status: clean(payment.status),
    qrCode: clean(transactionData?.qr_code),
    qrCodeBase64: clean(transactionData?.qr_code_base64),
    ticketUrl: clean(transactionData?.ticket_url),
    expiresAt: clean(payment.date_of_expiration),
  };
};

export const createStoreScopedMercadoPagoLocalPix = async (input: {
  intent: ExistingOrderCanonicalPaymentIntent | MarketplaceCanonicalPaymentIntent;
  paymentId: string;
  payerEmail: string;
  verifyCollectorForMarketplace?: boolean;
}) => {
  const recipientAuthority = await resolveCommercialRecipientAuthority({
    context: 'store_sale',
    canonicalStoreId: input.intent.storeId,
  });
  const credentialScopeId = recipientAuthority.credentialScopeId;
  if (input.verifyCollectorForMarketplace) {
    // Verify live OAuth identity before creating a Pix, not only after provider response.
    const liveAccountId = await validateMercadoPagoStoreConnection(credentialScopeId);
    if (liveAccountId !== recipientAuthority.externalAccountId) {
      throw new Error('MERCADO_PAGO_STORE_PAYMENT_COLLECTOR_MISMATCH');
    }
  }
  const payment = await mercadoPagoStoreRequest<MercadoPagoPayment>(credentialScopeId, '/v1/payments', {
    method: 'POST',
    headers: { 'X-Idempotency-Key': input.intent.idempotencyKey },
    body: JSON.stringify({
      transaction_amount: input.intent.amount,
      description: `Pedido Kyrub ${input.intent.target.orderId}`,
      payment_method_id: 'pix',
      payer: { email: input.payerEmail },
      date_of_expiration: input.intent.expiresAt,
      external_reference: input.intent.id,
      metadata: {
        kyrub_store_id: input.intent.storeId,
        kyrub_payment_id: input.paymentId,
        kyrub_payment_intent_id: input.intent.id,
      },
    }),
  });
  const normalized = checkout(payment);
  // Storefront cutover must not expose a QR whose actual beneficiary differs
  // from the OAuth account authorized by the merchant. Local legacy callers
  // keep their existing behavior until their separate migration gate.
  if (input.verifyCollectorForMarketplace && clean(payment.collector_id) !== recipientAuthority.externalAccountId) {
    throw new Error('MERCADO_PAGO_STORE_PAYMENT_COLLECTOR_MISMATCH');
  }
  await saveMercadoPagoPaymentProviderBinding({
    provider: 'mercado-pago',
    providerPaymentId: normalized.providerPaymentId,
    legacyStoreId: credentialScopeId,
    canonicalStoreId: input.intent.storeId,
    paymentId: input.paymentId,
    paymentIntentId: input.intent.id,
  });
  return normalized;
};

/** The marketplace's already-validated draft owns payer identity, never request.body. */
export const createStoreScopedMercadoPagoMarketplacePix = async (input: {
  intent: MarketplaceCanonicalPaymentIntent;
  paymentId: string;
}) => {
  // Repeat the gate here as defense in depth if another caller skips the bridge.
  assertMerchantMarketplacePixCanaryAllowed(input.intent.storeId);
  return createStoreScopedMercadoPagoLocalPix({
    intent: input.intent,
    paymentId: input.paymentId,
    payerEmail: input.intent.orderDraft.buyerEmail,
    verifyCollectorForMarketplace: true,
  });
};

export const getStoreScopedMercadoPagoPixCheckout = async (providerPaymentId: string) => {
  const binding = await loadMercadoPagoPaymentProviderBinding(providerPaymentId);
  if (!binding) throw new Error('MERCADO_PAGO_STORE_PAYMENT_BINDING_NOT_FOUND');
  return checkout(
    await mercadoPagoStoreRequest<MercadoPagoPayment>(
      binding.legacyStoreId,
      `/v1/payments/${encodeURIComponent(providerPaymentId)}`
    )
  );
};

const eventType = (payment: MercadoPagoPayment): PaymentProviderEventType | null => {
  const status = clean(payment.status).toLowerCase();
  const detail = clean(payment.status_detail).toLowerCase();
  if (status === 'approved') return 'payment.paid';
  if (status === 'rejected') return 'payment.failed';
  if (status === 'cancelled') return detail.includes('expired') ? 'payment.expired' : 'payment.failed';
  if (status === 'refunded' || status === 'charged_back') return 'refund.succeeded';
  return null;
};

export interface VerifiedStoreMercadoPagoEvent extends VerifiedPaymentProviderEvent {
  kyrubStoreId: string;
  kyrubPaymentId: string;
}

export const verifiedStoreScopedMercadoPagoPaymentEvent = async (input: {
  headers: Record<string, string | string[] | undefined>;
  dataId: string;
}): Promise<VerifiedStoreMercadoPagoEvent | null> => {
  const binding = await loadMercadoPagoPaymentProviderBinding(input.dataId);
  if (!binding) return null;
  await verifyMercadoPagoWebhookSignature(input);
  const payment = await mercadoPagoStoreRequest<MercadoPagoPayment>(
    binding.legacyStoreId,
    `/v1/payments/${encodeURIComponent(input.dataId)}`
  );
  const type = eventType(payment);
  if (!type) return null;
  const metadata = payment.metadata ?? {};
  const paymentIntentId = clean(metadata.kyrub_payment_intent_id) || clean(payment.external_reference);
  const kyrubStoreId = clean(metadata.kyrub_store_id);
  const kyrubPaymentId = clean(metadata.kyrub_payment_id);
  const providerPaymentId = clean(payment.id);
  const amount = Number(payment.transaction_amount);
  const occurredAt = clean(payment.date_last_updated) || clean(payment.date_created) || new Date().toISOString();
  if (
    providerPaymentId !== binding.providerPaymentId ||
    kyrubStoreId !== binding.canonicalStoreId ||
    kyrubPaymentId !== binding.paymentId ||
    paymentIntentId !== binding.paymentIntentId ||
    !Number.isFinite(amount) || amount <= 0
  ) {
    throw new Error('MERCADO_PAGO_STORE_PAYMENT_METADATA_INVALID');
  }
  return {
    provider: 'mercado-pago',
    eventId: `${providerPaymentId}:${clean(payment.status)}:${occurredAt}`,
    eventType: type,
    providerPaymentId,
    paymentIntentId,
    amount: Number(amount.toFixed(2)),
    currency: 'BRL',
    method: 'pix',
    occurredAt,
    signatureVerified: true,
    kyrubStoreId,
    kyrubPaymentId,
  };
};
