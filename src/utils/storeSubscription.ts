import { auth } from './firebase';
import type {
  StoreSubscriptionCheckoutResult,
  StoreSubscriptionSnapshot,
} from '../../shared/storeSubscriptionBilling';

const json = async <T>(response: Response): Promise<T> => {
  const type = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (!type.includes('application/json')) {
    throw new Error('O serviço de assinaturas respondeu em um formato inesperado.');
  }
  const payload = await response.json() as T & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error || 'Não foi possível atualizar a assinatura.');
  }
  return payload;
};

const authorization = async (): Promise<string> => {
  const user = auth.currentUser;
  if (!user) throw new Error('Faça login novamente para gerenciar a assinatura.');
  return `Bearer ${await user.getIdToken()}`;
};

const post = async <T>(operation: string, body: Record<string, string>): Promise<T> =>
  json(await fetch(`/api/plan-control?op=${encodeURIComponent(operation)}`, {
    method: 'POST',
    cache: 'no-store',
    headers: {
      Authorization: await authorization(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  }));

export const createMerchantSubscriptionCheckout = async (input: {
  storeId: string;
  productId: string;
}): Promise<StoreSubscriptionCheckoutResult> =>
  post('merchant.subscription.checkout', {
    storeId: input.storeId.trim(),
    productId: input.productId.trim(),
  });

export const loadMerchantSubscription = async (input: {
  storeId: string;
  subscriptionId: string;
}): Promise<StoreSubscriptionSnapshot> =>
  post('merchant.subscription.state', {
    storeId: input.storeId.trim(),
    subscriptionId: input.subscriptionId.trim(),
  });

export const reconcileMerchantSubscription = async (input: {
  storeId: string;
  subscriptionId: string;
}): Promise<StoreSubscriptionSnapshot> =>
  post('merchant.subscription.reconcile', {
    storeId: input.storeId.trim(),
    subscriptionId: input.subscriptionId.trim(),
  });

export const cancelMerchantSubscription = async (input: {
  storeId: string;
  subscriptionId: string;
}): Promise<StoreSubscriptionSnapshot> =>
  post('merchant.subscription.cancel', {
    storeId: input.storeId.trim(),
    subscriptionId: input.subscriptionId.trim(),
  });
