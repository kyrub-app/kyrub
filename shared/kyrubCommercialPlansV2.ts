export type KyrubCommercialPlanV2Id =
  | 'free'
  | 'essential'
  | 'pro'
  | 'business'
  | 'enterprise';

export type KyrubCommercialPlanV2Reference = {
  id: KyrubCommercialPlanV2Id;
  name: string;
  stage: string;
  monthlyPriceBRL: number | null;
  activeCatalogLimit: number | null;
  monthlyProcessedVolumeBRL: number | null;
  teamMemberLimit: number | null;
  positioning: string;
  highlighted?: boolean;
};

export const KYRUB_COMMERCIAL_PLANS_V2_NOTICE =
  'Valores e faixas de capacidade são referências comerciais V2. A migração de cobrança e dos entitlements legados será ativada separadamente, sem alterar contratos existentes de forma silenciosa.';

export const KYRUB_COMMERCIAL_PLANS_V2: readonly KyrubCommercialPlanV2Reference[] = [
  {
    id: 'free',
    name: 'Free',
    stage: 'Comece',
    monthlyPriceBRL: 0,
    activeCatalogLimit: 5,
    monthlyProcessedVolumeBRL: 5_000,
    teamMemberLimit: 1,
    positioning: 'Para testar uma ideia, organizar sua atividade e começar a operar no Kyrub.',
  },
  {
    id: 'essential',
    name: 'Essencial',
    stage: 'Profissionalize',
    monthlyPriceBRL: 99.9,
    activeCatalogLimit: 25,
    monthlyProcessedVolumeBRL: 25_000,
    teamMemberLimit: 3,
    positioning: 'Para quem transformou uma atividade em uma operação recorrente.',
  },
  {
    id: 'pro',
    name: 'Pro',
    stage: 'Cresça',
    monthlyPriceBRL: 199.9,
    activeCatalogLimit: 100,
    monthlyProcessedVolumeBRL: 100_000,
    teamMemberLimit: 10,
    positioning: 'Para negócios em crescimento que precisam de mais capacidade operacional.',
    highlighted: true,
  },
  {
    id: 'business',
    name: 'Business',
    stage: 'Escale',
    monthlyPriceBRL: 299.9,
    activeCatalogLimit: 500,
    monthlyProcessedVolumeBRL: 500_000,
    teamMemberLimit: 25,
    positioning: 'Para empresas com operação mais intensa, equipe e múltiplos canais.',
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    stage: 'Expanda',
    monthlyPriceBRL: null,
    activeCatalogLimit: null,
    monthlyProcessedVolumeBRL: null,
    teamMemberLimit: null,
    positioning: 'Para operações acima das faixas padrão ou com necessidades específicas.',
  },
] as const;

export const KYRUB_COMMERCIAL_PLANS_V2_SHARED_ECOSYSTEM = [
  'Loja e vitrine',
  'Produtos e estoque',
  'PDV, caixa e pedidos',
  'Financeiro e analytics',
  'CRM e relacionamento',
  'Marketing e promocionais',
  'Equipe e operação',
  'Integrações e omnichannel',
  'Cairúbia determinística',
  'Conexão com a IA do usuário',
  'Kyrub Fiscal',
  'Automações',
] as const;

export const legacyPlanIdToV2 = (
  value: unknown
): KyrubCommercialPlanV2Id =>
  value === 'business' ? 'business' : value === 'pro' ? 'pro' : 'free';
