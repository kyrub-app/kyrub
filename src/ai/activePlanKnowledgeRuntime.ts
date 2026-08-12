import {
  KYRUB_COMMERCIAL_PLAN_BILLING_AVAILABLE,
  formatKyrubPlanMonthlyPrice,
  type KyrubCommercialPlanId,
} from '../../shared/kyrubCommercialPlans';
import { KYRUB_PLAN_FEATURES } from '../../shared/kyrubPlanManagement';
import { getActivePlanCatalogSnapshot } from '../utils/activePlanCatalog';

const normalize = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/\bq\b/g, 'que')
    .replace(/\s+/g, ' ')
    .trim();

const explicitPlan = (message: string): KyrubCommercialPlanId | null => {
  const intent = normalize(message);
  const matches: KyrubCommercialPlanId[] = [];
  if (/\bfree\b|\bgratuito\b/.test(intent)) matches.push('free');
  if (/\bpro\b/.test(intent)) matches.push('pro');
  if (/\bbusiness\b/.test(intent)) matches.push('business');
  return matches.length === 1 ? matches[0] : null;
};

const isPlanFactQuestion = (message: string): boolean => {
  const intent = normalize(message);
  const questionLike = /\?$/.test(message.trim()) ||
    /^(o que|o que|como|qual|quais|quanto|quantos|quantas|me diga|explique)\b/.test(intent);
  if (!questionLike || !explicitPlan(message)) return false;
  return /\b(plano|libera|inclui|oferece|beneficio|beneficios|preco|valor|custa|limite|produto|produtos|servico|servicos|credito|creditos|kyrubia|comissao|funcionalidade|funcionalidades)\b/.test(intent);
};

const planName = (planId: KyrubCommercialPlanId): string =>
  planId === 'free' ? 'Free' : planId === 'pro' ? 'Pro' : 'Business';

export const resolveKyrubiaActivePlanKnowledge = (
  message: string
): string | null => {
  if (!isPlanFactQuestion(message)) return null;
  const planId = explicitPlan(message);
  if (!planId) return null;

  const snapshot = getActivePlanCatalogSnapshot();
  const plan = snapshot?.plans.find(entry => entry.planId === planId);
  if (!plan) return null;

  const enabledFeatures = KYRUB_PLAN_FEATURES
    .filter(feature => plan.features[feature.id])
    .map(feature => feature.label);
  const catalog = plan.activeCatalogLimit === null
    ? 'catálogo comercialmente ilimitado, sujeito a proteções técnicas e uso justo'
    : `até ${plan.activeCatalogLimit.toLocaleString('pt-BR')} produtos ou serviços ativos`;
  const commercialSource = plan.source === 'control_plane'
    ? `Esta é a versão comercial ativa ${plan.version}, publicada pelo Control Plane do Kyrub.`
    : `Esta sessão ainda está usando o bootstrap comercial V1 (versão ${plan.version}), porque nenhuma versão administrativa mais nova foi publicada para este plano.`;
  const billing = planId === 'free'
    ? 'O Free não exige cobrança.'
    : KYRUB_COMMERCIAL_PLAN_BILLING_AVAILABLE
      ? `A contratação do ${planName(planId)} está disponível pelo fluxo oficial do Kyrub.`
      : `O checkout pago do ${planName(planId)} ainda não está conectado. Benefícios promocionais válidos podem conceder entitlement sem simular pagamento.`;

  return [
    `Segundo o Manual KYRUB — catálogo oficial ativo do plano ${planName(planId)} (versão ${plan.version}):`,
    '',
    `Preço mensal vigente: ${formatKyrubPlanMonthlyPrice(plan.monthlyPriceBRL)}.`,
    `Catálogo: ${catalog}.`,
    `Créditos Kyrubia Inteligência: ${plan.kyrubiaIntelligenceCredits.toLocaleString('pt-BR')} por mês.`,
    `Comissão de referência em vendas originadas/intermediadas pelo Kyrub: ${plan.marketplaceOriginatedSaleCommissionPercent}%.`,
    enabledFeatures.length > 0
      ? `Funcionalidades habilitadas nesta versão: ${enabledFeatures.join(', ')}.`
      : 'Nenhuma funcionalidade comercial está habilitada nesta versão.',
    'Operações locais e determinísticas da Kyrubia só ficam disponíveis quando a funcionalidade correspondente estiver habilitada e continuam separadas dos Créditos Kyrubia Inteligência.',
    commercialSource,
    billing,
  ].join('\n');
};
