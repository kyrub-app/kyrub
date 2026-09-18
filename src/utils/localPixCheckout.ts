import { auth } from './firebase';

export interface LocalPixCheckout {
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

interface LocalPaymentIntentResult {
  paymentIntentId: string;
  paymentId: string;
  orderId: string;
  status: 'pending';
  amount: number;
  currency: 'BRL';
  method: 'pix';
  context: 'table' | 'pos';
  expiresAt: string;
  providerReady: false;
  duplicate: boolean;
}

interface PendingLocalPixAttempt {
  paymentIntentId: string;
  paymentId: string;
  orderId: string;
  amount: number;
  currency: 'BRL';
  context: 'table' | 'pos';
  providerAttached: boolean;
  checkout: Omit<LocalPixCheckout, 'paymentIntentId' | 'paymentId' | 'orderId' | 'amount' | 'currency' | 'context'> | null;
}

const currentToken = async (): Promise<string> => {
  const user = auth.currentUser;
  if (!user) throw new Error('Faça login novamente para gerar o Pix.');
  return user.getIdToken();
};

const requestJson = async <T>(url: string, init: RequestInit = {}): Promise<T> => {
  const token = await currentToken();
  const response = await fetch(url, {
    ...init,
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${token}`,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
    cache: 'no-store',
  });
  const payload = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error || 'Não foi possível preparar o Pix deste pedido.');
  }
  return payload;
};

const idempotencyKey = (orderId: string): string => {
  const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `local-pix:${orderId}:${random}`;
};

const attachPix = async (input: {
  storeId: string;
  paymentIntentId: string;
  paymentId: string;
}): Promise<LocalPixCheckout> =>
  requestJson<LocalPixCheckout>('/api/local-attendance/payment-intents/mercado-pago-pix', {
    method: 'POST',
    body: JSON.stringify(input),
  });

export const openOrCreateLocalPixCheckout = async (input: {
  storeId: string;
  orderId: string;
}): Promise<LocalPixCheckout> => {
  const params = new URLSearchParams({
    storeId: input.storeId,
    orderId: input.orderId,
  });
  const recovered = await requestJson<{ attempt: PendingLocalPixAttempt | null }>(
    `/api/local-attendance/payment-intents/pending-pix?${params.toString()}`
  );

  if (recovered.attempt) {
    const attempt = recovered.attempt;
    if (attempt.providerAttached && attempt.checkout) {
      return {
        ...attempt.checkout,
        paymentIntentId: attempt.paymentIntentId,
        paymentId: attempt.paymentId,
        orderId: attempt.orderId,
        amount: attempt.amount,
        currency: attempt.currency,
        context: attempt.context,
      };
    }
    return attachPix({
      storeId: input.storeId,
      paymentIntentId: attempt.paymentIntentId,
      paymentId: attempt.paymentId,
    });
  }

  const intent = await requestJson<LocalPaymentIntentResult>(
    '/api/local-attendance/payment-intents',
    {
      method: 'POST',
      body: JSON.stringify({
        storeId: input.storeId,
        orderId: input.orderId,
        idempotencyKey: idempotencyKey(input.orderId),
      }),
    }
  );

  return attachPix({
    storeId: input.storeId,
    paymentIntentId: intent.paymentIntentId,
    paymentId: intent.paymentId,
  });
};
