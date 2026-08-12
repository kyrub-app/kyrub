import type { User } from 'firebase/auth';

export type CouponRedemptionResult = {
  status: 'redeemed';
  code: string;
  storeId: string;
  plan: 'pro' | 'business';
  planVersion: number;
  benefitEndsAt: string | null;
  discountType: 'percent' | 'fixed_brl';
  discountValue: number;
};

export type StoreEntitlementReconciliationResult = {
  status: 'none' | 'active' | 'expired';
  changed: boolean;
  plan: 'free' | 'pro' | 'business' | null;
  benefitEndsAt: string | null;
};

const authorizedPlanPost = async (
  user: Pick<User, 'getIdToken'>,
  operation: string,
  body: Record<string, unknown> = {}
): Promise<Response> => {
  const token = await user.getIdToken(true);
  return fetch(`/api/plan-control?op=${encodeURIComponent(operation)}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
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

export const redeemKyrubCoupon = async (
  user: Pick<User, 'getIdToken'>,
  code: string
): Promise<CouponRedemptionResult> => {
  const response = await authorizedPlanPost(
    user,
    'store.coupon.redeem',
    { code }
  );
  if (!response.ok) {
    throw await apiError(response, 'Não foi possível resgatar este cupom.');
  }
  return response.json() as Promise<CouponRedemptionResult>;
};

export const reconcileOwnStoreEntitlement = async (
  user: Pick<User, 'getIdToken'>
): Promise<StoreEntitlementReconciliationResult> => {
  const response = await authorizedPlanPost(
    user,
    'store.entitlement.reconcile'
  );
  if (!response.ok) {
    throw await apiError(
      response,
      'Não foi possível atualizar o benefício do plano agora.'
    );
  }
  return response.json() as Promise<StoreEntitlementReconciliationResult>;
};
