import type { User } from 'firebase/auth';

export interface MercadoPagoStoreConnectionStatus {
  provider: 'mercado_pago';
  platformConfigured: boolean;
  connected: boolean;
  externalAccountId: string;
  expiresAt: string;
}

const json = async <T>(response: Response): Promise<T> => {
  const payload = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || 'Não foi possível operar a conexão Mercado Pago.');
  return payload;
};

const request = async <T>(user: User, path: string, init: RequestInit = {}): Promise<T> => {
  const token = await user.getIdToken();
  return json<T>(await fetch(path, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  }));
};

export const loadMercadoPagoStoreConnectionStatus = (
  user: User
): Promise<MercadoPagoStoreConnectionStatus> =>
  request(user, `/api/store-connections/mercado-pago/${encodeURIComponent(user.uid)}/status`);

export const beginMercadoPagoStoreConnection = async (user: User): Promise<void> => {
  const result = await request<{ authorizationUrl: string }>(
    user,
    `/api/store-connections/mercado-pago/${encodeURIComponent(user.uid)}/authorize`,
    { method: 'POST', body: '{}' }
  );
  if (!/^https:\/\/auth\.mercadopago\.com\//i.test(result.authorizationUrl)) {
    throw new Error('A autorização retornada pelo Mercado Pago é inválida.');
  }
  window.location.assign(result.authorizationUrl);
};

export const validateMercadoPagoStoreConnection = (
  user: User
): Promise<{ ok: true; externalAccountId: string }> =>
  request(
    user,
    `/api/store-connections/mercado-pago/${encodeURIComponent(user.uid)}/validate`,
    { method: 'POST', body: '{}' }
  );

export const disconnectMercadoPagoStoreConnection = (
  user: User
): Promise<{ disconnected: true }> =>
  request(
    user,
    `/api/store-connections/mercado-pago/${encodeURIComponent(user.uid)}/disconnect`,
    { method: 'POST', body: '{}' }
  );
