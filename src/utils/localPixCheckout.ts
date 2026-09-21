import { auth } from './firebase';
import type { StorePromotionQuote } from './storePromotions';

export type LocalPixProvider = 'mercado-pago' | 'store-pix';

export interface PendingLocalPaymentRecovery {
  paymentIntentId: string;
  paymentId: string;
  orderId: string;
  status: 'pending';
  amount: number;
  currency: 'BRL';
  method: 'pix';
  context: 'table' | 'pos';
  expiresAt: string;
  provider: '' | LocalPixProvider;
  providerReady: boolean;
}

export interface LocalPaymentIntentResult extends PendingLocalPaymentRecovery {
  provider: '';
  providerReady: false;
  duplicate: boolean;
}

export interface LocalMercadoPagoPixCheckout {
  provider: 'mercado-pago';
  providerPaymentId: string;
  status: string;
  qrCode: string;
  qrCodeBase64: string;
  ticketUrl: string;
  expiresAt: string;
  paymentIntentId: string;
  paymentId: string;
  orderId: string;
  amount: number;
  currency: 'BRL';
  context: 'table' | 'pos';
}

export interface LocalStoreOwnedPixCheckout {
  provider: 'store-pix';
  providerPaymentId: string;
  status: 'pending';
  qrCode: string;
  qrCodeBase64: string;
  ticketUrl: '';
  expiresAt: string;
  paymentIntentId: string;
  paymentId: string;
  orderId: string;
  amount: number;
  currency: 'BRL';
  context: 'table' | 'pos';
  confirmationAuthority: 'operator_attestation';
  bankVerifiedByKyrub: false;
}

export type LocalPixCheckout = LocalMercadoPagoPixCheckout | LocalStoreOwnedPixCheckout;

export interface LocalPaymentOptions {
  mercadoPagoConnected: boolean;
  storePixConfigured: boolean;
  storePixEnabled: boolean;
}

export interface LocalStoreOwnedPixConfirmation {
  confirmed: true;
  duplicate: boolean;
  paymentIntentId: string;
  paymentId: string;
  orderId: string;
  amount: number;
  currency: 'BRL';
  provider: 'store-pix';
  providerPaymentId: string;
  sourceAuthority: 'operator_attestation';
  bankVerifiedByKyrub: false;
  attestedAt: string;
}

const currentUser = () => {
  const user = auth.currentUser;
  if (!user) throw new Error('Faça login novamente para operar o pagamento.');
  return user;
};

const authorizedFetch = async (
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<Response> => {
  const token = await currentUser().getIdToken();
  return fetch(input, {
    ...init,
    headers: {
      accept: 'application/json',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
      authorization: `Bearer ${token}`,
    },
    cache: 'no-store',
  });
};

const json = async <T>(response: Response, fallback: string): Promise<T> => {
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(typeof payload.error === 'string' ? payload.error : fallback);
  }
  return payload as T;
};

export const newLocalPaymentAttemptKey = (orderId: string): string => {
  if (!orderId.trim()) throw new Error('Pedido inválido para iniciar o Pix.');
  const random = globalThis.crypto?.randomUUID?.();
  if (!random) throw new Error('Não foi possível criar uma tentativa segura de pagamento.');
  return `local-pix:${random}`;
};

export const loadLocalPaymentOptions = async (storeId: string): Promise<LocalPaymentOptions> => {
  const params = new URLSearchParams({ storeId });
  return json<LocalPaymentOptions>(
    await authorizedFetch(`/api/local-attendance/payment-options?${params.toString()}`),
    'Não foi possível consultar os modos de recebimento.'
  );
};

export const quoteLocalCoupon = async (input: {
  storeId: string;
  couponCode: string;
  items: Array<{ productId: string; quantity: number }>;
}): Promise<StorePromotionQuote> => {
  const couponCode = input.couponCode.trim();
  if (!couponCode) throw new Error('Digite um cupom para aplicar.');
  if (input.items.length === 0) {
    throw new Error('Selecione ao menos um item antes de aplicar o cupom.');
  }
  return json<StorePromotionQuote>(
    await authorizedFetch('/api/payments/coupons/quote', {
      method: 'POST',
      body: JSON.stringify({
        storeId: input.storeId,
        couponCode,
        items: input.items,
      }),
    }),
    'Não foi possível validar o cupom.'
  );
};

export const loadPendingLocalPayment = async (input: {
  storeId: string;
  orderId: string;
}): Promise<PendingLocalPaymentRecovery | null> => {
  const params = new URLSearchParams({
    storeId: input.storeId,
    orderId: input.orderId,
  });
  const payload = await json<{ payment: PendingLocalPaymentRecovery | null }>(
    await authorizedFetch(
      `/api/local-attendance/payment-intents/pending?${params.toString()}`
    ),
    'Não foi possível recuperar a cobrança pendente.'
  );
  return payload.payment ?? null;
};

export const createLocalPaymentIntent = async (input: {
  storeId: string;
  orderId: string;
  idempotencyKey: string;
  couponCode?: string;
}): Promise<LocalPaymentIntentResult> => {
  const couponCode = input.couponCode?.trim() ?? '';
  const result = await json<Omit<LocalPaymentIntentResult, 'provider'>>(
    await authorizedFetch('/api/local-attendance/payment-intents', {
      method: 'POST',
      body: JSON.stringify({
        storeId: input.storeId,
        orderId: input.orderId,
        idempotencyKey: input.idempotencyKey,
        ...(couponCode ? { couponCode } : {}),
      }),
    }),
    'Não foi possível iniciar o pagamento Pix.'
  );
  return { ...result, provider: '' };
};

export const attachLocalMercadoPagoPix = async (input: {
  storeId: string;
  paymentIntentId: string;
  paymentId: string;
}): Promise<LocalMercadoPagoPixCheckout> =>
  json<LocalMercadoPagoPixCheckout>(
    await authorizedFetch('/api/local-attendance/payment-intents/mercado-pago-pix', {
      method: 'POST',
      body: JSON.stringify({
        storeId: input.storeId,
        paymentIntentId: input.paymentIntentId,
        paymentId: input.paymentId,
      }),
    }),
    'Não foi possível gerar ou recuperar o Pix do Mercado Pago.'
  );

export const attachLocalStoreOwnedPix = async (input: {
  storeId: string;
  paymentIntentId: string;
  paymentId: string;
}): Promise<LocalStoreOwnedPixCheckout> =>
  json<LocalStoreOwnedPixCheckout>(
    await authorizedFetch('/api/local-attendance/payment-intents/store-pix', {
      method: 'POST',
      body: JSON.stringify({
        storeId: input.storeId,
        paymentIntentId: input.paymentIntentId,
        paymentId: input.paymentId,
      }),
    }),
    'Não foi possível gerar ou recuperar o Pix próprio.'
  );

export const confirmLocalStoreOwnedPix = async (input: {
  storeId: string;
  paymentIntentId: string;
  paymentId: string;
  providerPaymentId: string;
}): Promise<LocalStoreOwnedPixConfirmation> =>
  json<LocalStoreOwnedPixConfirmation>(
    await authorizedFetch('/api/local-attendance/payment-intents/store-pix/confirm', {
      method: 'POST',
      body: JSON.stringify({
        storeId: input.storeId,
        paymentIntentId: input.paymentIntentId,
        paymentId: input.paymentId,
        providerPaymentId: input.providerPaymentId,
        confirmedCredit: true,
      }),
    }),
    'Não foi possível registrar a confirmação manual do Pix.'
  );
