import { auth } from './firebase';

export interface NinetyNineFoodConnectionStatus {
  configured: boolean;
  provider: '99food';
  status: 'not-configured' | 'connected' | 'attention' | 'disabled';
  externalStoreId: string;
  accountLabel: string;
  routingTarget: string;
  environment: 'sandbox' | 'production';
  baseUrl: string;
  webhookUrl: string;
  lastError: string;
  lastVerifiedAt: string;
  lastWebhookAt: string;
  lastPollAt: string;
}

export interface NinetyNineFoodConnectRequest {
  externalStoreId: string;
  accountLabel: string;
  routingTarget: string;
  environment: 'sandbox' | 'production';
  baseUrl: string;
  tokenUrl?: string;
  clientId: string;
  clientSecret: string;
}

const authorizedRequest = async <T>(
  path: string,
  init: RequestInit = {}
): Promise<T> => {
  const user = auth.currentUser;
  if (!user) throw new Error('Faça login novamente.');
  const token = await user.getIdToken();
  const response = await fetch(path, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
  });

  if (response.status === 204) return undefined as T;
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      typeof payload.error === 'string'
        ? payload.error
        : 'A integração 99Food não respondeu corretamente.'
    );
  }
  return payload as T;
};

export const getNinetyNineFoodConnectionStatus = (): Promise<NinetyNineFoodConnectionStatus> =>
  authorizedRequest('/api/integrations/99food/status');

export const connectNinetyNineFood = (
  input: NinetyNineFoodConnectRequest
): Promise<NinetyNineFoodConnectionStatus> =>
  authorizedRequest('/api/integrations/99food/connect', {
    method: 'POST',
    body: JSON.stringify(input),
  });

export const disconnectNinetyNineFood = (): Promise<void> =>
  authorizedRequest('/api/integrations/99food/connection', {
    method: 'DELETE',
  });

export const pollNinetyNineFood = (): Promise<{
  received: number;
  processed: number;
}> => authorizedRequest('/api/integrations/99food/poll', { method: 'POST' });

export const sendNinetyNineFoodOrderStatus = (
  externalOrderId: string,
  status: string,
  reason = ''
): Promise<void> =>
  authorizedRequest(
    `/api/integrations/99food/orders/${encodeURIComponent(externalOrderId)}/status`,
    {
      method: 'POST',
      body: JSON.stringify({ status, reason }),
    }
  );
