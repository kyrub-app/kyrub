import type { User } from 'firebase/auth';
import type { KyrubAiConsultantResponse } from '../../shared/aiConsultant';
import type { KyrubErpContextSnapshot } from '../../shared/kyrubErpContext';
import type {
  KyrubAiCreateProductProposal,
  KyrubAiStartStoreActivationProposal,
  KyrubAiUpdateStoreProfileProposal,
  KyrubStoreProfilePatch,
} from '../../shared/kyrubActions';
import { executePreauthorizedStoreProfileAction } from '../actions/kyrubActionService';
import { invalidateKyrubErpContext } from '../actions/erpReadActionService';
import { resolveKyrubiaDeterministicStoreProfileUpdate } from './deterministicStoreProfileUpdate';
import {
  clearKyrubiaOperationalWorkflow,
  discardKyrubiaOperationalWorkflow,
  getKyrubiaProductSequenceProgress,
  loadKyrubiaOperationalWorkflow,
  saveKyrubiaOperationalWorkflow,
  type KyrubiaOperationalWorkflow,
  type KyrubiaOperationalWorkflowStage,
  type KyrubiaProductDraft,
} from './operationalWorkflowStore';

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
    return `kyrub-workflow-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
};

const response = (
  reply: string,
  actionProposal?: KyrubAiConsultantResponse['actionProposal']
): KyrubAiConsultantResponse => ({
  reply,
  provider: 'kyrub',
  model: 'kyrub-operational-runtime-v1',
  mode: 'deterministic',
  requestId: createRequestId(),
  ...(actionProposal ? { actionProposal } : {}),
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

const localizedNumber = (value: string | undefined): number | undefined => {
  if (!value) return undefined;
  const parsed = Number(value.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
};

const stripAnswerPrefix = (value: string): string =>
  value
    .trim()
    .replace(/^(?:o nome (?:e|é)|vai se chamar|chama-se|nome|categoria (?:e|é)|categoria|estoque (?:e|é)|estoque|preco (?:e|é)|preco|o preco (?:e|é)|o preço (?:e|é)|preço)\s*[:=-]?\s*/i, '')
    .replace(/^["“”']+|["“”']+$/g, '')
    .trim();

const parsePrice = (message: string): {
  price?: number;
  isComplimentary?: boolean;
} => {
  const intent = normalized(message);
  if (/\b(gratis|gratuito|gratuita|cortesia)\b/.test(intent)) {
    return { price: 0, isComplimentary: true };
  }
  const match =
    /r\$\s*(\d+(?:[.,]\d{1,2})?)/i.exec(message) ??
    /(?:pre[cç]o|valor)\s*(?:de|e|é|:)?\s*(\d+(?:[.,]\d{1,2})?)/i.exec(message) ??
    /(?:por|a)\s+(\d+(?:[.,]\d{1,2})?)\s*(?:reais)?\b/i.exec(message);
  const price = localizedNumber(match?.[1]);
  return price === undefined ? {} : { price, isComplimentary: false };
};

const parseStock = (message: string): number | undefined => {
  const intent = normalized(message);
  if (/\bsem estoque\b|\bestoque zerado\b/.test(intent)) return 0;
  const match =
    /estoque\s*(?:de|e|é|:)?\s*(\d+)\b/i.exec(message) ??
    /(?:com|tenho)\s+(\d+)\s+unidades?\b/i.exec(message) ??
    /\b(\d+)\s+unidades?\s+(?:em )?estoque\b/i.exec(message);
  const parsed = localizedNumber(match?.[1]);
  return parsed === undefined ? undefined : Math.trunc(parsed);
};

const parseCategory = (message: string): string | undefined => {
  const match = /categoria\s*(?:de|e|é|:)?\s*["“]?([^,.!?"”]+)["”]?/i.exec(message);
  const value = match?.[1]?.trim();
  return value || undefined;
};

const parseProductName = (message: string): string | undefined => {
  const match = /\b(?:produto|item|servi[cç]o)\s+(?:(?:chamado|chamada|de nome)\s+)?["“]?([^,.!?"”]+?)["”]?(?=\s+(?:por\s+r\$|por\s+\d|a\s+r\$|pre[cç]o|valor|categoria|com\s+estoque|estoque)|$)/i.exec(message);
  const value = match?.[1]?.trim();
  if (!value || /^(?:novo|nova|me ajude|para minha loja|na minha loja)$/i.test(value)) {
    return undefined;
  }
  return value.replace(/^(?:um|uma)\s+/i, '').trim() || undefined;
};

const parseInitialProductDraft = (message: string): KyrubiaProductDraft | null => {
  const intent = normalized(message);
  const createVerb = /\b(crie|criar|cadastre|cadastrar|adicione|adicionar|inclua|incluir)\b/.test(intent);
  const productSignal = /\b(produto|produtos|item|itens|servico|servicos)\b/.test(intent);
  if (!createVerb || !productSignal) return null;

  const isService = /\bservico|servicos\b/.test(intent) && !/\bproduto|produtos\b/.test(intent);
  const price = parsePrice(message);
  return {
    ...(parseProductName(message) ? { name: parseProductName(message) } : {}),
    ...(price.price !== undefined ? { price: price.price } : {}),
    ...(price.isComplimentary !== undefined
      ? { isComplimentary: price.isComplimentary }
      : {}),
    ...(parseCategory(message) ? { category: parseCategory(message) } : {}),
    ...(parseStock(message) !== undefined ? { stock: parseStock(message) } : {}),
    isService,
  };
};

const asksToActivateStore = (message: string): boolean => {
  const intent = normalized(message);
  return /\b(ativar|ative|configurar|configure)\b/.test(intent) &&
    /\b(loja|estabelecimento|negocio)\b/.test(intent);
};

const activationProposal = (
  objective: KyrubiaOperationalWorkflow['objective']
): KyrubAiStartStoreActivationProposal => ({
  id: createRequestId(),
  type: 'start_store_activation',
  purpose: objective === 'create_product' ? 'create_product' : 'store_setup',
  requiresConfirmation: true,
  origin: 'kyrubia',
  risk: 'low',
  inputProvenance: 'user_intent',
  impact: { entityCount: 1, reversibility: 'easy' },
});

const profilePatchSummary = (patch: KyrubStoreProfilePatch): string => {
  if (patch.name !== undefined) return `Nome da loja: ${patch.name}`;
  if (patch.description !== undefined) return `Descrição: ${patch.description}`;
  if (patch.address !== undefined) return `Endereço: ${patch.address}`;
  if (patch.contact !== undefined) return `Contato: ${patch.contact}`;
  if (patch.keywords !== undefined) return `Palavras-chave: ${patch.keywords.join(', ')}`;
  return 'Perfil da loja';
};

const standaloneStoreProfileProposal = (
  patch: KyrubStoreProfilePatch
): KyrubAiUpdateStoreProfileProposal => ({
  id: createRequestId(),
  type: 'update_store_profile',
  patch,
  requiresConfirmation: true,
  origin: 'kyrubia',
  risk: 'low',
  inputProvenance: 'user_intent',
  impact: { entityCount: 1, reversibility: 'easy' },
});

const nextProductStage = (
  draft: KyrubiaProductDraft
): KyrubiaOperationalWorkflowStage | 'ready' => {
  if (!draft.name?.trim()) return 'collecting_product_name';
  if (draft.price === undefined || !Number.isFinite(draft.price) || draft.price < 0) {
    return 'collecting_product_price';
  }
  if (!draft.category?.trim()) return 'collecting_product_category';
  if (draft.isService !== true && (
    draft.stock === undefined ||
    !Number.isInteger(draft.stock) ||
    draft.stock < 0
  )) {
    return 'collecting_product_stock';
  }
  return 'ready';
};

const questionForProductStage = (
  stage: KyrubiaOperationalWorkflowStage,
  draft: KyrubiaProductDraft,
  workflow?: KyrubiaOperationalWorkflow
): string => {
  switch (stage) {
    case 'collecting_product_name': {
      if (workflow) {
        const progress = getKyrubiaProductSequenceProgress(workflow);
        if (progress.requestedCount > 1) {
          return `Qual será o nome do produto ${progress.completedCount + 1} de ${progress.requestedCount}? Informe somente este nome; vamos cadastrar um produto por vez.`;
        }
      }
      return 'Qual será o nome do produto ou serviço?';
    }
    case 'collecting_product_price':
      return `Qual será o preço de “${draft.name ?? 'este item'}”? Você também pode dizer “grátis”.`;
    case 'collecting_product_category':
      return `Em qual categoria da loja “${draft.name ?? 'este item'}” deve ficar?`;
    case 'collecting_product_stock':
      return `Quantas unidades de “${draft.name ?? 'este produto'}” estão disponíveis agora? Se ainda não houver estoque, diga 0.`;
    default:
      return '';
  }
};

const isBatchWorkflow = (workflow: KyrubiaOperationalWorkflow): boolean =>
  getKyrubiaProductSequenceProgress(workflow).requestedCount > 1;

const looksLikeMultipleNames = (message: string): boolean => {
  const value = stripAnswerPrefix(message);
  if (/[,;\n]/.test(value)) return true;
  return value.split(/\s+e\s+/i).map(part => part.trim()).filter(Boolean).length > 1;
};

const hasMultipleNumericAnswers = (message: string): boolean =>
  (message.match(/\d+(?:[.,]\d{1,2})?/g)?.length ?? 0) > 1;

const createProductProposal = (
  draft: KyrubiaProductDraft
): KyrubAiCreateProductProposal => ({
  id: createRequestId(),
  type: 'create_product',
  name: draft.name?.trim() ?? '',
  description: draft.description?.trim() ?? '',
  price: draft.isComplimentary === true ? 0 : draft.price ?? 0,
  stock: draft.isService === true ? 0 : draft.stock ?? 0,
  category: draft.category?.trim() ?? '',
  image: draft.image?.trim() ?? '',
  isService: draft.isService === true,
  isComplimentary: draft.isComplimentary === true,
  requiresConfirmation: true,
  origin: 'kyrubia',
  risk: 'medium',
  inputProvenance: 'user_intent',
  impact: { entityCount: 1, reversibility: 'limited' },
});

const productReviewResponse = (
  workflow: KyrubiaOperationalWorkflow
): KyrubAiConsultantResponse => {
  const draft = workflow.productDraft;
  const proposal = createProductProposal(draft);
  const typeLabel = proposal.isService ? 'Serviço' : 'Produto';
  const stockLine = proposal.isService
    ? ''
    : `\n- Estoque: ${proposal.stock} ${proposal.stock === 1 ? 'unidade' : 'unidades'}`;
  const progress = getKyrubiaProductSequenceProgress(workflow);
  const sequenceLine = progress.requestedCount > 1
    ? `Produto ${progress.completedCount + 1} de ${progress.requestedCount}\n\n`
    : '';
  return response(
    `${sequenceLine}Tudo pronto para cadastrar:\n- ${typeLabel}: ${proposal.name}\n- Preço: ${proposal.isComplimentary ? 'grátis' : proposal.price.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}\n- Categoria: ${proposal.category}${stockLine}\n\nRevise e confirme antes de eu publicar o item no catálogo da sua loja.`,
    proposal
  );
};

const saveProductStage = (
  storage: Storage,
  workflow: KyrubiaOperationalWorkflow,
  draft: KyrubiaProductDraft
): KyrubAiConsultantResponse => {
  const stage = nextProductStage(draft);
  if (stage === 'ready') {
    const next = {
      ...workflow,
      productDraft: draft,
      stage: 'awaiting_product_confirmation' as const,
      updatedAt: new Date().toISOString(),
    };
    saveKyrubiaOperationalWorkflow(storage, next);
    return productReviewResponse(next);
  }

  const next = {
    ...workflow,
    productDraft: draft,
    stage,
    updatedAt: new Date().toISOString(),
  };
  saveKyrubiaOperationalWorkflow(storage, next);
  return response(questionForProductStage(stage, draft, next));
};

const updateStoreProfile = async (
  user: User,
  workflow: KyrubiaOperationalWorkflow,
  patch: KyrubAiUpdateStoreProfileProposal['patch']
): Promise<void> => {
  const grant = workflow.activationGrant;
  if (!grant) {
    throw new Error('A ativação da loja precisa ser confirmada novamente.');
  }
  const proposal: KyrubAiUpdateStoreProfileProposal = {
    id: createRequestId(),
    type: 'update_store_profile',
    activationGrantId: grant.id,
    patch,
    requiresConfirmation: false,
    origin: 'kyrubia',
    risk: 'low',
    inputProvenance: 'user_intent',
    impact: { entityCount: 1, reversibility: 'easy' },
  };
  await executePreauthorizedStoreProfileAction(user, proposal);
  invalidateKyrubErpContext(user.uid);
};

const handleExistingWorkflow = async (
  storage: Storage,
  user: User,
  workflow: KyrubiaOperationalWorkflow,
  message: string,
  erpContext?: KyrubErpContextSnapshot
): Promise<KyrubAiConsultantResponse> => {
  switch (workflow.stage) {
    case 'awaiting_store_activation_confirmation':
      return response(
        'Para continuar, confirme a ativação da loja na janela de revisão. Nada será publicado no marketplace por essa confirmação.',
        activationProposal(workflow.objective)
      );

    case 'collecting_store_name': {
      const name = stripAnswerPrefix(message);
      if (!name || name.length < 2) {
        return response('Qual será o nome da sua loja?');
      }
      await updateStoreProfile(user, workflow, { name });
      const next = {
        ...workflow,
        stage: 'collecting_store_keywords' as const,
        updatedAt: new Date().toISOString(),
      };
      saveKyrubiaOperationalWorkflow(storage, next);
      return response(
        `Perfeito. “${name}” já foi salvo no perfil da sua loja. Agora me diga de 1 a 5 palavras-chave do que você vende ou oferece, separadas por vírgula. Ex.: roupas, camisetas, moda masculina.`
      );
    }

    case 'collecting_store_keywords': {
      const keywords = message
        .split(/[,;\n]+/)
        .map(item => item.trim().toLocaleLowerCase('pt-BR'))
        .filter(Boolean)
        .slice(0, 5);
      if (keywords.length === 0) {
        return response('Informe pelo menos uma palavra-chave sobre o que sua loja vende ou oferece.');
      }
      await updateStoreProfile(user, workflow, { keywords });

      if (workflow.objective === 'store_setup') {
        clearKyrubiaOperationalWorkflow(storage, user.uid, workflow.conversationId);
        return response(
          'Sua loja está ativada no Kyrub. O perfil privado foi configurado e a loja continua fora do marketplace até você decidir publicá-la.'
        );
      }

      const productStage = nextProductStage(workflow.productDraft);
      if (productStage === 'ready') {
        const next = {
          ...workflow,
          stage: 'awaiting_product_confirmation' as const,
          updatedAt: new Date().toISOString(),
        };
        saveKyrubiaOperationalWorkflow(storage, next);
        return productReviewResponse(next);
      }

      const next = {
        ...workflow,
        stage: productStage,
        updatedAt: new Date().toISOString(),
      };
      saveKyrubiaOperationalWorkflow(storage, next);
      return response(
        `Loja ativada. Agora vou retomar o produto que você estava cadastrando. ${questionForProductStage(productStage, workflow.productDraft, next)}`
      );
    }

    case 'collecting_product_name': {
      if (isBatchWorkflow(workflow)) {
        const progress = getKyrubiaProductSequenceProgress(workflow);
        const remainingRequested = Math.max(
          1,
          progress.requestedCount - progress.completedCount
        );
        const capacityResponse = productCapacityPreflight(
          erpContext,
          remainingRequested,
          progress.completedCount > 0
        );
        if (capacityResponse) {
          discardKyrubiaOperationalWorkflow(
            storage,
            user.uid,
            workflow.conversationId
          );
          return capacityResponse;
        }
        if (looksLikeMultipleNames(message)) {
          return response(
            `Vamos cadastrar um por vez para não misturar os dados. ${questionForProductStage('collecting_product_name', workflow.productDraft, workflow)}`
          );
        }
      }
      const name = stripAnswerPrefix(message);
      if (!name) {
        return response(questionForProductStage('collecting_product_name', workflow.productDraft, workflow));
      }
      return saveProductStage(storage, workflow, {
        ...workflow.productDraft,
        name,
      });
    }

    case 'collecting_product_price': {
      if (isBatchWorkflow(workflow) && hasMultipleNumericAnswers(message)) {
        return response(
          `Vamos manter os produtos separados. Informe somente o preço de “${workflow.productDraft.name ?? 'este item'}”. Ex.: R$ 39,90.`
        );
      }
      const parsed = parsePrice(message);
      if (parsed.price === undefined) {
        const direct = localizedNumber(stripAnswerPrefix(message));
        if (direct === undefined) {
          return response('Qual será o preço? Ex.: R$ 39,90. Se for gratuito, diga “grátis”.');
        }
        return saveProductStage(storage, workflow, {
          ...workflow.productDraft,
          price: direct,
          isComplimentary: false,
        });
      }
      return saveProductStage(storage, workflow, {
        ...workflow.productDraft,
        price: parsed.price,
        isComplimentary: parsed.isComplimentary,
      });
    }

    case 'collecting_product_category': {
      const category = stripAnswerPrefix(message);
      if (!category) return response('Em qual categoria este item deve ficar?');
      return saveProductStage(storage, workflow, {
        ...workflow.productDraft,
        category,
      });
    }

    case 'collecting_product_stock': {
      if (isBatchWorkflow(workflow) && hasMultipleNumericAnswers(message)) {
        return response(
          `Vamos manter os produtos separados. Informe somente a quantidade atual de “${workflow.productDraft.name ?? 'este produto'}”. Ex.: 12.`
        );
      }
      const stock = parseStock(message) ?? localizedNumber(stripAnswerPrefix(message));
      if (stock === undefined || !Number.isInteger(stock)) {
        return response('Informe a quantidade atual em unidades. Ex.: 12. Se estiver sem estoque, diga 0.');
      }
      return saveProductStage(storage, workflow, {
        ...workflow.productDraft,
        stock,
      });
    }

    case 'awaiting_product_confirmation':
      return productReviewResponse(workflow);
  }
};

export const resolveKyrubiaOperationalWorkflow = async (
  input: {
    user: User;
    conversationId: string;
    message: string;
    erpContext?: KyrubErpContextSnapshot;
  }
): Promise<KyrubAiConsultantResponse | null> => {
  if (typeof localStorage === 'undefined') return null;
  const storage = localStorage;
  const existing = loadKyrubiaOperationalWorkflow(
    storage,
    input.user.uid,
    input.conversationId
  );
  if (existing) {
    return handleExistingWorkflow(
      storage,
      input.user,
      existing,
      input.message,
      input.erpContext
    );
  }

  const profileUpdate = resolveKyrubiaDeterministicStoreProfileUpdate(input.message);
  const productDraft = parseInitialProductDraft(input.message);
  const activationRequest = asksToActivateStore(input.message);
  if (!profileUpdate && !productDraft && !activationRequest) return null;

  const storeConfigured = input.erpContext?.store?.configured === true;
  if (profileUpdate) {
    if (!storeConfigured) {
      return response(
        'Sua loja ainda não está ativada. Ative a loja primeiro; depois eu consigo alterar nome, descrição, endereço, contato ou palavras-chave sem depender da IA generativa.'
      );
    }
    const proposal = standaloneStoreProfileProposal(profileUpdate.patch);
    return response(
      `Tudo pronto para alterar o perfil da sua loja:\n- ${profilePatchSummary(profileUpdate.patch)}\n\nRevise e confirme antes de eu salvar essa mudança.`,
      proposal
    );
  }

  const objective: KyrubiaOperationalWorkflow['objective'] = productDraft
    ? 'create_product'
    : 'store_setup';
  const requestedProductCount = productDraft
    ? parseRequestedProductCount(input.message)
    : 1;
  const workflowProductDraft: KyrubiaProductDraft = productDraft
    ? requestedProductCount > 1
      ? { isService: productDraft.isService === true }
      : productDraft
    : {};

  if (!storeConfigured) {
    const workflow: KyrubiaOperationalWorkflow = {
      version: 1,
      conversationId: input.conversationId,
      userId: input.user.uid,
      objective,
      stage: 'awaiting_store_activation_confirmation',
      productDraft: workflowProductDraft,
      ...(productDraft
        ? {
            requestedProductCount,
            completedProductCount: 0,
          }
        : {}),
      updatedAt: new Date().toISOString(),
    };
    saveKyrubiaOperationalWorkflow(storage, workflow);
    const reason = productDraft
      ? 'Para cadastrar esse item, sua loja precisa estar ativada primeiro.'
      : 'Sua loja ainda não está ativada.';
    return response(
      `${reason} Quer ativá-la agora? A ativação cria/configura o perfil privado da sua loja; ela não será publicada no marketplace automaticamente.`,
      activationProposal(objective)
    );
  }

  if (!productDraft) {
    return response('Sua loja já está ativada. Posso ajudar a completar ou alterar o perfil quando você quiser.');
  }

  const capacityResponse = productCapacityPreflight(
    input.erpContext,
    requestedProductCount
  );
  if (capacityResponse) return capacityResponse;

  const workflow: KyrubiaOperationalWorkflow = {
    version: 1,
    conversationId: input.conversationId,
    userId: input.user.uid,
    objective: 'create_product',
    stage: 'collecting_product_name',
    productDraft: workflowProductDraft,
    requestedProductCount,
    completedProductCount: 0,
    updatedAt: new Date().toISOString(),
  };

  if (requestedProductCount > 1) {
    saveKyrubiaOperationalWorkflow(storage, workflow);
    return response(
      `Consigo cadastrar os ${requestedProductCount} produtos com revisão e confirmação individual antes de cada gravação. Vamos um por vez. ${questionForProductStage('collecting_product_name', workflow.productDraft, workflow)}`
    );
  }

  return saveProductStage(storage, workflow, workflowProductDraft);
};
