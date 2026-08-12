import type { KyrubAiConversationMessage } from '../../shared/aiConsultant';
import type { KyrubErpContextSnapshot } from '../../shared/kyrubErpContext';
import {
  formatKyrubPlanMonthlyPrice,
  KYRUB_COMMERCIAL_PLAN_BILLING_AVAILABLE,
  KYRUB_COMMERCIAL_PLAN_REFERENCE_NOTICE,
  KYRUB_COMMERCIAL_PLANS_V1,
  type KyrubCommercialPlanId,
} from '../../shared/kyrubCommercialPlans';

export type KyrubiaPlanConversationResolution = {
  reply: string;
  focusPlan: KyrubCommercialPlanId | null;
};

const normalize = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/\s+/g, ' ')
    .trim();

const mentionedPlans = (value: string): KyrubCommercialPlanId[] => {
  const intent = normalize(value);
  const result: KyrubCommercialPlanId[] = [];
  if (/\bfree\b|\bgratuito\b/.test(intent)) result.push('free');
  if (/\bpro\b/.test(intent)) result.push('pro');
  if (/\bbusiness\b/.test(intent)) result.push('business');
  return result;
};

const inferFocusPlan = (
  messages: KyrubAiConversationMessage[]
): KyrubCommercialPlanId | null => {
  const latestPlans = mentionedPlans(messages.at(-1)?.content ?? '');
  if (latestPlans.length === 1) return latestPlans[0];

  const previous = messages.slice(0, -1).slice(-8).reverse();
  for (const message of previous) {
    if (message.role !== 'user') continue;
    const plans = mentionedPlans(message.content);
    if (plans.length === 1) return plans[0];
  }

  for (const message of previous) {
    if (message.role !== 'assistant') continue;
    const intent = normalize(message.content);
    if (
      /(?:proximo passo|upgrade|recomendo|recomendacao)[^.!?]{0,90}\bpro\b/.test(intent) ||
      /\bpro\b[^.!?]{0,90}(?:resolve|atende|suficiente)/.test(intent)
    ) {
      return 'pro';
    }
    const plans = mentionedPlans(message.content);
    if (plans.length === 1) return plans[0];
  }
  return null;
};

const hasRecentPlanContext = (messages: KyrubAiConversationMessage[]): boolean =>
  messages
    .slice(0, -1)
    .slice(-8)
    .some(message => {
      const intent = normalize(message.content);
      return mentionedPlans(message.content).length > 0 ||
        /\b(plano|upgrade|assinatura|creditos kyrubia|limite do catalogo)\b/.test(intent);
    });

const shouldDeferToOperationalOrErp = (
  intent: string,
  directPlans: KyrubCommercialPlanId[]
): boolean => {
  if (/\b(cadastre|cadastrar|crie|criar|adicione|adicionar|inclua|incluir|remova|remover|exclua|excluir)\b/.test(intent)) {
    return true;
  }
  return directPlans.length === 0 &&
    /\b(eu tenho|tenho agora|cadastrados|cadastradas|meu catalogo|minha loja)\b/.test(intent) &&
    /\b(quantos|quantas|quantidade|total|produto|produtos|item|itens)\b/.test(intent);
};

const isOpenCommercialJudgment = (intent: string): boolean =>
  /\b(o que voce acha|o que acha|sua opiniao|na sua opiniao|estrategia|estrategico|mercado|concorrente|concorrencia|competitivo|posicionamento|como vender|como convencer|argumento de venda|campanha|copy|melhor preco|preco ideal|vale a pena)\b/.test(intent);

const isPlanCandidate = (
  intent: string,
  hasContext: boolean,
  directPlans: KyrubCommercialPlanId[]
): boolean => {
  if (directPlans.length > 0 || /\b(plano|upgrade|assinatura|assinar|contratar)\b/.test(intent)) {
    return true;
  }
  if (!hasContext) return false;
  return /\b(quanto custa|preco|valor|mensal|libera|inclui|oferece|beneficio|limite|quantos|quantas|produtos|servicos|itens|credito|creditos|kyrubia|business|pro|free|diferenca|comparar|comparacao|comissao|assino|assinar|contrato|contratar|upgrade|mudar|continuar|ficar|equipe|automacao|automacoes|integracao|integracoes|o que mais|mais alguma coisa|como funciona|posso|disponivel)\b/.test(intent);
};

const overview = (planId: KyrubCommercialPlanId): string => {
  const plan = KYRUB_COMMERCIAL_PLANS_V1[planId];
  if (planId === 'free') {
    return `O Free custa R$ 0, inclui ${plan.catalogLimitLabel} e tem referência de ${plan.kyrubiaIntelligenceCredits} Créditos Kyrubia Inteligência por mês. Operações locais e determinísticas da Kyrubia continuam disponíveis mesmo quando os créditos generativos acabam.`;
  }
  const billing = KYRUB_COMMERCIAL_PLAN_BILLING_AVAILABLE
    ? ''
    : ` A contratação do ${plan.name} ainda não está conectada ao fluxo executável do Kyrub.`;
  if (planId === 'pro') {
    return `O Pro é o próximo passo natural depois do Free quando a operação precisa crescer. Na referência V1, ele prevê ${plan.catalogLimitLabel}, ${plan.kyrubiaIntelligenceCredits} Créditos Kyrubia Inteligência por mês e preço de ${formatKyrubPlanMonthlyPrice(plan.monthlyPriceBRL)}/mês. Operações locais e determinísticas da Kyrubia não consomem esses créditos. Para ampliar o catálogo além dos 5 itens do Free, o Pro é o menor plano previsto suficiente; o Business não é necessário para essa necessidade. Valores e franquias ainda são referências comerciais V1.${billing}`;
  }
  return `O Business é o plano V1 de maior capacidade: ${formatKyrubPlanMonthlyPrice(plan.monthlyPriceBRL)}/mês, ${plan.catalogLimitLabel}, ${plan.kyrubiaIntelligenceCredits.toLocaleString('pt-BR')} Créditos Kyrubia Inteligência por mês e ${plan.positioning}. Se o Pro já resolver a necessidade, eu não recomendaria Business só para aumentar o plano. Valores e franquias ainda são referências comerciais V1.${billing}`;
};

const comparePlans = (): string => {
  const free = KYRUB_COMMERCIAL_PLANS_V1.free;
  const pro = KYRUB_COMMERCIAL_PLANS_V1.pro;
  const business = KYRUB_COMMERCIAL_PLANS_V1.business;
  return `Referência V1: Free — R$ 0, ${free.catalogLimitLabel}, ${free.kyrubiaIntelligenceCredits} créditos/mês. Pro — ${formatKyrubPlanMonthlyPrice(pro.monthlyPriceBRL)}/mês, ${pro.catalogLimitLabel}, ${pro.kyrubiaIntelligenceCredits} créditos/mês. Business — ${formatKyrubPlanMonthlyPrice(business.monthlyPriceBRL)}/mês, ${business.catalogLimitLabel}, ${business.kyrubiaIntelligenceCredits.toLocaleString('pt-BR')} créditos/mês e capacidade ampliada de equipe, automações, integrações e inteligência. A Kyrubia deve recomendar o menor plano suficiente.`;
};

const priceReply = (planId: KyrubCommercialPlanId): string => {
  const plan = KYRUB_COMMERCIAL_PLANS_V1[planId];
  if (planId === 'free') return 'O Free custa R$ 0.';
  return `O ${plan.name} tem preço mensal de referência V1 de ${formatKyrubPlanMonthlyPrice(plan.monthlyPriceBRL)}. O valor ainda está sujeito à validação comercial.${KYRUB_COMMERCIAL_PLAN_BILLING_AVAILABLE ? '' : ` A contratação do ${plan.name} ainda não está conectada ao fluxo executável do Kyrub.`}`;
};

const creditsReply = (planId: KyrubCommercialPlanId): string => {
  const plan = KYRUB_COMMERCIAL_PLANS_V1[planId];
  return `Na referência V1, o ${plan.name} prevê ${plan.kyrubiaIntelligenceCredits.toLocaleString('pt-BR')} Créditos Kyrubia Inteligência por mês. Eles são para capacidades generativas e analíticas; operações locais e determinísticas não os consomem. Se os créditos generativos acabarem, operações locais suportadas continuam funcionando.`;
};

const catalogReply = (planId: KyrubCommercialPlanId): string => {
  const plan = KYRUB_COMMERCIAL_PLANS_V1[planId];
  return `Na referência V1, o ${plan.name} permite ${plan.catalogLimitLabel}.${planId === 'business' ? ' “Ilimitado” é uma definição comercial sujeita a proteções técnicas e uso justo.' : ''}`;
};

const commissionReply = (planId: KyrubCommercialPlanId): string => {
  const plan = KYRUB_COMMERCIAL_PLANS_V1[planId];
  return `A hipótese V1 para o ${plan.name} é comissão de ${plan.marketplaceOriginatedSaleCommissionPercent}% somente em vendas efetivamente originadas ou intermediadas pelo Kyrub. Venda trazida pelo próprio comerciante e apenas registrada no ERP não deve gerar essa comissão automaticamente. ${KYRUB_COMMERCIAL_PLAN_REFERENCE_NOTICE}`;
};

const billingReply = (planId: KyrubCommercialPlanId | null): string => {
  if (KYRUB_COMMERCIAL_PLAN_BILLING_AVAILABLE) {
    return 'A contratação de planos pagos está disponível pelo fluxo oficial do Kyrub.';
  }
  const name = planId ? ` do ${KYRUB_COMMERCIAL_PLANS_V1[planId].name}` : '';
  return `A contratação${name} ainda não está conectada ao fluxo executável do Kyrub. Posso explicar as capacidades previstas e indicar o menor plano adequado, mas não vou fingir que consigo concluir um upgrade que ainda não foi implementado.`;
};

const requestedCatalogTarget = (
  intent: string,
  context?: KyrubErpContextSnapshot
): number | null => {
  const match = /\b(\d{1,4})\s+(?:novos?\s+)?(?:produtos?|servicos?|itens?)\b/.exec(intent);
  if (!match?.[1]) return null;
  const requested = Number.parseInt(match[1], 10);
  if (!Number.isFinite(requested) || requested < 0) return null;
  return /\bmais\s+\d{1,4}\s+/.test(intent)
    ? Math.max(0, context?.productCount ?? 0) + requested
    : requested;
};

const catalogRecommendation = (target: number): string => {
  if (target <= 5) {
    return `Para manter até ${target} ${target === 1 ? 'item ativo' : 'itens ativos'}, o Free já cobre essa necessidade na referência V1. Não há motivo para recomendar upgrade só por capacidade de catálogo.`;
  }
  if (target <= 100) {
    return `Para chegar a ${target} itens ativos, o Pro é o menor plano previsto suficiente: a referência V1 comporta até 100 produtos ou serviços ativos. Business seria desnecessário apenas por essa necessidade de catálogo.`;
  }
  return `Para chegar a ${target} itens ativos, a capacidade prevista do Pro (até 100) não seria suficiente. O Business é o plano V1 desenhado para catálogo comercialmente ilimitado, sujeito a uso justo. A contratação dos planos pagos ainda não está conectada ao fluxo executável do Kyrub.`;
};

export const resolveKyrubiaPlanConversation = (
  messages: KyrubAiConversationMessage[],
  context?: KyrubErpContextSnapshot
): KyrubiaPlanConversationResolution | null => {
  const latest = messages.at(-1);
  if (!latest || latest.role !== 'user') return null;
  const intent = normalize(latest.content);
  if (!intent) return null;

  const directPlans = mentionedPlans(latest.content);
  if (shouldDeferToOperationalOrErp(intent, directPlans)) return null;
  if (!isPlanCandidate(intent, hasRecentPlanContext(messages), directPlans)) return null;
  if (isOpenCommercialJudgment(intent)) return null;

  const focusPlan = inferFocusPlan(messages);
  if (
    (directPlans.includes('pro') && directPlans.includes('business')) ||
    (/\b(diferenca|comparar|comparacao)\b/.test(intent) && directPlans.length !== 1)
  ) {
    return { reply: comparePlans(), focusPlan: null };
  }

  if (/\b(meu plano|plano atual|qual plano eu tenho|em qual plano)\b/.test(intent)) {
    const current = context?.store?.plan === 'business'
      ? 'Business'
      : context?.store?.plan === 'pro'
        ? 'Pro'
        : context?.store
          ? 'Free'
          : null;
    return {
      reply: current
        ? `O plano registrado atualmente para sua Loja Kyrub é ${current}.`
        : 'Não consegui confirmar o plano atual da sua Loja Kyrub nesta leitura.',
      focusPlan,
    };
  }

  const target = requestedCatalogTarget(intent, context);
  if (target !== null) return { reply: catalogRecommendation(target), focusPlan };

  if (/\b(assinar|assino|contratar|contrato|fazer upgrade|mudar de plano|upgrade agora|como faco upgrade|como fazer upgrade)\b/.test(intent)) {
    return { reply: billingReply(focusPlan), focusPlan };
  }

  if (/\b(comissao|taxa sobre venda|percentual.*venda)\b/.test(intent)) {
    return focusPlan
      ? { reply: commissionReply(focusPlan), focusPlan }
      : { reply: comparePlans(), focusPlan: null };
  }

  if (/\b(credito|creditos|kyrubia)\b/.test(intent)) {
    return focusPlan
      ? { reply: creditsReply(focusPlan), focusPlan }
      : { reply: comparePlans(), focusPlan: null };
  }

  if (/\b(quanto custa|preco|valor|mensal|mensalidade)\b/.test(intent)) {
    return focusPlan
      ? { reply: priceReply(focusPlan), focusPlan }
      : { reply: comparePlans(), focusPlan: null };
  }

  if (/\b(quantos|quantas|limite)\b/.test(intent) && /\b(produto|produtos|servico|servicos|item|itens|catalogo)\b/.test(intent)) {
    return focusPlan
      ? { reply: catalogReply(focusPlan), focusPlan }
      : { reply: comparePlans(), focusPlan: null };
  }

  if (/\b(equipe|automacao|automacoes|integracao|integracoes)\b/.test(intent)) {
    return focusPlan === 'business'
      ? {
          reply: 'O Business é o plano V1 em que equipe, automações, integrações e inteligência aparecem como capacidades ampliadas. Os limites exatos ainda não estão consolidados na camada executável de entitlements, então não vou inventar números.',
          focusPlan,
        }
      : {
          reply: `Os limites exatos de equipe, automações e integrações do ${focusPlan ? KYRUB_COMMERCIAL_PLANS_V1[focusPlan].name : 'plano'} ainda não estão consolidados na camada executável de entitlements. O que já está definido como referência V1 eu consigo informar; números ainda não aprovados eu não vou inventar.`,
          focusPlan,
        };
  }

  if (/\b(continuar|ficar|permanecer)\b.*\bfree\b|\bsem upgrade\b|\bnao fizer.*upgrade\b/.test(intent)) {
    return {
      reply: 'Você pode continuar no Free. Na referência V1 ele permanece com até 5 produtos ou serviços ativos e 30 Créditos Kyrubia Inteligência por mês; operações locais/determinísticas continuam disponíveis. Upgrade só deve ser recomendado quando uma necessidade real ultrapassar essa capacidade.',
      focusPlan: 'free',
    };
  }

  if (
    /\b(libera|inclui|oferece|beneficio|beneficios|o que tem|como funciona|o que mais|mais alguma coisa)\b/.test(intent) ||
    directPlans.length === 1
  ) {
    return focusPlan
      ? { reply: overview(focusPlan), focusPlan }
      : { reply: comparePlans(), focusPlan: null };
  }

  return null;
};

export const describeKyrubiaPlanContextForGenerative = (
  messages: KyrubAiConversationMessage[]
): string | null => {
  const latest = messages.at(-1);
  if (!latest || latest.role !== 'user') return null;
  const intent = normalize(latest.content);
  const directPlans = mentionedPlans(latest.content);
  if (shouldDeferToOperationalOrErp(intent, directPlans)) return null;
  if (!isPlanCandidate(intent, hasRecentPlanContext(messages), directPlans)) return null;
  return 'Planos Kyrub V1: Free R$0/5 itens/30 créditos; Pro R$79,90/100 itens/300 créditos; Business R$199,90/ilimitado*/1.500 créditos. *uso justo. Operações locais não gastam créditos. Checkout pago indisponível. Valores V1.';
};
