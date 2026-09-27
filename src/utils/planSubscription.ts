import { auth } from './firebase';
import type { KyrubCommercialPlanId } from '../../shared/kyrubCommercialPlans';
import type {
  KyrubPlanBillingAvailability,
  KyrubPlanCheckoutResult,
  KyrubPlanSubscriptionState,
} from '../../shared/kyrubPlanBilling';

const json = async <T>(response: Response): Promise<T> => {
  const type = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (!type.includes('application/json')) {
    throw new Error('O serviço de planos respondeu em um formato inesperado.');
  }
  const payload = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || 'Não foi possível atualizar sua assinatura.');
  return payload;
};

const authorization = async (): Promise<string> => {
  const user = auth.currentUser;
  if (!user) throw new Error('Faça login novamente para gerenciar sua assinatura.');
  return `Bearer ${await user.getIdToken()}`;
};

export const loadPlanBillingAvailability = async (): Promise<KyrubPlanBillingAvailability> =>
  json(await fetch('/api/plan-control?op=plans.billing', { cache: 'no-store' }));

export const loadOwnPlanSubscriptionState = async (): Promise<KyrubPlanSubscriptionState> =>
  json(await fetch('/api/plan-control?op=store.subscription.state', {
    cache: 'no-store',
    headers: { Authorization: await authorization() },
  }));

export const createPaidPlanCheckout = async (
  plan: Exclude<KyrubCommercialPlanId, 'free'>
): Promise<KyrubPlanCheckoutResult> =>
  json(await fetch('/api/plan-control?op=store.subscription.checkout', {
    method: 'POST',
    headers: {
      Authorization: await authorization(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ plan }),
  }));

export const reconcilePaidPlanSubscription = async (): Promise<KyrubPlanSubscriptionState> =>
  json(await fetch('/api/plan-control?op=store.subscription.reconcile', {
    method: 'POST',
    headers: { Authorization: await authorization() },
  }));

export const cancelPaidPlanSubscription = async (): Promise<KyrubPlanSubscriptionState> =>
  json(await fetch('/api/plan-control?op=store.subscription.cancel', {
    method: 'POST',
    headers: { Authorization: await authorization() },
  }));
