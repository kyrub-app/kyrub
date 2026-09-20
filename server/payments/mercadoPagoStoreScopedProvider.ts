import { adminDb } from '../firebaseAdmin.js';
import type { ExistingOrderCanonicalPaymentIntent } from '../../src/utils/canonicalPaymentIntent.js';
import type { PaymentProviderEventType, VerifiedPaymentProviderEvent } from '../../src/utils/paymentProvider.js';
import { mercadoPagoStoreRequest } from '../integrations/mercadoPagoStoreOauthService.js';
import {
  loadMercadoPagoPaymentProviderBinding,
  saveMercadoPagoPaymentProviderBinding,
} from './paymentProviderBindingService.js';
import { verifyMercadoPagoWebhookSignature } from './mercadoPagoPixProvider.js';

interface MercadoPagoPayment {
  id?: string | number;
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

const legacyStoreIdForCanonicalStore = async (canonicalStoreId: string): Promise<string> => {
  const snapshot = await adminDb.doc(`stores/${canonicalStoreId}`).get();
  if (!snapshot.exists) throw new Error('MERCADO_PAGO_CANONICAL_STORE_NOT_FOUND');
  const data = snapshot.data() as Record<string, unknown>;
  const legacyStoreId = clean(data.legacyTenantId) || clean(data.ownerId);
  if (!legacyStoreId || clean(data.ownerId) !== legacyStoreId) {
    throw new Error('MERCADO_PAGO_CANONICAL_STORE_SCOPE_INVALID');
  }
  return legacyStoreId;
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
  intent: ExistingOrderCanonicalPaymentIntent;
  paymentId: string;
  payerEmail: string;
}) => {
  const legacyStoreId = await legacyStoreIdForCanonicalStore(input.intent.storeId);
  const payment = await mercadoPagoStoreRequest<MercadoPagoPayment>(legacyStoreId, '/v1/payments', {
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
  await saveMercadoPagoPaymentProviderBinding({
    provider: 'mercado-pago',
    providerPaymentId: normalized.providerPaymentId,
    legacyStoreId,
    canonicalStoreId: input.intent.storeId,
    paymentId: input.paymentId,
    paymentIntentId: input.intent.id,
  });
  return normalized;
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
