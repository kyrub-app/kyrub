import type { User } from 'firebase/auth';
import type {
  KyrubCouponCampaign,
  KyrubCouponStatus,
  KyrubPlanCatalogEntry,
  KyrubPlanFeatureStates,
} from '../../shared/kyrubPlanManagement';
import type { KyrubCommercialPlanId } from '../../shared/kyrubCommercialPlans';

export type AdminPlanManagementSnapshot = {
  plans: KyrubPlanCatalogEntry[];
  coupons: KyrubCouponCampaign[];
};

const responseError = async (response: Response, fallback: string): Promise<Error> => {
  const body = await response.json().catch(() => null) as
    | { error?: unknown; code?: unknown }
    | null;
  const message = typeof body?.error === 'string' ? body.error : fallback;
  const error = new Error(message) as Error & { code?: string };
  if (typeof body?.code === 'string') error.code = body.code;
  return error;
};

const authorizedFetch = async (
  user: Pick<User, 'getIdToken'>,
  url: string,
  init: RequestInit = {}
): Promise<Response> => {
  const token = await user.getIdToken(true);
  return fetch(url, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
};

export const loadAdminPlanManagement = async (
  user: Pick<User, 'getIdToken'>
): Promise<AdminPlanManagementSnapshot> => {
  const response = await authorizedFetch(user, '/api/admin/plans/catalog');
  if (!response.ok) {
    throw await responseError(response, 'Não foi possível carregar Planos & Cupons.');
  }
  return response.json() as Promise<AdminPlanManagementSnapshot>;
};

export type PublishAdminPlanInput = {
  planId: KyrubCommercialPlanId;
  monthlyPriceBRL: number;
  activeCatalogLimit: number | null;
  kyrubiaIntelligenceCredits: number;
  marketplaceOriginatedSaleCommissionPercent: number;
  features: KyrubPlanFeatureStates;
};

export const publishAdminPlanVersion = async (
  user: Pick<User, 'getIdToken'>,
  input: PublishAdminPlanInput
): Promise<KyrubPlanCatalogEntry> => {
  const response = await authorizedFetch(user, '/api/admin/plans/catalog', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw await responseError(response, 'Não foi possível publicar a nova versão do plano.');
  }
  return response.json() as Promise<KyrubPlanCatalogEntry>;
};

export type CreateAdminCouponInput = Omit<
  KyrubCouponCampaign,
  | 'schemaVersion'
  | 'id'
  | 'redemptionCount'
  | 'createdBy'
  | 'createdAt'
  | 'updatedBy'
  | 'updatedAt'
>;

export const createAdminCoupon = async (
  user: Pick<User, 'getIdToken'>,
  input: CreateAdminCouponInput
): Promise<KyrubCouponCampaign> => {
  const response = await authorizedFetch(user, '/api/admin/coupons', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw await responseError(response, 'Não foi possível criar o cupom.');
  }
  return response.json() as Promise<KyrubCouponCampaign>;
};

export const setAdminCouponStatus = async (
  user: Pick<User, 'getIdToken'>,
  code: string,
  status: KyrubCouponStatus
): Promise<void> => {
  const response = await authorizedFetch(user, '/api/admin/coupons/status', {
    method: 'POST',
    body: JSON.stringify({ code, status }),
  });
  if (!response.ok) {
    throw await responseError(response, 'Não foi possível alterar o status do cupom.');
  }
};

export type AdminComplimentaryGrantInput = {
  targetUserId: string;
  targetPlan: 'pro' | 'business';
  durationType: 'months' | 'until' | 'indefinite';
  durationMonths: number | null;
  benefitEndsAt: string | null;
  campaignId: string | null;
};

export type AdminComplimentaryGrantResult = {
  status: 'granted';
  storeId: string;
  plan: 'pro' | 'business';
  planVersion: number;
  source: 'admin_grant';
  benefitEndsAt: string | null;
};

export const grantAdminComplimentaryPlan = async (
  user: Pick<User, 'getIdToken'>,
  input: AdminComplimentaryGrantInput
): Promise<AdminComplimentaryGrantResult> => {
  const response = await authorizedFetch(user, '/api/admin/store-entitlements/grant', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw await responseError(response, 'Não foi possível conceder a cortesia.');
  }
  return response.json() as Promise<AdminComplimentaryGrantResult>;
};
