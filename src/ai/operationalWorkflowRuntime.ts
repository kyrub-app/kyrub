import type { KyrubAiConsultantResponse } from '../../shared/aiConsultant';
import type { KyrubErpContextSnapshot } from '../../shared/kyrubErpContext';
import {
  discardKyrubiaOperationalWorkflow,
  getKyrubiaProductSequenceProgress,
  loadKyrubiaOperationalWorkflow,
  saveKyrubiaOperationalWorkflow,
  type KyrubiaOperationalWorkflow,
} from './operationalWorkflowStore';
import {
  resolveKyrubiaOperationalWorkflow as resolveLegacyKyrubiaOperationalWorkflow,
} from './operationalWorkflowRuntimeLegacy';

const FREE_PLAN_PRODUCT_LIMIT = 5;
const REQUESTED_PRODUCT_WORDS: Record<string, number> = {
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

const createRequestId = (): string => {
  try {
    return globalThis.crypto.randomUUID();
  } catch {
    return `kyrub-batch-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
};

const response = (reply: string): KyrubAiConsultantResponse => ({
  reply,
  provider: 'kyrub',
  model: 'kyrub-operational-runtime-v1',
  mode: 'deterministic',
  requestId: createRequestId(),
  capabilities: {
    actionsEnabled: true,
    enabledActions: [
      'create_note',
      'start_store_activation',
      'update_store_profile',
      'create_product',
    ],
    enabledReadActions: [
      'read_store_summary',
      'list_products',
      'list_low_stock_products',
      'list_pending_orders',
    ],
    voiceEnabled: false,
    persistentCloudHistoryEnabled: false,
  },
});

const normalized = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/\s+/g, ' ')
    .trim();

const parseRequestedProductCount = (message: string): number => {
  const intent = normalized(message);
  const numeric = /\b(\d{1,2})\s+(?:novos?\s+)?(?:produtos?|itens?|servicos?)\b/.exec(intent);
  if (numeric?.[1]) {
    return Math.min(50, Math.max(1, Number.parseInt(numeric[1], 10)));
  }
  const written = /\b(um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez)\s+(?:novos?\s+)?(?:produtos?|itens?|servicos?)\b/.exec(intent);
  return written?.[1] ? REQUESTED_PRODUCT_WORDS[written[1]] ?? 1 : 1;
};

const isProductCreationIntent = (message: string): boolean => {
  const intent = normalized(message);
  return /\b(crie|criar|cadastre|cadastrar|adicione|adicionar|inclua|incluir)\b/.test(intent) &&
    /\b(produto|produtos|item|itens|servico|servicos)\b/.test(intent);
};

const isServiceIntent = (message: string): boolean => {
  const intent = normalized(message);
  return /\bservico|servicos\b/.test(intent) && !/\bproduto|produtos\b/.test(intent);
};

const productCapacityPreflight = (
  context: KyrubErpContextSnapshot | undefined,
  requestedCount: number,
  sequenceStarted = false
): KyrubAiConsultantResponse | null => {
  if (
    !context ||
    context.store?.plan !== 'free' ||
    context.availability.products !== true
  ) {
    return null;
  }

  const currentCount = Math.max(0, Math.trunc(context.productCount));
  const remaining = Math.max(0, FREE_PLAN_PRODUCT_LIMIT - currentCount);
  if (requestedCount <= remaining) return null;

  if (remaining === 0) {
    if (sequenceStarted) {
      return response(
        `Sua loja chegou aos ${FREE_PLAN_PRODUCT_LIMIT} produtos incluídos no plano atual (Free) durante este cadastro. O item anterior foi criado, mas interrompi a sequência antes de criar outro. Para continuar ampliando o catálogo, o próximo passo é o plano Pro. O Business não é necessário para essa necessidade agora.`
      );
    }
    return response(
      `Sua loja já está usando os ${FREE_PLAN_PRODUCT_LIMIT} produtos incluídos no plano atual (Free). Você quer continuar ampliando o catálogo, mas o plano chegou ao limite. Para cadastrar mais ${requestedCount === 1 ? 'um produto' : `${requestedCount} produtos`}, o próximo passo é fazer upgrade para o plano Pro. Não recomendo upgrade para o plano Business, porque o Pro já atende essa necessidade. A contratação do Pro ainda será conectada ao fluxo de planos do Kyrub; por enquanto posso te explicar o que ele libera. Nenhum produto foi criado agora.`
    );
  }

  return response(
    `Sua loja está usando ${currentCount} dos ${FREE_PLAN_PRODUCT_LIMIT} produtos incluídos no plano atual (Free). Você pediu ${requestedCount} novos produtos, mas há espaço para apenas ${remaining}. Posso usar ${remaining === 1 ? 'essa última vaga' : `essas ${remaining} vagas`} agora, mas para cadastrar todos será necessário evoluir para o plano Pro. O plano Business não é necessário para essa necessidade agora. Você prefere cadastrar ${remaining === 1 ? '1 produto' : `${remaining} produtos`} agora ou conhecer o Pro? A contratação do Pro ainda será conectada ao fluxo de planos do Kyrub. Nenhum produto foi criado ainda.`
  );
};

const looksLikeMultipleNames = (message: string): boolean => {
  const value = message.trim();
  if (/[,;\n]/.test(value)) return true;
  return value.split(/\s+e\s+/i).map(part => part.trim()).filter(Boolean).length > 1;
};

const hasMultipleNumericAnswers = (message: string): boolean =>
  (message.match(/\d+(?:[.,]\d{1,2})?/g)?.length ?? 0) > 1;

const nameQuestion = (workflow: KyrubiaOperationalWorkflow): string => {
  const progress = getKyrubiaProductSequenceProgress(workflow);
  return `Qual será o nome do produto ${progress.completedCount + 1} de ${progress.requestedCount}? Informe somente este nome; vamos cadastrar um produto por vez.`;
};

const saveBatchWorkflow = (
  storage: Storage,
  input: Parameters<typeof resolveLegacyKyrubiaOperationalWorkflow>[0],
  requestedCount: number
): KyrubiaOperationalWorkflow => {
  const workflow: KyrubiaOperationalWorkflow = {
    version: 1,
    conversationId: input.conversationId,
    userId: input.user.uid,
    objective: 'create_product',
    stage: 'collecting_product_name',
    productDraft: { isService: isServiceIntent(input.message) },
    requestedProductCount: requestedCount,
    completedProductCount: 0,
    updatedAt: new Date().toISOString(),
  };
  saveKyrubiaOperationalWorkflow(storage, workflow);
  return workflow;
};

const enrichLegacyBatchResult = (
  storage: Storage,
  userId: string,
  conversationId: string,
  result: KyrubAiConsultantResponse | null
): KyrubAiConsultantResponse | null => {
  if (!result) return result;
  const workflow = loadKyrubiaOperationalWorkflow(storage, userId, conversationId);
  if (!workflow || getKyrubiaProductSequenceProgress(workflow).requestedCount <= 1) {
    return result;
  }

  const progress = getKyrubiaProductSequenceProgress(workflow);
  if (result.actionProposal?.type === 'create_product') {
    return {
      ...result,
      reply: `Produto ${progress.completedCount + 1} de ${progress.requestedCount}\n\n${result.reply}`,
    };
  }
  if (workflow.stage === 'collecting_product_name') {
    return {
      ...result,
      reply: result.reply.includes('Loja ativada')
        ? `Loja ativada. Agora vou retomar seu cadastro sequencial. ${nameQuestion(workflow)}`
        : nameQuestion(workflow),
    };
  }
  return result;
};

export const resolveKyrubiaOperationalWorkflow = async (
  input: Parameters<typeof resolveLegacyKyrubiaOperationalWorkflow>[0]
): ReturnType<typeof resolveLegacyKyrubiaOperationalWorkflow> => {
  if (typeof localStorage === 'undefined') {
    return resolveLegacyKyrubiaOperationalWorkflow(input);
  }

  const storage = localStorage;
  const existing = loadKyrubiaOperationalWorkflow(
    storage,
    input.user.uid,
    input.conversationId
  );

  if (existing) {
    const progress = getKyrubiaProductSequenceProgress(existing);
    if (existing.objective === 'create_product' && progress.requestedCount > 1) {
      if (existing.stage === 'collecting_product_name') {
        const remainingRequested = Math.max(
          1,
          progress.requestedCount - progress.completedCount
        );
        const capacityResponse = productCapacityPreflight(
          input.erpContext,
          remainingRequested,
          progress.completedCount > 0
        );
        if (capacityResponse) {
          discardKyrubiaOperationalWorkflow(
            storage,
            input.user.uid,
            input.conversationId
          );
          return capacityResponse;
        }
        if (looksLikeMultipleNames(input.message)) {
          return response(`Vamos cadastrar um por vez para não misturar os dados. ${nameQuestion(existing)}`);
        }
      }
      if (
        (existing.stage === 'collecting_product_price' ||
          existing.stage === 'collecting_product_stock') &&
        hasMultipleNumericAnswers(input.message)
      ) {
        const label = existing.stage === 'collecting_product_price'
          ? 'preço'
          : 'quantidade atual';
        return response(
          `Vamos manter os produtos separados. Informe somente o ${label} de “${existing.productDraft.name ?? 'este item'}”.`
        );
      }
    }

    const result = await resolveLegacyKyrubiaOperationalWorkflow(input);
    return enrichLegacyBatchResult(
      storage,
      input.user.uid,
      input.conversationId,
      result
    );
  }

  if (!isProductCreationIntent(input.message)) {
    return resolveLegacyKyrubiaOperationalWorkflow(input);
  }

  const requestedCount = parseRequestedProductCount(input.message);
  const capacityResponse = productCapacityPreflight(
    input.erpContext,
    requestedCount
  );
  if (capacityResponse) return capacityResponse;

  if (requestedCount <= 1) {
    return resolveLegacyKyrubiaOperationalWorkflow(input);
  }

  if (input.erpContext?.store?.configured !== true) {
    const result = await resolveLegacyKyrubiaOperationalWorkflow(input);
    const workflow = loadKyrubiaOperationalWorkflow(
      storage,
      input.user.uid,
      input.conversationId
    );
    if (workflow?.objective === 'create_product') {
      saveKyrubiaOperationalWorkflow(storage, {
        ...workflow,
        productDraft: { isService: isServiceIntent(input.message) },
        requestedProductCount: requestedCount,
        completedProductCount: 0,
        updatedAt: new Date().toISOString(),
      });
    }
    return result;
  }

  const workflow = saveBatchWorkflow(storage, input, requestedCount);
  return response(
    `Consigo cadastrar os ${requestedCount} produtos com revisão e confirmação individual antes de cada gravação. Vamos um por vez. ${nameQuestion(workflow)}`
  );
};
