import type { User } from 'firebase/auth';

export interface PromotionalProGrantResult {
  status: 'granted' | 'already_granted';
  targetUserId: string;
  storeId: string;
  canonicalStoreId: string | null;
  plan: 'pro';
  source: 'promotional';
  promotionId: 'founding_pro_001';
  expiresAt: null;
}

const safeTargetUserId = (value: string): string => {
  const targetUserId = value.trim();
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(targetUserId)) {
    throw new Error('Informe um UID válido para a loja que receberá a cortesia.');
  }
  return targetUserId;
};

export const grantFoundingProPromotion = async (
  authenticatedUser: Pick<User, 'getIdToken'>,
  rawTargetUserId: string
): Promise<PromotionalProGrantResult> => {
  const targetUserId = safeTargetUserId(rawTargetUserId);
  const token = await authenticatedUser.getIdToken();
  const response = await fetch('/api/admin/store-entitlements/promotional-pro', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ targetUserId }),
  });

  const body = await response.json().catch(() => null) as
    | PromotionalProGrantResult
    | { error?: string; code?: string }
    | null;

  if (!response.ok) {
    const message = body && 'error' in body && typeof body.error === 'string'
      ? body.error
      : 'Não foi possível conceder a cortesia Pro.';
    throw new Error(message);
  }

  if (
    !body ||
    !('plan' in body) ||
    body.plan !== 'pro' ||
    !('source' in body) ||
    body.source !== 'promotional'
  ) {
    throw new Error('A resposta da concessão promocional é inválida.');
  }

  return body as PromotionalProGrantResult;
};
