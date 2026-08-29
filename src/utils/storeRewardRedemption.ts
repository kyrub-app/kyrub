import { auth } from './firebase';

export interface PublicStoreReward {
  id: string;
  title: string;
  description: string;
  costPoints: number;
  discountType: 'percentage' | 'fixed';
  discountValue: number;
  productIds: string[];
  endsAt: string;
}

export interface StoreRewardRedemptionResult {
  redemptionId: string;
  rewardId: string;
  storeId: string;
  customerId: string;
  costPoints: number;
  balanceBefore: number;
  balanceAfter: number;
  voucherCode: string;
  voucherPromotionId: string;
  voucherEndsAt: string;
  duplicate: boolean;
}

const clean = (value: string): string => value.trim();

const responseError = async (response: Response): Promise<Error> => {
  try {
    const body = await response.json() as { error?: unknown };
    if (typeof body.error === 'string' && body.error.trim()) {
      return new Error(body.error.trim());
    }
  } catch {
    // Fall through to the stable generic message below.
  }
  return new Error('Não foi possível processar a recompensa.');
};

export const listStoreRewards = async (
  storeIdInput: string
): Promise<PublicStoreReward[]> => {
  const storeId = clean(storeIdInput);
  if (!storeId) return [];
  const response = await fetch(
    `/api/store-rewards/public?storeId=${encodeURIComponent(storeId)}`,
    { method: 'GET', headers: { accept: 'application/json' } }
  );
  if (!response.ok) throw await responseError(response);
  const body = await response.json() as { rewards?: unknown };
  return Array.isArray(body.rewards)
    ? body.rewards as PublicStoreReward[]
    : [];
};

export const redeemStoreRewardForCurrentUser = async (input: {
  storeId: string;
  rewardId: string;
}): Promise<StoreRewardRedemptionResult> => {
  const storeId = clean(input.storeId);
  const rewardId = clean(input.rewardId);
  const user = auth.currentUser;
  if (!user) throw new Error('Faça login novamente.');
  if (!storeId || !rewardId) throw new Error('Recompensa não identificada.');

  const idToken = await user.getIdToken();
  const response = await fetch('/api/store-rewards/redeem', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ storeId, rewardId }),
  });
  if (!response.ok) throw await responseError(response);
  return response.json() as Promise<StoreRewardRedemptionResult>;
};
