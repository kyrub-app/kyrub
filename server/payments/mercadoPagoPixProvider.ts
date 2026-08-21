import { createHmac, timingSafeEqual } from 'node:crypto';
import type { CanonicalPaymentIntent } from '../../src/utils/canonicalPaymentIntent';
import type {
  PaymentProviderEventType,
  VerifiedPaymentProviderEvent,
} from '../../src/utils/paymentProvider';

const MERCADO_PAGO_API_BASE = 'https://api.mercadopago.com';

export interface MercadoPagoPixCheckout {
  provider: 'mercado-pago';
  providerPaymentId: string;
  status: string;
  qrCode: string;
  qrCodeBase64: string;
  ticketUrl: string;
  expiresAt: string;
}

interface MercadoPagoPayment {
  id?: string | number;
  status?: string;
  status_detail?: string;
  transaction_amount?: number;
  currency_id?: string;
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

export interface VerifiedMercadoPagoPaymentEvent
  extends VerifiedPaymentProviderEvent {
  kyrubStoreId: string;
  kyrubPaymentId: string;
}

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : String(value ?? '').trim();

const accessToken = (): string => clean(process.env.MERCADO_PAGO_ACCESS_TOKEN);
const webhookSecret = (): string => clean(process.env.MERCADO_PAGO_WEBHOOK_SECRET);

export const isMercadoPagoPixConfigured = (): boolean => Boolean(accessToken());
export const isMercadoPagoWebhookConfigured = (): boolean =>
  Boolean(webhookSecret() && accessToken());

const mercadoPagoRequest = async <T>(
  path: string,
  init: RequestInit = {}
): Promise<T> => {
  const token = accessToken();
  if (!token) throw new Error('MERCADO_PAGO_NOT_CONFIGURED');

  const response = await fetch(`${MERCADO_PAGO_API_BASE}${path}`, {
    ...init,
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${token}`,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  });

  const payload = (await response.json().catch(() => ({}))) as T &
    Record<string, unknown>;
  if (!response.ok) {
    const message =
      clean(payload.message) || clean(payload.error) || `HTTP_${response.status}`;
    throw new Error(`MERCADO_PAGO_API_ERROR:${message}`);
  }
  return payload;
};

export const createMercadoPagoPixPayment = async (input: {
  intent: CanonicalPaymentIntent;
  paymentId: string;
}): Promise<MercadoPagoPixCheckout> => {
  const { intent, paymentId } = input;
  const payerEmail = intent.orderDraft.buyerEmail.trim();
  if (!payerEmail) throw new Error('MERCADO_PAGO_PAYER_EMAIL_REQUIRED');

  const payment = await mercadoPagoRequest<MercadoPagoPayment>('/v1/payments', {
    method: 'POST',
    headers: {
      'X-Idempotency-Key': intent.idempotencyKey,
    },
    body: JSON.stringify({
      transaction_amount: intent.amount,
      description: `Pedido Kyrub ${intent.orderDraft.draftId}`,
      payment_method_id: 'pix',
      payer: { email: payerEmail },
      date_of_expiration: intent.expiresAt,
      external_reference: intent.id,
      metadata: {
        kyrub_store_id: intent.storeId,
        kyrub_payment_id: paymentId,
        kyrub_payment_intent_id: intent.id,
      },
    }),
  });

  return normalizePixCheckout(payment);
};

export const getMercadoPagoPayment = async (
  providerPaymentId: string
): Promise<MercadoPagoPayment> =>
  mercadoPagoRequest<MercadoPagoPayment>(
    `/v1/payments/${encodeURIComponent(providerPaymentId)}`
  );

export const getMercadoPagoPixCheckout = async (
  providerPaymentId: string
): Promise<MercadoPagoPixCheckout> =>
  normalizePixCheckout(await getMercadoPagoPayment(providerPaymentId));

const normalizePixCheckout = (
  payment: MercadoPagoPayment
): MercadoPagoPixCheckout => {
  const providerPaymentId = clean(payment.id);
  if (!providerPaymentId) throw new Error('MERCADO_PAGO_PAYMENT_ID_MISSING');
  const transactionData = payment.point_of_interaction?.transaction_data;
  return {
    provider: 'mercado-pago',
    providerPaymentId,
    status: clean(payment.status),
    qrCode: clean(transactionData?.qr_code),
    qrCodeBase64: clean(transactionData?.qr_code_base64),
    ticketUrl: clean(transactionData?.ticket_url),
    expiresAt: clean(payment.date_of_expiration),
  };
};

const headerValue = (
  headers: Record<string, string | string[] | undefined>,
  name: string
): string => {
  const found =
    headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()];
  return Array.isArray(found) ? found[0] ?? '' : found ?? '';
};

export const verifyMercadoPagoWebhookSignature = (input: {
  headers: Record<string, string | string[] | undefined>;
  dataId: string;
}): void => {
  const secret = webhookSecret();
  if (!secret) throw new Error('MERCADO_PAGO_WEBHOOK_NOT_CONFIGURED');
  const xSignature = headerValue(input.headers, 'x-signature');
  const xRequestId = headerValue(input.headers, 'x-request-id');
  if (!xSignature) throw new Error('MERCADO_PAGO_SIGNATURE_MISSING');

  const parts = new Map(
    xSignature.split(',').flatMap(part => {
      const separator = part.indexOf('=');
      if (separator < 0) return [];
      return [
        [
          part.slice(0, separator).trim(),
          part.slice(separator + 1).trim(),
        ] as const,
      ];
    })
  );
  const timestamp = parts.get('ts') ?? '';
  const providedHash = parts.get('v1') ?? '';
  if (!timestamp || !/^[a-f0-9]{64}$/i.test(providedHash)) {
    throw new Error('MERCADO_PAGO_SIGNATURE_INVALID');
  }

  const normalizedDataId = input.dataId.trim().toLowerCase();
  const manifest = [
    normalizedDataId ? `id:${normalizedDataId};` : '',
    xRequestId ? `request-id:${xRequestId};` : '',
    `ts:${timestamp};`,
  ].join('');
  const expectedHash = createHmac('sha256', secret)
    .update(manifest)
    .digest('hex');
  const expected = Buffer.from(expectedHash, 'hex');
  const provided = Buffer.from(providedHash, 'hex');
  if (
    expected.length !== provided.length ||
    !timingSafeEqual(expected, provided)
  ) {
    throw new Error('MERCADO_PAGO_SIGNATURE_INVALID');
  }
};

const eventTypeForPayment = (
  payment: MercadoPagoPayment
): PaymentProviderEventType | null => {
  const status = clean(payment.status).toLowerCase();
  const detail = clean(payment.status_detail).toLowerCase();
  if (status === 'approved') return 'payment.paid';
  if (status === 'rejected') return 'payment.failed';
  if (status === 'cancelled') {
    return detail.includes('expired') ? 'payment.expired' : 'payment.failed';
  }
  if (status === 'refunded' || status === 'charged_back') {
    return 'refund.succeeded';
  }
  return null;
};

export const verifiedMercadoPagoPaymentEvent = async (input: {
  headers: Record<string, string | string[] | undefined>;
  dataId: string;
}): Promise<VerifiedMercadoPagoPaymentEvent | null> => {
  verifyMercadoPagoWebhookSignature(input);
  const payment = await getMercadoPagoPayment(input.dataId);
  const eventType = eventTypeForPayment(payment);
  if (!eventType) return null;

  const metadata = payment.metadata ?? {};
  const paymentIntentId =
    clean(metadata.kyrub_payment_intent_id) || clean(payment.external_reference);
  const kyrubStoreId = clean(metadata.kyrub_store_id);
  const kyrubPaymentId = clean(metadata.kyrub_payment_id);
  const providerPaymentId = clean(payment.id);
  const amount = Number(payment.transaction_amount);
  const occurredAt =
    clean(payment.date_last_updated) ||
    clean(payment.date_created) ||
    new Date().toISOString();
  if (
    !paymentIntentId ||
    !kyrubStoreId ||
    !kyrubPaymentId ||
    !providerPaymentId ||
    !Number.isFinite(amount) ||
    amount <= 0
  ) {
    throw new Error('MERCADO_PAGO_PAYMENT_METADATA_INVALID');
  }

  return {
    provider: 'mercado-pago',
    eventId: `${providerPaymentId}:${clean(payment.status)}:${occurredAt}`,
    eventType,
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
