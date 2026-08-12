import {
  KYRUB_COMMERCIAL_PLANS_V1,
  type KyrubCommercialPlanId,
} from './kyrubCommercialPlans.js';

export type KyrubPlanFeatureId =
  | 'storefront'
  | 'catalog'
  | 'kyrubia_operations'
  | 'kyrubia_intelligence'
  | 'team'
  | 'automations'
  | 'integrations'
  | 'marketplace';

export type KyrubPlanFeatureDefinition = {
  id: KyrubPlanFeatureId;
  label: string;
  description: string;
  enforcement: 'capability' | 'catalog_limit' | 'credit_limit';
};

export const KYRUB_PLAN_FEATURES: readonly KyrubPlanFeatureDefinition[] = [
  {
    id: 'storefront',
    label: 'Loja Kyrub',
    description: 'Perfil e operação da Loja Kyrub.',
    enforcement: 'capability',
  },
  {
    id: 'catalog',
    label: 'Catálogo de produtos e serviços',
    description: 'Cadastro e manutenção do catálogo dentro do limite do plano.',
    enforcement: 'catalog_limit',
  },
  {
    id: 'kyrubia_operations',
    label: 'Kyrubia operacional',
    description: 'Operações locais e determinísticas suportadas pela Kyrubia.',
    enforcement: 'capability',
  },
  {
    id: 'kyrubia_intelligence',
    label: 'Kyrubia Inteligência',
    description: 'Capacidades generativas e analíticas sujeitas à franquia mensal.',
    enforcement: 'credit_limit',
  },
  {
    id: 'team',
    label: 'Equipe',
    description: 'Recursos de colaboração e papéis de equipe da loja.',
    enforcement: 'capability',
  },
  {
    id: 'automations',
    label: 'Automações',
    description: 'Recursos de automação operacional habilitados para o plano.',
    enforcement: 'capability',
  },
  {
    id: 'integrations',
    label: 'Integrações',
    description: 'Integrações externas habilitadas para o plano.',
    enforcement: 'capability',
  },
  {
    id: 'marketplace',
    label: 'Marketplace Kyrub',
    description: 'Recursos de publicação e intermediação no marketplace.',
    enforcement: 'capability',
  },
] as const;

export type KyrubPlanFeatureStates = Record<KyrubPlanFeatureId, boolean>;
export type KyrubPlanVersionStatus = 'draft' | 'active' | 'retired';

export type KyrubPlanVersion = {
  schemaVersion: 1;
  planId: KyrubCommercialPlanId;
  version: number;
  status: KyrubPlanVersionStatus;
  monthlyPriceBRL: number;
  activeCatalogLimit: number | null;
  kyrubiaIntelligenceCredits: number;
  marketplaceOriginatedSaleCommissionPercent: number;
  features: KyrubPlanFeatureStates;
  effectiveFrom: string | null;
  createdBy: string;
  createdAt: string | null;
};

export type KyrubPlanCatalogEntry = {
  schemaVersion: 1;
  planId: KyrubCommercialPlanId;
  activeVersion: number;
  definition: KyrubPlanVersion;
  updatedBy: string;
  updatedAt: string | null;
};

const baselineFeatures = (
  planId: KyrubCommercialPlanId
): KyrubPlanFeatureStates => ({
  storefront: true,
  catalog: true,
  kyrubia_operations: true,
  kyrubia_intelligence: true,
  team: planId === 'business',
  automations: planId === 'business',
  integrations: planId === 'business',
  marketplace: true,
});

export const buildBootstrapPlanVersion = (
  planId: KyrubCommercialPlanId
): KyrubPlanVersion => {
  const reference = KYRUB_COMMERCIAL_PLANS_V1[planId];
  return {
    schemaVersion: 1,
    planId,
    version: 1,
    status: 'active',
    monthlyPriceBRL: reference.monthlyPriceBRL,
    activeCatalogLimit: reference.activeCatalogLimit,
    kyrubiaIntelligenceCredits: reference.kyrubiaIntelligenceCredits,
    marketplaceOriginatedSaleCommissionPercent:
      reference.marketplaceOriginatedSaleCommissionPercent,
    features: baselineFeatures(planId),
    effectiveFrom: null,
    createdBy: 'bootstrap_v1',
    createdAt: null,
  };
};

export const KYRUB_BOOTSTRAP_PLAN_CATALOG: Record<
  KyrubCommercialPlanId,
  KyrubPlanVersion
> = {
  free: buildBootstrapPlanVersion('free'),
  pro: buildBootstrapPlanVersion('pro'),
  business: buildBootstrapPlanVersion('business'),
};

export type KyrubCouponDiscountType = 'percent' | 'fixed_brl';
export type KyrubCouponDurationType = 'months' | 'until' | 'indefinite';
export type KyrubCouponStatus = 'draft' | 'active' | 'paused' | 'retired';

export type KyrubCouponCampaign = {
  schemaVersion: 1;
  id: string;
  code: string;
  label: string;
  targetPlan: Exclude<KyrubCommercialPlanId, 'free'>;
  targetPlanVersion: number | null;
  discountType: KyrubCouponDiscountType;
  discountValue: number;
  durationType: KyrubCouponDurationType;
  durationMonths: number | null;
  benefitEndsAt: string | null;
  redeemStartsAt: string | null;
  redeemEndsAt: string | null;
  maxRedemptions: number | null;
  maxRedemptionsPerStore: number;
  redemptionCount: number;
  status: KyrubCouponStatus;
  createdBy: string;
  createdAt: string | null;
  updatedBy: string;
  updatedAt: string | null;
};

export type KyrubEntitlementSource =
  | 'free_default'
  | 'subscription'
  | 'promotion'
  | 'admin_grant';

export type KyrubStoreEntitlement = {
  schemaVersion: 2;
  storeId: string;
  ownerId: string;
  plan: KyrubCommercialPlanId;
  planVersion: number;
  source: KyrubEntitlementSource;
  status: 'active' | 'expired' | 'revoked';
  campaignId: string | null;
  couponCode: string | null;
  discountType: KyrubCouponDiscountType | null;
  discountValue: number | null;
  benefitStartsAt: string | null;
  benefitEndsAt: string | null;
  grantedBy: string | null;
  updatedAt: string | null;
};

export const normalizeKyrubCouponCode = (value: string): string =>
  value
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[^A-Z0-9_-]/g, '');

export const isValidKyrubCouponCode = (value: string): boolean =>
  /^[A-Z0-9][A-Z0-9_-]{2,39}$/.test(value);

export const validateKyrubDiscount = (
  type: KyrubCouponDiscountType,
  value: number
): boolean =>
  Number.isFinite(value) &&
  value > 0 &&
  (type === 'percent' ? value <= 100 : value <= 1_000_000);
