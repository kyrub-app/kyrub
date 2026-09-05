import type {
  KyrubAiConsultantResponse,
  KyrubAiConversationMessage,
} from '../../shared/aiConsultant';
import type { KyrubErpContextSnapshot } from '../../shared/kyrubErpContext';
import type {
  KyrubiaOfferedIntent,
  KyrubiaPlanOfferedIntent,
  KyrubiaPlanOfferedIntentKind,
  KyrubiaTurnContext,
} from '../../shared/kyrubiaContext';
import type { KyrubCommercialPlanId } from '../../shared/kyrubCommercialPlans';
import { resolveKyrubiaPlanConversation } from './planConversationRuntime';

export type KyrubiaOfferedIntentResolution = {
  reply: string;
  turnContext: KyrubiaTurnContext;
};

const normalize = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/\s+/g, ' ')
    .trim();

const createTurnId = (): string => {
  try {
    return globalThis.crypto.randomUUID();
  } catch {
    return `kyrub-offer-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
};

const offer = (
  id: string,
  intent: KyrubiaPlanOfferedIntentKind,
  label: string,
  planId?: KyrubCommercialPlanId,
  primary = false
): KyrubiaPlanOfferedIntent => ({
  id,
  intent,
  label,
  ...(planId ? { payload: { planId } } : {}),
  authorization: 'intent_only',
  ...(primary ? { primary: true } : {}),
});

const planName = (planId: KyrubCommercialPlanId): string =>
  planId === 'free' ? 'Free' : planId === 'pro' ? 'Pro' : 'Business';

const createTurnContext = (
  offeredIntents: KyrubiaOfferedIntent[],
  storeId: string | null,
  sourceAction: KyrubiaTurnContext['sourceAction'] = 'plan_conversation'
): KyrubiaTurnContext => ({
  version: 1,
  id: createTurnId(),
  source: 'kyrub_runtime',
  sourceAction,
  generatedAt: new Date().toISOString(),
  scope: {
    kind: 'own_store',
    storeId,
  },
  entities: [],
  offeredIntents: offeredIntents.slice(0, 3),
});

export const createKyrubiaCapacityPlanTurnContext = (
  storeId: string | null
): KyrubiaTurnContext =>
  createTurnContext(
    [
      offer(
        'plan-explain-pro',
        'plan.explain',
        'O que o Pro libera?',
        'pro',
        true
      ),
      offer(
        'plan-compare',
        'plan.compare',
        'Comparar planos'
      ),
      offer(
        'plan-stay-free',
        'plan.continue_free',
        'Continuar no Free',
        'free'
      ),
    ],
    storeId,
    'operational_workflow'
  );

const followUpsFor = (
  focusPlan: KyrubCommercialPlanId | null,
  latestMessage: string
): KyrubiaPlanOfferedIntent[] => {
  const planId = focusPlan ?? 'pro';
  const name = planName(planId);
  const intent = normalize(latestMessage);

  if (/\b(quanto custa|preco|valor|mensal|mensalidade)\b/.test(intent)) {
    return [
      offer(`plan-credits-${planId}`, 'plan.credits', 'E os Créditos Kyrubia?', planId),
      offer('plan-compare', 'plan.compare', 'Comparar planos'),
      offer(`plan-billing-${planId}`, 'plan.billing', 'Posso assinar agora?', planId),
    ];
  }

  if (/\b(credito|creditos|kyrubia)\b/.test(intent)) {
    return [
      offer(`plan-price-${planId}`, 'plan.price', `Quanto custa o ${name}?`, planId),
      offer('plan-compare', 'plan.compare', 'Comparar planos'),
      offer(`plan-billing-${planId}`, 'plan.billing', 'Posso assinar agora?', planId),
    ];
  }

  if (/\b(diferenca|comparar|comparacao)\b/.test(intent)) {
    return [
      offer('plan-explain-pro', 'plan.explain', 'Ver detalhes do Pro', 'pro'),
      offer('plan-explain-business', 'plan.explain', 'Ver detalhes do Business', 'business'),
      offer('plan-stay-free', 'plan.continue_free', 'Continuar no Free', 'free'),
    ];
  }

  if (/\b(assinar|assino|contratar|contrato|upgrade)\b/.test(intent)) {
    return [
      offer(`plan-explain-${planId}`, 'plan.explain', `Rever o ${name}`, planId),
      offer('plan-compare', 'plan.compare', 'Comparar planos'),
      offer('plan-stay-free', 'plan.continue_free', 'Continuar no Free', 'free'),
    ];
  }

  return [
    offer(`plan-price-${planId}`, 'plan.price', `Quanto custa o ${name}?`, planId),
    offer(`plan-credits-${planId}`, 'plan.credits', 'E os Créditos Kyrubia?', planId),
    offer('plan-compare', 'plan.compare', 'Comparar planos'),
  ];
};

export const createKyrubiaPlanFollowUpTurnContext = (
  focusPlan: KyrubCommercialPlanId | null,
  latestMessage: string,
  storeId: string | null
): KyrubiaTurnContext =>
  createTurnContext(
    followUpsFor(focusPlan, latestMessage),
    storeId
  );

const genericAcceptance = (message: string): boolean => {
  const intent = normalize(message).replace(/[.!?]+$/g, '').trim();
  return /^(sim|sim por favor|quero|quero sim|pode|pode sim|pode explicar|explica|explica ai|entao explica|entao me explica|manda|manda ai|me mostra|mostra|vamos|bora|ok|beleza|claro|por favor)$/.test(intent);
};

const syntheticMessageFor = (offeredIntent: KyrubiaOfferedIntent): string | null => {
  if (
    offeredIntent.intent === 'mercado_livre.category_select' ||
    offeredIntent.intent === 'mercado_livre.condition_select'
  ) return null;
  const planId = offeredIntent.payload?.planId;
  const name = planId ? planName(planId) : 'Pro';

  switch (offeredIntent.intent) {
    case 'plan.explain':
      return `O que o plano ${name} libera?`;
    case 'plan.price':
      return `Quanto custa o plano ${name}?`;
    case 'plan.credits':
      return `Quantos Créditos Kyrubia o plano ${name} inclui?`;
    case 'plan.compare':
      return 'Qual a diferença entre Free, Pro e Business?';
    case 'plan.billing':
      return `Posso assinar o plano ${name} agora?`;
    case 'plan.continue_free':
      return 'Quero continuar no Free sem upgrade.';
    default:
      return null;
  }
};

const selectedIntent = (
  turnContext: KyrubiaTurnContext,
  selectedOfferedIntentId: string | undefined,
  latestMessage: string
): KyrubiaOfferedIntent | null => {
  const offered = turnContext.offeredIntents ?? [];
  if (selectedOfferedIntentId) {
    return offered.find(item => item.id === selectedOfferedIntentId) ?? null;
  }

  const normalizedLatest = normalize(latestMessage);
  const exactLabel = offered.find(item => normalize(item.label) === normalizedLatest);
  if (exactLabel) return exactLabel;

  if (!genericAcceptance(latestMessage)) return null;
  const primary = offered.filter(item => item.primary === true);
  return primary.length === 1 ? primary[0] : null;
};

const genericNeedsDisambiguation = (
  turnContext: KyrubiaTurnContext,
  selectedOfferedIntentId: string | undefined,
  latestMessage: string
): boolean =>
  !selectedOfferedIntentId &&
  genericAcceptance(latestMessage) &&
  (turnContext.offeredIntents?.length ?? 0) > 0 &&
  (turnContext.offeredIntents?.filter(item => item.primary === true).length ?? 0) !== 1;

const consumeOfferedIntent = (
  turnContext: KyrubiaTurnContext,
  offeredIntent: KyrubiaOfferedIntent
): KyrubiaTurnContext => ({
  ...turnContext,
  id: createTurnId(),
  generatedAt: new Date().toISOString(),
  offeredIntents: (turnContext.offeredIntents ?? []).filter(
    item => item.id !== offeredIntent.id
  ),
});

export const resolveKyrubiaOfferedIntentContinuation = (
  messages: KyrubAiConversationMessage[],
  turnContext: KyrubiaTurnContext | undefined,
  selectedOfferedIntentId?: string,
  erpContext?: KyrubErpContextSnapshot
): KyrubiaOfferedIntentResolution | null => {
  const latest = messages.at(-1);
  if (!turnContext?.offeredIntents?.length || latest?.role !== 'user') return null;

  if (
    genericNeedsDisambiguation(
      turnContext,
      selectedOfferedIntentId,
      latest.content
    )
  ) {
    return {
      reply: 'Posso detalhar um destes próximos pontos. Escolha uma opção abaixo ou diga qual deles você quer aprofundar.',
      turnContext: {
        ...turnContext,
        id: createTurnId(),
        generatedAt: new Date().toISOString(),
      },
    };
  }

  const offeredIntent = selectedIntent(
    turnContext,
    selectedOfferedIntentId,
    latest.content
  );
  if (!offeredIntent || offeredIntent.authorization !== 'intent_only') return null;

  const syntheticContent = syntheticMessageFor(offeredIntent);
  if (!syntheticContent) return null;

  const syntheticMessages: KyrubAiConversationMessage[] = [
    ...messages.slice(0, -1),
    {
      ...latest,
      content: syntheticContent,
    },
  ];
  const resolved = resolveKyrubiaPlanConversation(
    syntheticMessages,
    erpContext
  );
  if (!resolved) return null;

  return {
    reply: resolved.reply,
    turnContext: consumeOfferedIntent(turnContext, offeredIntent),
  };
};

export const attachKyrubiaCapacityPlanSuggestions = (
  response: KyrubAiConsultantResponse,
  storeId: string | null
): KyrubAiConsultantResponse => {
  if (
    response.mode !== 'deterministic' ||
    response.actionProposal ||
    !/plano Pro/i.test(response.reply) ||
    !/Nenhum produto foi criado agora/i.test(response.reply) ||
    !/explicar o que ele libera/i.test(response.reply)
  ) {
    return response;
  }

  return {
    ...response,
    turnContext: createKyrubiaCapacityPlanTurnContext(storeId),
  };
};