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

export const redeemKyrubCoupon = async (
  user: Pick<User, 'getIdToken'>,
  code: string
): Promise<CouponRedemptionResult> => {
  const token = await user.getIdToken(true);
  const response = await fetch('/api/plan-control?op=store.coupon.redeem', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ code }),
  });
  const body = await response.json().catch(() => null) as
    | CouponRedemptionResult
    | { error?: unknown; code?: unknown }
    | null;
  if (!response.ok) {
    const error = new Error(
      body && 'error' in body && typeof body.error === 'string'
        ? body.error
        : 'Não foi possível resgatar este cupom.'
    ) as Error & { code?: string };
    if (body && 'code' in body && typeof body.code === 'string') {
      error.code = body.code;
    }
    throw error;
  }
  return body as CouponRedemptionResult;
};
