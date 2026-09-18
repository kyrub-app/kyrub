import { auth } from './firebase';

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
  providerReady: boolean;
}

export interface LocalPaymentIntentResult extends PendingLocalPaymentRecovery {
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
  const id = orderId.trim();
  if (!id) throw new Error('Pedido inválido para iniciar o Pix.');
  const random = globalThis.crypto?.randomUUID?.();
  if (!random) throw new Error('Não foi possível criar uma tentativa segura de pagamento.');
  return `local-pix:${id}:${random}`;
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
}): Promise<LocalPaymentIntentResult> =>
  json<LocalPaymentIntentResult>(
    await authorizedFetch('/api/local-attendance/payment-intents', {
      method: 'POST',
      body: JSON.stringify({
        storeId: input.storeId,
        orderId: input.orderId,
        idempotencyKey: input.idempotencyKey,
      }),
    }),
    'Não foi possível iniciar o pagamento Pix.'
  );

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
    'Não foi possível gerar ou recuperar o Pix.'
  );
