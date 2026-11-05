import { verifyMercadoPagoWebhookSignatureWithSecret } from './mercadoPagoPixProvider.js';

/** Platform billing only. Never falls back to marketplace credentials or merchant OAuth. */
export const officialPlanPixRequest = async <T = any>(path: string, init: RequestInit = {}): Promise<T> => {
  const token = process.env.KYRUB_BILLING_MERCADO_PAGO_ACCESS_TOKEN?.trim();
  if (!token || !process.env.KYRUB_BILLING_MERCADO_PAGO_WEBHOOK_SECRET?.trim()) {
    throw new Error('OFFICIAL_PIX_NOT_CONFIGURED');
  }
  if (!/^\/(users\/me|v1\/payments(?:\/\d+|\/search\?.*)?)$/.test(path)) throw new Error('OFFICIAL_PIX_PROVIDER_PATH_INVALID');
  const response = await fetch(`https://api.mercadopago.com${path}`, {
    ...init, signal: AbortSignal.timeout(20000),
    headers: { ...init.headers, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  });
  if (!response.ok) throw new Error(`OFFICIAL_PIX_PROVIDER_HTTP_${response.status}`);
  return response.json() as Promise<T>;
};

export const verifyOfficialPlanPixSignature = (headers: Record<string, string | string[] | undefined>, dataId: string) =>
  verifyMercadoPagoWebhookSignatureWithSecret({ headers, dataId }, process.env.KYRUB_BILLING_MERCADO_PAGO_WEBHOOK_SECRET || '');

export const officialPlanPixAccount = async (): Promise<string> => {
  const expected = process.env.KYRUB_BILLING_MERCADO_PAGO_COLLECTOR_ID?.trim() || '';
  if (!/^\d+$/.test(expected)) throw new Error('OFFICIAL_PIX_ACCOUNT_NOT_CONFIGURED');
  const account = await officialPlanPixRequest('/users/me');
  if (String(account.id) !== expected) throw new Error('OFFICIAL_PIX_ACCOUNT_INVALID');
  return String(account.id);
};
