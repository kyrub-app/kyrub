import type { User } from 'firebase/auth';
import type {
  StoreSubscriberCrmReconciliationResult,
  StoreSubscriberRegistrySummary,
} from '../../shared/storeSubscriberRegistry';

const json = async <T>(response: Response): Promise<T> => {
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (!contentType.includes('application/json')) {
    throw new Error('O serviço de assinantes respondeu em um formato inesperado.');
  }
  const payload = await response.json() as T & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error || 'Não foi possível carregar os assinantes da loja.');
  }
  return payload;
};

const authorization = async (user: User): Promise<string> =>
  `Bearer ${await user.getIdToken()}`;

export const loadStoreSubscriberRegistry = async (
  user: User,
  storeId: string
): Promise<StoreSubscriberRegistrySummary> =>
  json(await fetch(
    `/api/plan-control?op=merchant.subscribers.list&storeId=${encodeURIComponent(storeId)}`,
    {
      cache: 'no-store',
      headers: { Authorization: await authorization(user) },
    }
  ));

export const reconcileStoreSubscribersWithCrm = async (
  user: User,
  storeId: string
): Promise<StoreSubscriberCrmReconciliationResult> =>
  json(await fetch('/api/plan-control?op=merchant.subscribers.reconcile', {
    method: 'POST',
    cache: 'no-store',
    headers: {
      Authorization: await authorization(user),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ storeId }),
  }));
