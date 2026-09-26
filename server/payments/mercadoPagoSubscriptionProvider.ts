import { resolveMercadoPagoAccessToken } from '../integrations/providerCredentialResolver.js';

const MERCADO_PAGO_API_BASE = 'https://api.mercadopago.com';

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : String(value ?? '').trim();

export interface MercadoPagoSubscription {
  id?: string;
  status?: string;
  reason?: string;
  external_reference?: string | number;
  init_point?: string;
  back_url?: string;
  payer_id?: string | number;
  payer_email?: string;
  next_payment_date?: string;
  date_created?: string;
  last_modified?: string;
  auto_recurring?: {
    frequency?: number;
    frequency_type?: string;
    transaction_amount?: number | string;
    currency_id?: string;
  };
}

export interface MercadoPagoSubscriptionCheckoutInput {
  planLabel: string;
  payerEmail: string;
  amountBRL: number;
  externalReference: string;
  backUrl: string;
}

export interface MercadoPagoSubscriptionRequest {
  path: '/preapproval';
  init: RequestInit;
}

const requireEmail = (value: unknown): string => {
  const email = clean(value).toLocaleLowerCase('pt-BR');
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
    throw new Error('MERCADO_PAGO_SUBSCRIPTION_PAYER_EMAIL_REQUIRED');
  }
  return email;
};

const requirePositiveAmount = (value: number): number => {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('MERCADO_PAGO_SUBSCRIPTION_AMOUNT_INVALID');
  }
  return Number(value.toFixed(2));
};

export const buildMercadoPagoSubscriptionCheckoutRequest = (
  input: MercadoPagoSubscriptionCheckoutInput
): MercadoPagoSubscriptionRequest => ({
  path: '/preapproval',
  init: {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      reason: `Plano Kyrub ${clean(input.planLabel)}`,
      external_reference: clean(input.externalReference),
      payer_email: requireEmail(input.payerEmail),
      auto_recurring: {
        frequency: 1,
        frequency_type: 'months',
        transaction_amount: requirePositiveAmount(input.amountBRL),
        currency_id: 'BRL',
      },
      back_url: clean(input.backUrl),
      status: 'pending',
    }),
  },
});

const mercadoPagoSubscriptionRequest = async <T>(
  path: string,
  init: RequestInit = {}
): Promise<T> => {
  const token = await resolveMercadoPagoAccessToken();
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
  const payload = (await response.json().catch(() => ({}))) as T & Record<string, unknown>;
  if (!response.ok) {
    const message = clean(payload.message) || clean(payload.error) || `HTTP_${response.status}`;
    throw new Error(`MERCADO_PAGO_SUBSCRIPTION_API_ERROR:${message}`);
  }
  return payload;
};

export const createMercadoPagoSubscriptionCheckout = async (
  input: MercadoPagoSubscriptionCheckoutInput
): Promise<MercadoPagoSubscription> => {
  const request = buildMercadoPagoSubscriptionCheckoutRequest(input);
  return mercadoPagoSubscriptionRequest<MercadoPagoSubscription>(
    request.path,
    request.init
  );
};

export const getMercadoPagoSubscription = async (
  providerSubscriptionId: string
): Promise<MercadoPagoSubscription> =>
  mercadoPagoSubscriptionRequest<MercadoPagoSubscription>(
    `/preapproval/${encodeURIComponent(clean(providerSubscriptionId))}`
  );

export const cancelMercadoPagoSubscription = async (
  providerSubscriptionId: string
): Promise<MercadoPagoSubscription> =>
  mercadoPagoSubscriptionRequest<MercadoPagoSubscription>(
    `/preapproval/${encodeURIComponent(clean(providerSubscriptionId))}`,
    {
      method: 'PUT',
      body: JSON.stringify({ status: 'canceled' }),
    }
  );
