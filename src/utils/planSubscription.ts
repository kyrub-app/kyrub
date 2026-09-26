import type { User } from 'firebase/auth';
import type {
  KyrubPaidPlanId,
  KyrubPlanSubscriptionCheckoutResult,
  KyrubPlanSubscriptionPublicSnapshot,
} from '../../shared/kyrubPlanSubscriptions';

export type OwnPlanSubscriptionStatus = {
  billingAvailable: boolean;
  subscription: KyrubPlanSubscriptionPublicSnapshot | null;
};

const authorizedRequest = async (
  user: Pick<User, 'getIdToken'>,
  operation: string,
  method: 'GET' | 'POST',
  body?: Record<string, unknown>
): Promise<Response> => {
  const token = await user.getIdToken(true);
  return fetch(`/api/plan-control?op=${encodeURIComponent(operation)}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
};

const apiError = async (response: Response, fallback: string): Promise<Error> => {
  const body = await response.json().catch(() => null) as
    | { error?: unknown; code?: unknown }
    | null;
  const error = new Error(
    typeof body?.error === 'string' ? body.error : fallback
  ) as Error & { code?: string };
  if (typeof body?.code === 'string') error.code = body.code;
  return error;
};

export const loadOwnPlanSubscription = async (
  user: Pick<User, 'getIdToken'>
): Promise<OwnPlanSubscriptionStatus> => {
  const response = await authorizedRequest(
    user,
    'store.subscription.status',
    'GET'
  );
  if (!response.ok) {
    throw await apiError(response, 'Não foi possível consultar sua assinatura.');
  }
  return response.json() as Promise<OwnPlanSubscriptionStatus>;
};

export const createPlanSubscriptionCheckout = async (
  user: Pick<User, 'getIdToken'>,
  plan: KyrubPaidPlanId
): Promise<KyrubPlanSubscriptionCheckoutResult> => {
  const response = await authorizedRequest(
    user,
    'store.subscription.checkout',
    'POST',
    { plan }
  );
  if (!response.ok) {
    throw await apiError(response, 'Não foi possível iniciar a contratação.');
  }
  return response.json() as Promise<KyrubPlanSubscriptionCheckoutResult>;
};

export const refreshOwnPlanSubscription = async (
  user: Pick<User, 'getIdToken'>
): Promise<OwnPlanSubscriptionStatus> => {
  const response = await authorizedRequest(
    user,
    'store.subscription.refresh',
    'POST'
  );
  if (!response.ok) {
    throw await apiError(response, 'Não foi possível atualizar sua assinatura.');
  }
  return response.json() as Promise<OwnPlanSubscriptionStatus>;
};

export const cancelOwnPlanSubscription = async (
  user: Pick<User, 'getIdToken'>
): Promise<OwnPlanSubscriptionStatus> => {
  const response = await authorizedRequest(
    user,
    'store.subscription.cancel',
    'POST'
  );
  if (!response.ok) {
    throw await apiError(response, 'Não foi possível cancelar sua assinatura.');
  }
  return response.json() as Promise<OwnPlanSubscriptionStatus>;
};
