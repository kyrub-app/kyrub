import { randomUUID } from 'node:crypto';
import type {
  KyrubiaMercadoLivreCategoryOfferedIntent,
  KyrubiaTurnContext,
} from '../../shared/kyrubiaContext.js';
import {
  resolveKyrubiaOfferedIntentSelection,
  selectKyrubiaOfferedIntentContext,
} from '../../shared/kyrubiaContext.js';
import type {
  KyrubErpContextSnapshot,
  KyrubErpOrderSummary,
  KyrubErpProductSummary,
  KyrubErpStoreSummary,
} from '../../shared/kyrubErpContext.js';
import {
  inspectMercadoLivreRequirementCategoryOptions,
  type MercadoLivreRequirementCategoryOptions,
} from '../integrations/mercadoLivreRequirementOptionsService.js';
import { authenticateConsultantRequest } from './consultantAuth.js';
import { ConsultantHttpError } from './types.js';
import { buildKyrubiaSystemInstruction } from './kyrubiaSystemInstruction.js';
import { runKyrubiaUserProviderToolLoop } from './kyrubiaUserProviderToolLoop.js';

const MAX_MESSAGES = 24;
const MAX_MESSAGE_CHARACTERS = 4_000;
const MAX_TOTAL_CHARACTERS = 16_000;
const MAX_TOPIC_CHARACTERS = 80;
const MAX_SCREEN_CONTEXT_CHARACTERS = 240;
const MAX_ERP_PRODUCTS = 120;
const MAX_ERP_ORDERS = 30;

const byoCapabilities = {
  actionsEnabled: true,
  enabledActions: ['create_note'] as const,
  enabledReadActions: [
    'read_store_summary',
    'list_products',
    'list_low_stock_products',
    'list_pending_orders',
  ] as const,
  voiceEnabled: false,
  persistentCloudHistoryEnabled: false,
  multimodalAttachmentsEnabled: false,
  providerResilienceEnabled: false,
  usageMeteringEnabled: true,
};

export type KyrubiaUserProviderChatBody =
  | {
      status: 'user_provider';
      reply: string;
      provider: 'google-gemini' | 'openai' | 'anthropic';
      model: string;
      mode: 'conversation';
      requestId: string;
      actionProposal?: {
        id: string;
        type: 'create_note';
        title: string;
        content: string;
        checklist: string[];
        requiresConfirmation: true;
      };
      turnContext?: KyrubiaTurnContext;
      capabilities: typeof byoCapabilities;
      funding: 'user_provider';
      usage: {
        inputTokens?: number;
        outputTokens?: number;
        totalTokens?: number;
      };
    }
  | {
      status: 'deterministic';
      reply: string;
      provider: 'kyrub';
      model: 'kyrub-runtime-v1';
      mode: 'deterministic';
      requestId: string;
      turnContext: KyrubiaTurnContext;
      capabilities: typeof byoCapabilities;
      funding: 'none';
      usage: Record<string, never>;
    }
  | {
      status: 'legacy_allowed';
      reason: 'no_user_provider' | 'multimodal_not_normalized';
      requestId: string;
    }
  | {
      status: 'selection_required';
      availableProviders: Array<'google-gemini' | 'openai' | 'anthropic'>;
      requestId: string;
      error: string;
      code: 'AI_PROVIDER_SELECTION_REQUIRED';
    }
  | {
      status: 'provider_failed';
      provider: 'google-gemini' | 'openai' | 'anthropic';
      requestId: string;
      error: string;
      code: string;
    };

export type KyrubiaUserProviderChatResult = {
  httpStatus: number;
  body: KyrubiaUserProviderChatBody;
};

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const clean = (value: unknown, maximum: number): string =>
  typeof value === 'string' ? value.trim().slice(0, maximum) : '';

const finite = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const nonNegativeInteger = (value: unknown, fallback = 0): number =>
  Math.max(0, Math.trunc(finite(value, fallback)));

const normalizeStore = (value: unknown): KyrubErpStoreSummary | null => {
  const raw = record(value);
  const id = clean(raw.id, 128);
  if (!id) return null;
  const plan = raw.plan === 'pro' || raw.plan === 'business' ? raw.plan : 'free';
  const status = raw.status === 'open' || raw.status === 'delayed' ? raw.status : 'closed';
  return {
    id,
    name: clean(raw.name, 160),
    description: clean(raw.description, 800),
    plan,
    status,
    address: clean(raw.address, 320),
    keywords: Array.isArray(raw.keywords)
      ? raw.keywords.map(item => clean(item, 80)).filter(Boolean).slice(0, 30)
      : [],
    configured: raw.configured === true,
  };
};

const normalizeProduct = (value: unknown): KyrubErpProductSummary | null => {
  const raw = record(value);
  const id = clean(raw.id, 160);
  const name = clean(raw.name, 180);
  const price = finite(raw.price, -1);
  const stock = finite(raw.stock, -1);
  if (!id || !name || price < 0 || stock < 0) return null;
  return {
    id,
    name,
    category: clean(raw.category, 120),
    price,
    stock: Math.trunc(stock),
    isService: raw.isService === true,
    hasDescription: raw.hasDescription === true,
    hasImage: raw.hasImage === true,
  };
};

const normalizeOrder = (value: unknown): KyrubErpOrderSummary | null => {
  const raw = record(value);
  const id = clean(raw.id, 180);
  const total = finite(raw.total, -1);
  if (!id || total < 0) return null;
  return {
    id,
    status: clean(raw.status, 80),
    paymentStatus: clean(raw.paymentStatus, 80),
    fulfillmentType: clean(raw.fulfillmentType, 80),
    total,
    itemCount: nonNegativeInteger(raw.itemCount),
    createdAt: clean(raw.createdAt, 80),
  };
};

const normalizeErpContext = (value: unknown): KyrubErpContextSnapshot | null => {
  const raw = record(value);
  if (raw.source !== 'authenticated_client_snapshot') return null;
  const availability = record(raw.availability);
  const products = Array.isArray(raw.products)
    ? raw.products.flatMap(item => {
        const product = normalizeProduct(item);
        return product ? [product] : [];
      }).slice(0, MAX_ERP_PRODUCTS)
    : [];
  const pendingOrders = Array.isArray(raw.pendingOrders)
    ? raw.pendingOrders.flatMap(item => {
        const order = normalizeOrder(item);
        return order ? [order] : [];
      }).slice(0, MAX_ERP_ORDERS)
    : [];
  return {
    source: 'authenticated_client_snapshot',
    generatedAt: clean(raw.generatedAt, 80),
    store: normalizeStore(raw.store),
    products,
    productCount: nonNegativeInteger(raw.productCount, products.length),
    productsTruncated: raw.productsTruncated === true,
    pendingOrders,
    pendingOrderCount: nonNegativeInteger(raw.pendingOrderCount, pendingOrders.length),
    ordersTruncated: raw.ordersTruncated === true,
    lowStockThreshold: Math.min(999_999, nonNegativeInteger(raw.lowStockThreshold, 5)),
    availability: {
      store: availability.store === true,
      products: availability.products === true,
      orders: availability.orders === true,
    },
    warnings: Array.isArray(raw.warnings)
      ? raw.warnings.map(item => clean(item, 180)).filter(Boolean).slice(0, 8)
      : [],
  };
};

const normalizeMessages = (value: unknown): {
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  hasAttachments: boolean;
} => {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ConsultantHttpError(400, 'INVALID_REQUEST', 'Envie pelo menos uma mensagem para a Kyrubia.');
  }
  let hasAttachments = false;
  const messages = value.slice(-MAX_MESSAGES).flatMap(item => {
    const raw = record(item);
    const role = raw.role === 'assistant' ? 'assistant' as const : 'user' as const;
    const content = clean(raw.content, MAX_MESSAGE_CHARACTERS);
    if (role === 'user' && Array.isArray(raw.attachments) && raw.attachments.length > 0) {
      hasAttachments = true;
    }
    return content ? [{ role, content }] : [];
  });
  if (!messages.length || messages.at(-1)?.role !== 'user') {
    throw new ConsultantHttpError(400, 'INVALID_REQUEST', 'A solicitação precisa terminar com uma mensagem do usuário.');
  }
  const total = messages.reduce((sum, message) => sum + message.content.length, 0);
  if (total > MAX_TOTAL_CHARACTERS) {
    throw new ConsultantHttpError(400, 'INVALID_REQUEST', 'A conversa ficou muito longa para esta solicitação. Inicie um novo assunto.');
  }
  return { messages, hasAttachments };
};

const normalizeMercadoLivreCategoryIntent = (
  value: unknown
): KyrubiaMercadoLivreCategoryOfferedIntent | null => {
  const raw = record(value);
  const payload = record(raw.payload);
  const id = clean(raw.id, 160);
  const label = clean(raw.label, 180);
  const proposalId = clean(payload.proposalId, 180);
  const categoryId = clean(payload.categoryId, 160);
  const categoryName = clean(payload.categoryName, 180);
  if (
    !id || !label || raw.intent !== 'mercado_livre.category_select' ||
    raw.authorization !== 'intent_only' || !proposalId || !categoryId || !categoryName ||
    payload.providerAuthority !== 'provider_api_refetch'
  ) return null;
  return {
    id,
    intent: 'mercado_livre.category_select',
    label,
    payload: {
      proposalId,
      categoryId,
      categoryName,
      providerAuthority: 'provider_api_refetch',
    },
    authorization: 'intent_only',
    ...(raw.primary === true ? { primary: true } : {}),
  };
};

const normalizeMercadoLivreTurnContext = (
  value: unknown,
  ownerUid: string
): KyrubiaTurnContext | undefined => {
  const raw = record(value);
  const scope = record(raw.scope);
  const id = clean(raw.id, 180);
  const generatedAt = clean(raw.generatedAt, 80);
  if (
    raw.version !== 1 || raw.source !== 'kyrub_runtime' ||
    raw.sourceAction !== 'mercado_livre_publication_preparation' ||
    !id || !generatedAt || scope.kind !== 'own_store' ||
    clean(scope.storeId, 160) !== ownerUid || !Array.isArray(raw.offeredIntents)
  ) return undefined;
  const offeredIntents = raw.offeredIntents
    .slice(0, 3)
    .flatMap(item => {
      const intent = normalizeMercadoLivreCategoryIntent(item);
      return intent ? [intent] : [];
    });
  if (offeredIntents.length === 0) return undefined;
  const entities = Array.isArray(raw.entities)
    ? raw.entities.slice(0, 3).flatMap(item => {
        const entity = record(item);
        const entityId = clean(entity.entityId, 160);
        const label = clean(entity.label, 180);
        if (entity.entityType !== 'product' || !entityId || !label) return [];
        return [{ entityType: 'product' as const, entityId, label, position: 1 }];
      })
    : [];
  return {
    version: 1,
    id,
    source: 'kyrub_runtime',
    sourceAction: 'mercado_livre_publication_preparation',
    generatedAt,
    scope: { kind: 'own_store', storeId: ownerUid },
    entities,
    offeredIntents,
  };
};

const compactNames = (
  values: Array<{ id: string; name: string }>,
  maximum = 8
): string => {
  if (values.length === 0) return 'nenhum';
  const shown = values.slice(0, maximum).map(value => `${value.name} (${value.id})`);
  const remaining = values.length - shown.length;
  return `${shown.join(', ')}${remaining > 0 ? ` e mais ${remaining}` : ''}`;
};

const compactAttributeNames = (
  values: MercadoLivreRequirementCategoryOptions['attributes']
): string => compactNames(values.map(value => ({ id: value.id, name: value.name })), 10);

const mercadoLivreCategoryOptionsReply = (
  intent: KyrubiaMercadoLivreCategoryOfferedIntent,
  options: MercadoLivreRequirementCategoryOptions
): string => {
  const alwaysRequired = options.attributes.filter(attribute => attribute.required);
  const newRequired = options.attributes.filter(attribute => attribute.newRequired);
  const conditionalRequired = options.attributes.filter(attribute => attribute.conditionalRequired);
  const conditions = options.conditions.length ? options.conditions.join(', ') : 'nenhuma informada';
  const currencies = options.currencies.length ? options.currencies.join(', ') : 'não informada';
  return [
    `Confirmei novamente no Mercado Livre a categoria “${options.category.name}” para este rascunho.`,
    `Condições aceitas: ${conditions}.`,
    `Tipos de anúncio disponíveis: ${compactNames(options.listingTypes)}.`,
    `Moeda(s) aceita(s): ${currencies}.`,
    `Atributos obrigatórios em qualquer condição: ${compactAttributeNames(alwaysRequired)}.`,
    `Atributos que passam a ser obrigatórios quando a condição é novo: ${compactAttributeNames(newRequired)}.`,
    `Atributos com exigência condicional: ${compactAttributeNames(conditionalRequired)}.`,
    `A escolha “${intent.payload.categoryName}” continua sendo somente intenção conversacional. O Kyrub ainda não escolheu condição, tipo de anúncio ou valores de atributos por você.`,
    'Nenhum requisito foi gravado no rascunho, nenhuma autorização de publicação foi criada e nada foi publicado no Mercado Livre.',
  ].join(' ');
};

const mercadoLivreCategoryOptionsUnavailableReply = (
  intent: KyrubiaMercadoLivreCategoryOfferedIntent,
  error: unknown
): string => {
  const code = error instanceof Error ? error.message.split(':')[0] : 'MERCADO_LIVRE_REQUIREMENT_OPTIONS_UNAVAILABLE';
  const stale = /STALE|MISMATCH|NOT_PREDICTED|SITE_CHANGED|NOT_LISTABLE/.test(code);
  return stale
    ? `Não consegui confirmar “${intent.payload.categoryName}” como uma opção ainda válida para este rascunho. A evidência ou o estado atual do Mercado Livre mudou, então o Kyrub bloqueou a continuidade. Nenhum requisito foi configurado e nada foi publicado.`
    : `A categoria “${intent.payload.categoryName}” foi escolhida, mas não consegui revalidar agora as opções oficiais do Mercado Livre. O Kyrub não avançou com base em memória ou suposição. Nenhum requisito foi configurado e nada foi publicado.`;
};

export const executeAuthorizedKyrubiaUserProviderChat = async (
  authorization: string,
  input: unknown
): Promise<KyrubiaUserProviderChatResult> => {
  const user = await authenticateConsultantRequest(authorization);
  const requestId = randomUUID();
  const raw = record(input);
  const topic = clean(raw.topic, MAX_TOPIC_CHARACTERS) || 'Nova solicitação';
  const screenContext = clean(raw.screenContext, MAX_SCREEN_CONTEXT_CHARACTERS);
  const conversationId = clean(raw.conversationId, 180) || `conversation-${requestId}`;
  const { messages, hasAttachments } = normalizeMessages(raw.messages);
  const erpContext = normalizeErpContext(raw.erpContext);
  const previousTurnContext = normalizeMercadoLivreTurnContext(raw.turnContext, user.uid);
  const latestMessage = messages.at(-1)?.content ?? '';
  const offeredIntentSelection = resolveKyrubiaOfferedIntentSelection({
    selectedOfferedIntentId: clean(raw.selectedOfferedIntentId, 160),
    message: latestMessage,
    context: previousTurnContext,
  });

  if (
    previousTurnContext &&
    offeredIntentSelection?.offeredIntent.intent === 'mercado_livre.category_select'
  ) {
    const selectedIntent = offeredIntentSelection.offeredIntent;
    const selectedTurnContext = selectKyrubiaOfferedIntentContext(
      previousTurnContext,
      offeredIntentSelection
    );
    let reply: string;
    try {
      const options = await inspectMercadoLivreRequirementCategoryOptions({
        storeId: user.uid,
        proposalId: selectedIntent.payload.proposalId,
        categoryId: selectedIntent.payload.categoryId,
        categoryName: selectedIntent.payload.categoryName,
        requestedByUserId: user.uid,
      });
      reply = mercadoLivreCategoryOptionsReply(selectedIntent, options);
    } catch (error) {
      reply = mercadoLivreCategoryOptionsUnavailableReply(selectedIntent, error);
    }
    return {
      httpStatus: 200,
      body: {
        status: 'deterministic',
        reply,
        provider: 'kyrub',
        model: 'kyrub-runtime-v1',
        mode: 'deterministic',
        requestId,
        turnContext: selectedTurnContext,
        capabilities: byoCapabilities,
        funding: 'none',
        usage: {},
      },
    };
  }

  const result = await runKyrubiaUserProviderToolLoop({
    uid: user.uid,
    conversationId,
    systemText: buildKyrubiaSystemInstruction(user, topic, screenContext),
    messages,
    erpContext,
    hasAttachments,
  });

  if (result.status === 'legacy_allowed') {
    return {
      httpStatus: 404,
      body: { status: 'legacy_allowed', reason: result.reason, requestId },
    };
  }
  if (result.status === 'selection_required') {
    return {
      httpStatus: 409,
      body: {
        status: 'selection_required',
        availableProviders: result.availableProviders,
        requestId,
        error: 'Escolha sua IA preferida em “Minha IA” antes de continuar.',
        code: 'AI_PROVIDER_SELECTION_REQUIRED',
      },
    };
  }
  if (result.status === 'provider_failed') {
    return {
      httpStatus: result.code === 'AI_PROVIDER_CREDENTIAL_REJECTED' ? 400 : 503,
      body: {
        status: 'provider_failed',
        provider: result.provider,
        requestId,
        error: result.message,
        code: result.code,
      },
    };
  }

  return {
    httpStatus: 200,
    body: {
      status: 'user_provider',
      reply: result.reply,
      provider: result.provider,
      model: result.model,
      mode: 'conversation',
      requestId,
      ...(result.actionProposal ? { actionProposal: result.actionProposal } : {}),
      ...(result.turnContext ? { turnContext: result.turnContext } : {}),
      capabilities: byoCapabilities,
      funding: 'user_provider',
      usage: result.usage,
    },
  };
};