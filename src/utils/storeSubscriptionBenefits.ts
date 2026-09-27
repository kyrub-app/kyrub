import type { User } from 'firebase/auth';
import type {
  ConsumeStoreSubscriptionBenefitResult,
  StoreSubscriptionBenefitCycle,
} from '../../shared/storeSubscriptionBenefits';

const json = async <T>(response: Response): Promise<T> => {
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (!contentType.includes('application/json')) {
    throw new Error('O serviço de benefícios respondeu em um formato inesperado.');
  }
  const payload = await response.json() as T & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error || 'Não foi possível atualizar os benefícios da assinatura.');
  }
  return payload;
};

const authorization = async (user: User): Promise<string> =>
  `Bearer ${await user.getIdToken()}`;

const post = async <T>(user: User, operation: string, body: Record<string, unknown>): Promise<T> =>
  json(await fetch(`/api/plan-control?op=${encodeURIComponent(operation)}`, {
    method: 'POST',
    cache: 'no-store',
    headers: {
      Authorization: await authorization(user),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  }));

export const loadStoreSubscriptionBenefitCycles = async (
  user: User,
  storeId: string,
  subscriptionId: string
): Promise<StoreSubscriptionBenefitCycle[]> =>
  post(user, 'merchant.subscription.benefits.list', {
    storeId: storeId.trim(),
    subscriptionId: subscriptionId.trim(),
  });

export const consumeStoreSubscriptionBenefit = async (
  user: User,
  input: {
    storeId: string;
    subscriptionId: string;
    units: number;
    operationId: string;
    note?: string;
  }
): Promise<ConsumeStoreSubscriptionBenefitResult> =>
  post(user, 'merchant.subscription.benefit.consume', {
    storeId: input.storeId.trim(),
    subscriptionId: input.subscriptionId.trim(),
    units: input.units,
    operationId: input.operationId.trim(),
    note: input.note?.trim() ?? '',
  });
