import type { KyrubCommercialPlanId } from '../../shared/kyrubCommercialPlans.js';

/**
 * Classifies a checkout item before choosing a payment provider.
 * Only an explicitly tagged Kyrub platform plan sold by the designated
 * Official Store can enter platform billing. Never infer from a product name.
 */
export type CheckoutBillingRoute =
  | { kind: 'merchant'; storeId: string }
  | { kind: 'platform-plan'; plan: 'pro' | 'business' }
  | { kind: 'free-plan'; plan: 'free' };

export class OfficialPlanCheckoutRouteError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'OfficialPlanCheckoutRouteError';
  }
}

export const resolveCheckoutBillingRoute = (input: {
  sellerStoreId: string;
  officialStoreId: string | null;
  platformPlanId?: KyrubCommercialPlanId | null;
}): CheckoutBillingRoute => {
  const sellerStoreId = input.sellerStoreId.trim();
  if (!sellerStoreId) {
    throw new OfficialPlanCheckoutRouteError('SELLER_REQUIRED', 'A loja vendedora não foi identificada.');
  }

  // An absent tag means an ordinary product; a malformed explicit tag must fail closed.
  if (input.platformPlanId === null || input.platformPlanId === undefined) {
    return { kind: 'merchant', storeId: sellerStoreId };
  }
  if (!['free', 'pro', 'business'].includes(input.platformPlanId)) {
    throw new OfficialPlanCheckoutRouteError('INVALID_PLATFORM_PLAN', 'Plano Kyrub inválido.');
  }

  if (!input.officialStoreId || sellerStoreId !== input.officialStoreId.trim()) {
    throw new OfficialPlanCheckoutRouteError(
      'PLATFORM_PLAN_OFFICIAL_STORE_ONLY',
      'Os planos Kyrub só podem ser comercializados pela Loja Oficial.'
    );
  }

  if (input.platformPlanId === 'free') return { kind: 'free-plan', plan: 'free' };
  if (input.platformPlanId === 'pro' || input.platformPlanId === 'business') {
    return { kind: 'platform-plan', plan: input.platformPlanId };
  }

  throw new OfficialPlanCheckoutRouteError('INVALID_PLATFORM_PLAN', 'Plano Kyrub inválido.');
};
