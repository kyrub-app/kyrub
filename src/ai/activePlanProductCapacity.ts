import type { KyrubErpContextSnapshot } from '../../shared/kyrubErpContext';
import {
  KYRUB_COMMERCIAL_PLAN_BILLING_AVAILABLE,
  KYRUB_COMMERCIAL_PLANS_V1,
  type KyrubCommercialPlanId,
} from '../../shared/kyrubCommercialPlans';
import {
  getKyrubiaProductSequenceProgress,
  type KyrubiaOperationalWorkflow,
} from './operationalWorkflowStore';

const LEGACY_FREE_LIMIT = 5;
const PLAN_ORDER: readonly KyrubCommercialPlanId[] = ['free', 'pro', 'business'];
const WORD_COUNTS: Record<string, number> = {
  um: 1,
  uma: 1,
  dois: 2,
  duas: 2,
  tres: 3,
  quatro: 4,
  cinco: 5,
  seis: 6,
  sete: 7,
  oito: 8,
  nove: 9,
  dez: 10,
};

const normalize = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/\s+/g, ' ')
    .trim();

const isExplicitProductCreationIntent = (message: string): boolean => {
  const intent = normalize(message);
  return /\b(cadastre|cadastrar|crie|criar|adicione|adicionar|inclua|incluir)\b/.test(intent) &&
    /\b(produto|produtos|item|itens|servico|servicos)\b/.test(intent);
};

const parseRequestedCount = (message: string): number => {
  const intent = normalize(message);
  const numeric = /\b(\d{1,2})\s+(?:novos?\s+)?(?:produtos?|itens?|servicos?)\b/.exec(intent);
  if (numeric?.[1]) {
    return Math.min(50, Math.max(1, Number.parseInt(numeric[1], 10)));
  }
  const written = /\b(um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez)\s+(?:novos?\s+)?(?:produtos?|itens?|servicos?)\b/.exec(intent);
  return written?.[1] ? WORD_COUNTS[written[1]] ?? 1 : 1;
};

const planName = (planId: KyrubCommercialPlanId): string =>
  planId === 'free' ? 'Free' : planId === 'pro' ? 'Pro' : 'Business';

const smallestPlanForTarget = (
  currentPlan: KyrubCommercialPlanId,
  targetCount: number
): KyrubCommercialPlanId | null => {
  const currentIndex = PLAN_ORDER.indexOf(currentPlan);
  for (let index = currentIndex + 1; index < PLAN_ORDER.length; index += 1) {
    const candidate = PLAN_ORDER[index];
    const limit = KYRUB_COMMERCIAL_PLANS_V1[candidate].activeCatalogLimit;
    if (limit === null || limit >= targetCount) return candidate;
  }
  return null;
};

const requestedForTurn = (
  message: string,
  workflow: KyrubiaOperationalWorkflow | null
): { count: number; sequenceStarted: boolean } => {
  if (workflow?.objective === 'create_product') {
    const progress = getKyrubiaProductSequenceProgress(workflow);
    return {
      count: Math.max(1, progress.requestedCount - progress.completedCount),
      sequenceStarted: progress.completedCount > 0,
    };
  }
  return { count: parseRequestedCount(message), sequenceStarted: false };
};

export type ActivePlanCapacityResolution = {
  reply: string | null;
  bypassLegacyFreeCapacity: boolean;
};

export const resolveActivePlanProductCapacity = (
  message: string,
  context: KyrubErpContextSnapshot | undefined,
  workflow: KyrubiaOperationalWorkflow | null
): ActivePlanCapacityResolution => {
  if (
    workflow?.objective !== 'create_product' &&
    !isExplicitProductCreationIntent(message)
  ) {
    return { reply: null, bypassLegacyFreeCapacity: false };
  }

  if (!context?.store || context.availability.products !== true) {
    return { reply: null, bypassLegacyFreeCapacity: false };
  }

  const planId = context.store.plan;
  const limit = KYRUB_COMMERCIAL_PLANS_V1[planId].activeCatalogLimit;
  if (limit === null) {
    return { reply: null, bypassLegacyFreeCapacity: false };
  }

  const currentCount = Math.max(0, Math.trunc(context.productCount));
  const { count: requestedCount, sequenceStarted } = requestedForTurn(
    message,
    workflow
  );
  const remaining = Math.max(0, limit - currentCount);
  const oldFreeRemaining = Math.max(0, LEGACY_FREE_LIMIT - currentCount);
  const bypassLegacyFreeCapacity =
    planId === 'free' &&
    requestedCount <= remaining &&
    requestedCount > oldFreeRemaining;

  if (requestedCount <= remaining) {
    return { reply: null, bypassLegacyFreeCapacity };
  }

  const targetCount = currentCount + requestedCount;
  const nextPlan = smallestPlanForTarget(planId, targetCount);
  const nextName = nextPlan ? planName(nextPlan) : null;
  const currentName = planName(planId);
  const billingNote = nextPlan && nextPlan !== 'free' && !KYRUB_COMMERCIAL_PLAN_BILLING_AVAILABLE
    ? ` A contratação paga do ${nextName} ainda não está conectada; cupons ou cortesias válidas podem conceder entitlement sem simular pagamento.`
    : '';
  const upgradeNote = nextName
    ? `O menor plano ativo que comporta esse total é o ${nextName}.${billingNote}`
    : 'Nenhum plano ativo acima do seu comporta esse total neste momento; não vou inventar uma capacidade que não está publicada.';

  if (remaining === 0) {
    if (sequenceStarted) {
      return {
        reply:
          `Sua loja chegou aos ${limit.toLocaleString('pt-BR')} produtos ou serviços ativos permitidos pelo plano atual (${currentName}) durante este cadastro. ` +
          `O item anterior foi criado, mas interrompi a sequência antes de criar outro. ${upgradeNote}`,
        bypassLegacyFreeCapacity: false,
      };
    }

    if (planId === 'free' && limit === 5 && nextPlan === 'pro') {
      return {
        reply:
          `Sua loja já está usando os 5 produtos incluídos no plano atual (Free). Você quer continuar ampliando o catálogo, mas o plano chegou ao limite. ` +
          `Para cadastrar mais ${requestedCount === 1 ? 'um produto' : `${requestedCount} produtos`}, o próximo passo é fazer upgrade para o plano Pro. ` +
          `Não recomendo upgrade para o plano Business, porque o Pro já atende essa necessidade.${billingNote} Por enquanto posso te explicar o que ele libera. Nenhum produto foi criado agora.`,
        bypassLegacyFreeCapacity: false,
      };
    }

    return {
      reply:
        `Sua loja já está usando ${currentCount.toLocaleString('pt-BR')} de ${limit.toLocaleString('pt-BR')} produtos ou serviços ativos permitidos pelo plano atual (${currentName}). ` +
        `Para cadastrar mais ${requestedCount === 1 ? 'um item' : `${requestedCount} itens`}, seria necessário ultrapassar a capacidade vigente. ${upgradeNote} Nenhum produto foi criado agora.`,
      bypassLegacyFreeCapacity: false,
    };
  }

  return {
    reply:
      `Sua loja está usando ${currentCount.toLocaleString('pt-BR')} de ${limit.toLocaleString('pt-BR')} produtos ou serviços ativos do plano ${currentName}. ` +
      `Você pediu ${requestedCount} novos, mas há espaço para apenas ${remaining}. ` +
      `Posso usar ${remaining === 1 ? 'essa última vaga' : `essas ${remaining} vagas`} dentro do plano atual; para cadastrar todos, ${upgradeNote.charAt(0).toLowerCase()}${upgradeNote.slice(1)} Nenhum produto foi criado ainda.`,
    bypassLegacyFreeCapacity: false,
  };
};

export const bypassLegacyFreeCapacityContext = (
  context: KyrubErpContextSnapshot | undefined,
  bypass: boolean
): KyrubErpContextSnapshot | undefined => {
  if (!bypass || context?.store?.plan !== 'free') return context;
  return {
    ...context,
    store: {
      ...context.store,
      // Compatibility shim only for the old Free=5 client preflight. The
      // authoritative store remains Free; the active catalog was already
      // checked above and the server revalidates the real plan on execution.
      plan: 'pro',
    },
  };
};
