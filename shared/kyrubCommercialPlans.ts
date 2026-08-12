export type KyrubCommercialPlanId = 'free' | 'pro' | 'business';

export type KyrubCommercialPlanReference = {
  id: KyrubCommercialPlanId;
  name: string;
  monthlyPriceBRL: number;
  activeCatalogLimit: number | null;
  catalogLimitLabel: string;
  kyrubiaIntelligenceCredits: number;
  marketplaceOriginatedSaleCommissionPercent: number;
  positioning: string;
};

export type KyrubCommercialPlanRuntimeOverride = Pick<
  KyrubCommercialPlanReference,
  | 'monthlyPriceBRL'
  | 'activeCatalogLimit'
  | 'kyrubiaIntelligenceCredits'
  | 'marketplaceOriginatedSaleCommissionPercent'
>;

export const KYRUB_COMMERCIAL_PLAN_BILLING_AVAILABLE = false;
export const KYRUB_COMMERCIAL_PLAN_REFERENCE_NOTICE =
  'Valores, franquias e comissões são referências comerciais V1 sujeitas a validação antes de cobrança real.';

const COMPILED_PLAN_REFERENCE: Record<
  KyrubCommercialPlanId,
  KyrubCommercialPlanReference
> = {
  free: {
    id: 'free',
    name: 'Free',
    monthlyPriceBRL: 0,
    activeCatalogLimit: 5,
    catalogLimitLabel: 'até 5 produtos ou serviços ativos',
    kyrubiaIntelligenceCredits: 30,
    marketplaceOriginatedSaleCommissionPercent: 10,
    positioning: 'operação essencial',
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    monthlyPriceBRL: 79.9,
    activeCatalogLimit: 100,
    catalogLimitLabel: 'até 100 produtos ou serviços ativos',
    kyrubiaIntelligenceCredits: 300,
    marketplaceOriginatedSaleCommissionPercent: 7,
    positioning: 'maior capacidade operacional',
  },
  business: {
    id: 'business',
    name: 'Business',
    monthlyPriceBRL: 199.9,
    activeCatalogLimit: null,
    catalogLimitLabel: 'catálogo comercialmente ilimitado, sujeito a uso justo',
    kyrubiaIntelligenceCredits: 1_500,
    marketplaceOriginatedSaleCommissionPercent: 5,
    positioning:
      'equipe, automações, integrações e inteligência ampliadas',
  },
};

export const KYRUB_COMMERCIAL_PLANS_V1: Record<
  KyrubCommercialPlanId,
  KyrubCommercialPlanReference
> = {
  free: { ...COMPILED_PLAN_REFERENCE.free },
  pro: { ...COMPILED_PLAN_REFERENCE.pro },
  business: { ...COMPILED_PLAN_REFERENCE.business },
};

const catalogLabel = (limit: number | null): string =>
  limit === null
    ? 'catálogo comercialmente ilimitado, sujeito a uso justo'
    : `até ${limit.toLocaleString('pt-BR')} produtos ou serviços ativos`;

export const resetKyrubCommercialPlanRuntimeOverrides = (): void => {
  for (const planId of Object.keys(
    COMPILED_PLAN_REFERENCE
  ) as KyrubCommercialPlanId[]) {
    Object.assign(
      KYRUB_COMMERCIAL_PLANS_V1[planId],
      COMPILED_PLAN_REFERENCE[planId]
    );
  }
};

// Server entrypoints can hydrate the commercial contract from the active,
// versioned Control Plane catalog before executing an operation. Browser builds
// keep the compiled V1 fallback unless they explicitly load the public catalog.
export const applyKyrubCommercialPlanRuntimeOverrides = (
  overrides: Partial<
    Record<KyrubCommercialPlanId, KyrubCommercialPlanRuntimeOverride>
  >
): void => {
  for (const planId of Object.keys(overrides) as KyrubCommercialPlanId[]) {
    const override = overrides[planId];
    if (!override) continue;
    const current = KYRUB_COMMERCIAL_PLANS_V1[planId];
    Object.assign(current, override, {
      catalogLimitLabel: catalogLabel(override.activeCatalogLimit),
    });
  }
};

export const formatKyrubPlanMonthlyPrice = (price: number): string =>
  price === 0
    ? 'R$ 0'
    : price.toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL',
      });

export const describeKyrubCommercialPlansForAi = (): string => {
  const free = KYRUB_COMMERCIAL_PLANS_V1.free;
  const pro = KYRUB_COMMERCIAL_PLANS_V1.pro;
  const business = KYRUB_COMMERCIAL_PLANS_V1.business;

  return [
    'Referência comercial V1 dos planos Kyrub:',
    `Free: ${formatKyrubPlanMonthlyPrice(free.monthlyPriceBRL)}/mês; ${free.catalogLimitLabel}; ${free.kyrubiaIntelligenceCredits} Créditos Kyrubia Inteligência/mês; comissão de referência de ${free.marketplaceOriginatedSaleCommissionPercent}% somente em vendas originadas/intermediadas pelo Kyrub.`,
    `Pro: ${formatKyrubPlanMonthlyPrice(pro.monthlyPriceBRL)}/mês; ${pro.catalogLimitLabel}; ${pro.kyrubiaIntelligenceCredits} Créditos Kyrubia Inteligência/mês; comissão de referência de ${pro.marketplaceOriginatedSaleCommissionPercent}% somente em vendas originadas/intermediadas pelo Kyrub.`,
    `Business: ${formatKyrubPlanMonthlyPrice(business.monthlyPriceBRL)}/mês; ${business.catalogLimitLabel}; ${business.kyrubiaIntelligenceCredits} Créditos Kyrubia Inteligência/mês; comissão de referência de ${business.marketplaceOriginatedSaleCommissionPercent}% somente em vendas originadas/intermediadas pelo Kyrub; ${business.positioning}.`,
    'Operações locais/determinísticas da Kyrubia não consomem Créditos Kyrubia Inteligência.',
    'Faturamento total não é trava automática de plano. A Kyrubia recomenda o menor plano suficiente.',
    'A contratação/checkout de Pro e Business ainda não está conectada ao fluxo executável do Kyrub.',
    KYRUB_COMMERCIAL_PLAN_REFERENCE_NOTICE,
  ].join(' ');
};
