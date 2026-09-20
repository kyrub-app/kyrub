import type { User } from 'firebase/auth';
import type { StoreOwnedPixKeyType } from '../../shared/storeOwnedPix';

export interface StoreOwnedPixConnectionStatus {
  provider: 'store-pix';
  configured: boolean;
  enabled: boolean;
  keyType: StoreOwnedPixKeyType | '';
  maskedKey: string;
  recipientName: string;
  recipientCity: string;
}

export interface StoreOwnedPixConfigurationInput {
  keyType: StoreOwnedPixKeyType;
  key: string;
  recipientName: string;
  recipientCity: string;
}

const json = async <T>(response: Response, fallback: string): Promise<T> => {
  const payload = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || fallback);
  return payload;
};

const request = async <T>(
  user: User,
  path: string,
  init: RequestInit = {}
): Promise<T> => {
  const token = await user.getIdToken();
  return json<T>(await fetch(path, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/json',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
    cache: 'no-store',
  }), 'Não foi possível operar o Pix próprio.');
};

const base = (user: User): string =>
  `/api/store-connections/pix-own/${encodeURIComponent(user.uid)}`;

export const loadStoreOwnedPixConnectionStatus = (
  user: User
): Promise<StoreOwnedPixConnectionStatus> =>
  request(user, `${base(user)}/status`);

export const saveStoreOwnedPixConnection = (
  user: User,
  input: StoreOwnedPixConfigurationInput
): Promise<StoreOwnedPixConnectionStatus> =>
  request(user, `${base(user)}/configuration`, {
    method: 'PUT',
    body: JSON.stringify({ ...input, enabled: true }),
  });

export const disableStoreOwnedPixConnection = (
  user: User
): Promise<{ disabled: true }> =>
  request(user, `${base(user)}/disable`, {
    method: 'POST',
    body: '{}',
  });
