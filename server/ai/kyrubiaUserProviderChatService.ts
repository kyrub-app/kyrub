import { createHash, randomUUID } from 'node:crypto';
import type {
  KyrubiaMercadoLivreAttributeValueOfferedIntent,
  KyrubiaMercadoLivreCategoryOfferedIntent,
  KyrubiaMercadoLivreCollectedAttribute,
  KyrubiaMercadoLivreConditionOfferedIntent,
  KyrubiaMercadoLivreListingTypeOfferedIntent,
  KyrubiaMercadoLivreRequirementProgress,
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
import { configureKyrubiaMercadoLivreDraftRequirements } from '../integrations/mercadoLivreKyrubiaDraftConfigurationService.js';
import {
  inspectMercadoLivreRequirementCategoryOptions,
  type MercadoLivreRequirementCategoryOptions,
} from '../integrations/mercadoLivreRequirementOptionsService.js';
import { authenticateConsultantRequest } from './consultantAuth.js';
import {
  continueMercadoLivreRequiredAttributeCollection,
  startMercadoLivreRequiredAttributeCollection,
  type KyrubiaMercadoLivreAttributeCollectorStep,
} from './kyrubiaMercadoLivreRequiredAttributeCollector.js';
import { handleKyrubiaMercadoLivreListingValidationCommand } from './kyrubiaMercadoLivreListingValidationCommand.js';
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

type MercadoLivreConversationIntent =
  | KyrubiaMercadoLivreCategoryOfferedIntent
  | KyrubiaMercadoLivreConditionOfferedIntent
  | KyrubiaMercadoLivreListingTypeOfferedIntent
  | KyrubiaMercadoLivreAttributeValueOfferedIntent;

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

const normalizeMercadoLivreIntent = (
  value: unknown
): MercadoLivreConversationIntent | null => {
  const raw = record(value);
  const payload = record(raw.payload);
  const id = clean(raw.id, 160);
  const label = clean(raw.label, 180);
  const proposalId = clean(payload.proposalId, 180);
  const categoryId = clean(payload.categoryId, 160);
  const categoryName = clean(payload.categoryName, 180);
  if (!id || !label || raw.authorization !== 'intent_only' || !proposalId || !categoryId || !categoryName) {
    return null;
  }
  if (
    raw.intent === 'mercado_livre.category_select' &&
    payload.providerAuthority === 'provider_api_refetch'
  ) {
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
  }
  const condition = clean(payload.condition, 120);
  if (
    raw.intent === 'mercado_livre.condition_select' &&
    payload.providerAuthority === 'provider_api_requirement_options' &&
    condition
  ) {
    return {
      id,
      intent: 'mercado_livre.condition_select',
      label,
      payload: {
        proposalId,
        categoryId,
        categoryName,
        condition,
        providerAuthority: 'provider_api_requirement_options',
      },
      authorization: 'intent_only',
      ...(raw.primary === true ? { primary: true } : {}),
    };
  }
  const listingTypeId = clean(payload.listingTypeId, 120);
  const listingTypeName = clean(payload.listingTypeName, 180);
  if (
    raw.intent === 'mercado_livre.listing_type_select' &&
    payload.providerAuthority === 'provider_api_requirement_options' &&
    condition && listingTypeId && listingTypeName
  ) {
    return {
      id,
      intent: 'mercado_livre.listing_type_select',
      label,
      payload: {
        proposalId,
        categoryId,
        categoryName,
        condition,
        listingTypeId,
        listingTypeName,
        providerAuthority: 'provider_api_requirement_options',
      },
      authorization: 'intent_only',
      ...(raw.primary === true ? { primary: true } : {}),
    };
  }
  const attributeId = clean(payload.attributeId, 160);
  const attributeName = clean(payload.attributeName, 255);
  const valueId = clean(payload.valueId, 160);
  const valueName = clean(payload.valueName, 255);
  if (
    raw.intent === 'mercado_livre.attribute_value_select' &&
    payload.providerAuthority === 'provider_api_requirement_options' &&
    condition && listingTypeId && listingTypeName &&
    attributeId && attributeName && valueId && valueName
  ) {
    return {
      id,
      intent: 'mercado_livre.attribute_value_select',
      label,
      payload: {
        proposalId,
        categoryId,
        categoryName,
        condition,
        listingTypeId,
        listingTypeName,
        attributeId,
        attributeName,
        valueId,
        valueName,
        providerAuthority: 'provider_api_requirement_options',
      },
      authorization: 'intent_only',
      ...(raw.primary === true ? { primary: true } : {}),
    };
  }
  return null;
};

const normalizeCollectedAttribute = (
  value: unknown
): KyrubiaMercadoLivreCollectedAttribute | null => {
  const raw = record(value);
  const id = clean(raw.id, 160);
  const name = clean(raw.name, 255);
  const valueId = clean(raw.valueId, 160);
  const valueName = clean(raw.valueName, 255);
  if (!id || !name || !valueName) return null;
  return { id, name, ...(valueId ? { valueId } : {}), valueName };
};

const normalizeRequirementProgress = (
  value: unknown
): KyrubiaMercadoLivreRequirementProgress | undefined => {
  const raw = record(value);
  const proposalId = clean(raw.proposalId, 180);
  const categoryId = clean(raw.categoryId, 160);
  const categoryName = clean(raw.categoryName, 180);
  const condition = clean(raw.condition, 120);
  const listingTypeId = clean(raw.listingTypeId, 120);
  const listingTypeName = clean(raw.listingTypeName, 180);
  if (
    !proposalId || !categoryId || !categoryName || !condition ||
    !listingTypeId || !listingTypeName ||
    raw.providerAuthority !== 'provider_api_requirement_options' ||
    raw.authorization !== 'intent_only'
  ) return undefined;
  const collectedAttributes = Array.isArray(raw.collectedAttributes)
    ? raw.collectedAttributes.slice(0, 41).flatMap(item => {
        const collected = normalizeCollectedAttribute(item);
        return collected ? [collected] : [];
      })
    : [];
  const pendingRaw = record(raw.pendingAttribute);
  const pendingId = clean(pendingRaw.id, 160);
  const pendingName = clean(pendingRaw.name, 255);
  const pendingValueType = clean(pendingRaw.valueType, 80);
  const pendingAttribute = pendingId && pendingName
    ? { id: pendingId, name: pendingName, valueType: pendingValueType }
    : undefined;
  return {
    proposalId,
    categoryId,
    categoryName,
    condition,
    listingTypeId,
    listingTypeName,
    collectedAttributes,
    ...(pendingAttribute ? { pendingAttribute } : {}),
    providerAuthority: 'provider_api_requirement_options',
    authorization: 'intent_only',
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
  const sourceAction = raw.sourceAction === 'mercado_livre_requirement_options'
    ? 'mercado_livre_requirement_options' as const
    : raw.sourceAction === 'mercado_livre_publication_preparation'
      ? 'mercado_livre_publication_preparation' as const
      : null;
  if (
    raw.version !== 1 || raw.source !== 'kyrub_runtime' || !sourceAction ||
    !id || !generatedAt || scope.kind !== 'own_store' ||
    clean(scope.storeId, 160) !== ownerUid
  ) return undefined;
  const offeredIntents = Array.isArray(raw.offeredIntents)
    ? raw.offeredIntents.slice(0, 3).flatMap(item => {
        const intent = normalizeMercadoLivreIntent(item);
        return intent ? [intent] : [];
      })
    : [];
  const selectedIntent = normalizeMercadoLivreIntent(raw.selectedIntent) ?? undefined;
  const mercadoLivreRequirementProgress = normalizeRequirementProgress(raw.mercadoLivreRequirementProgress);
  if (offeredIntents.length === 0 && !selectedIntent && !mercadoLivreRequirementProgress) return undefined;
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
    sourceAction,
    generatedAt,
    scope: { kind: 'own_store', storeId: ownerUid },
    entities,
    ...(offeredIntents.length ? { offeredIntents } : {}),
    ...(selectedIntent ? { selectedIntent } : {}),
    ...(mercadoLivreRequirementProgress ? { mercadoLivreRequirementProgress } : {}),
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

const conditionLabel = (condition: string): string => {
  if (condition === 'new') return 'Novo';
  if (condition === 'used') return 'Usado';
  if (condition === 'not_specified') return 'Não especificado';
  return condition;
};

const withConditionChoices = (
  context: KyrubiaTurnContext,
  intent: KyrubiaMercadoLivreCategoryOfferedIntent,
  options: MercadoLivreRequirementCategoryOptions
): KyrubiaTurnContext => {
  const offeredIntents: KyrubiaMercadoLivreConditionOfferedIntent[] = options.conditions
    .slice(0, 3)
    .map((condition, index) => ({
      id: `ml-condition-${createHash('sha256')
        .update(`${intent.payload.proposalId}:${intent.payload.categoryId}:${condition}`)
        .digest('hex')
        .slice(0, 28)}`,
      intent: 'mercado_livre.condition_select',
      label: conditionLabel(condition),
      payload: {
        proposalId: intent.payload.proposalId,
        categoryId: intent.payload.categoryId,
        categoryName: intent.payload.categoryName,
        condition,
        providerAuthority: 'provider_api_requirement_options',
      },
      authorization: 'intent_only',
      primary: index === 0,
    }));
  return {
    ...context,
    sourceAction: 'mercado_livre_requirement_options',
    offeredIntents: offeredIntents.length ? offeredIntents : undefined,
  };
};

const withListingTypeChoices = (
  context: KyrubiaTurnContext,
  intent: KyrubiaMercadoLivreConditionOfferedIntent,
  options: MercadoLivreRequirementCategoryOptions
): KyrubiaTurnContext => {
  const offeredIntents: KyrubiaMercadoLivreListingTypeOfferedIntent[] = options.listingTypes
    .slice(0, 3)
    .map((listingType, index) => ({
      id: `ml-listing-type-${createHash('sha256')
        .update(`${intent.payload.proposalId}:${intent.payload.categoryId}:${intent.payload.condition}:${listingType.id}`)
        .digest('hex')
        .slice(0, 28)}`,
      intent: 'mercado_livre.listing_type_select',
      label: listingType.name,
      payload: {
        proposalId: intent.payload.proposalId,
        categoryId: intent.payload.categoryId,
        categoryName: intent.payload.categoryName,
        condition: intent.payload.condition,
        listingTypeId: listingType.id,
        listingTypeName: listingType.name,
        providerAuthority: 'provider_api_requirement_options',
      },
      authorization: 'intent_only',
      primary: index === 0,
    }));
  return {
    ...context,
    sourceAction: 'mercado_livre_requirement_options',
    offeredIntents: offeredIntents.length ? offeredIntents : undefined,
  };
};

const withAttributeCollectorStep = (
  context: KyrubiaTurnContext,
  step: KyrubiaMercadoLivreAttributeCollectorStep
): KyrubiaTurnContext => ({
  ...context,
  sourceAction: 'mercado_livre_requirement_options',
  offeredIntents: step.offeredIntents.length ? step.offeredIntents : undefined,
  mercadoLivreRequirementProgress: step.progress,
});

const mercadoLivreCategoryOptionsReply = (
  intent: KyrubiaMercadoLivreCategoryOfferedIntent,
  options: MercadoLivreRequirementCategoryOptions
): string => {
  const alwaysRequired = options.attributes.filter(attribute => attribute.required);
  const newRequired = options.attributes.filter(attribute => attribute.newRequired);
  const conditionalRequired = options.attributes.filter(attribute => attribute.conditionalRequired);
  const conditions = options.conditions.length ? options.conditions.map(conditionLabel).join(', ') : 'nenhuma informada';
  const currencies = options.currencies.length ? options.currencies.join(', ') : 'não informada';
  return [
    `Confirmei novamente no Mercado Livre a categoria “${options.category.name}” para este rascunho.`,
    `Condições aceitas: ${conditions}.`,
    `Tipos de anúncio disponíveis: ${compactNames(options.listingTypes)}.`,
    `Moeda(s) aceita(s): ${currencies}.`,
    `Atributos obrigatórios em qualquer condição: ${compactAttributeNames(alwaysRequired)}.`,
    `Atributos que passam a ser obrigatórios quando a condição é novo: ${compactAttributeNames(newRequired)}.`,
    `Atributos com exigência condicional: ${compactAttributeNames(conditionalRequired)}.`,
    options.conditions.length
      ? 'Escolha agora a condição correta do item antes de continuarmos.'
      : 'O Mercado Livre não informou uma condição selecionável para esta categoria; o Kyrub não vai inventar uma.',
    `A escolha “${intent.payload.categoryName}” continua sendo somente intenção conversacional. O Kyrub ainda não escolheu condição, tipo de anúncio ou valores de atributos por você.`,
    'Nenhum requisito foi gravado no rascunho, nenhuma autorização de publicação foi criada e nada foi publicado no Mercado Livre.',
  ].join(' ');
};

const mercadoLivreConditionReply = (
  intent: KyrubiaMercadoLivreConditionOfferedIntent,
  options: MercadoLivreRequirementCategoryOptions
): string => {
  const required = options.attributes.filter(attribute =>
    attribute.required || (intent.payload.condition === 'new' && attribute.newRequired)
  );
  const conditional = options.attributes.filter(attribute => attribute.conditionalRequired);
  return [
    `Confirmei no Mercado Livre que a condição “${conditionLabel(intent.payload.condition)}” continua aceita para “${options.category.name}”.`,
    `Com essa condição, estes atributos estão obrigatórios: ${compactAttributeNames(required)}.`,
    `Atributos com exigência condicional: ${compactAttributeNames(conditional)}.`,
    `Tipos de anúncio que continuam disponíveis: ${compactNames(options.listingTypes)}.`,
    options.listingTypes.length
      ? 'Escolha agora o tipo de anúncio correto antes de preenchermos os atributos exigidos.'
      : 'O Mercado Livre não informou um tipo de anúncio disponível para esta conta e categoria; o Kyrub não vai inventar um.',
    'A condição ficou registrada apenas como intenção conversacional. O Kyrub ainda não escolheu tipo de anúncio nem valores de atributos.',
    'Nenhum requisito foi gravado no rascunho, nenhuma autorização de publicação foi criada e nada foi publicado no Mercado Livre.',
  ].join(' ');
};

const mercadoLivreListingTypeConfirmation = (
  intent: KyrubiaMercadoLivreListingTypeOfferedIntent,
  options: MercadoLivreRequirementCategoryOptions
): string => [
  `Confirmei no Mercado Livre que o tipo de anúncio “${intent.payload.listingTypeName}” (${intent.payload.listingTypeId}) continua disponível para “${options.category.name}” com a condição “${conditionLabel(intent.payload.condition)}”.`,
  'Com categoria, condição e tipo de anúncio definidos, sigo apenas para a coleta conversacional de requisitos.',
  'O próximo passo seguro é coletar somente os atributos que o Mercado Livre realmente exige para este anúncio.',
  'Essas três escolhas continuam sendo apenas intenção conversacional vinculada ao mesmo rascunho. O Kyrub ainda não gravou categoria, condição, tipo de anúncio ou valores de atributos no draft.',
].join(' ');

const mercadoLivreOptionsUnavailableReply = (
  label: string,
  error: unknown
): string => {
  const code = error instanceof Error ? error.message.split(':')[0] : 'MERCADO_LIVRE_REQUIREMENT_OPTIONS_UNAVAILABLE';
  const stale = /STALE|MISMATCH|NOT_PREDICTED|SITE_CHANGED|NOT_LISTABLE/.test(code);
  return stale
    ? `Não consegui confirmar “${label}” como uma opção ainda válida para este rascunho. A evidência ou o estado atual do Mercado Livre mudou, então o Kyrub bloqueou a continuidade. Nenhum requisito foi configurado e nada foi publicado.`
    : `A opção “${label}” foi escolhida, mas não consegui revalidar agora as opções oficiais do Mercado Livre. O Kyrub não avançou com base em memória ou suposição. Nenhum requisito foi configurado e nada foi publicado.`;
};

const mercadoLivreAttributeUnavailableReply = (
  progress: KyrubiaMercadoLivreRequirementProgress,
  error: unknown
): string => {
  const code = error instanceof Error ? error.message.split(':')[0] : 'MERCADO_LIVRE_ATTRIBUTE_COLLECTION_UNAVAILABLE';
  const label = progress.pendingAttribute?.name ?? 'atributo obrigatório';
  return `Não consegui revalidar “${label}” contra os requisitos atuais do Mercado Livre (${code}). O Kyrub manteve tudo apenas como contexto de conversa e não avançou nem gravou requisitos no rascunho.`;
};

const mercadoLivreDraftConfigurationUnavailableReply = (error: unknown): string => {
  const code = error instanceof Error ? error.message.split(':')[0] : 'MERCADO_LIVRE_KYRUBIA_DRAFT_CONFIGURATION_UNAVAILABLE';
  return `O comando para configurar o draft foi explícito, mas a revalidação autoritativa bloqueou a escrita (${code}). Mantive os valores somente no contexto desta conversa; nenhuma configuração foi sobrescrita, nenhuma autorização de publicação foi criada e nada foi publicado no Mercado Livre.`;
};

const appendDraftConfigurationCommand = (
  reply: string,
  complete: boolean
): string => complete
  ? `${reply} Se quiser persistir agora essa configuração interna, diga exatamente “Configurar draft”. Esse comando autoriza somente a gravação do draft; ele não autoriza publicar no Mercado Livre.`
  : reply;

const isExplicitDraftConfigurationCommand = (message: string): boolean =>
  /^(?:configurar|configure)(?:\s+o)?\s+(?:draft|rascunho)$/i.test(message.trim());

const clearMercadoLivreRequirementProgress = (
  context: KyrubiaTurnContext
): KyrubiaTurnContext => ({
  ...context,
  id: randomUUID(),
  sourceAction: 'mercado_livre_publication_preparation',
  generatedAt: new Date().toISOString(),
  offeredIntents: undefined,
  mercadoLivreRequirementProgress: undefined,
});

const loadOptionsFor = async (
  userId: string,
  intent: MercadoLivreConversationIntent
): Promise<MercadoLivreRequirementCategoryOptions> =>
  inspectMercadoLivreRequirementCategoryOptions({
    storeId: userId,
    proposalId: intent.payload.proposalId,
    categoryId: intent.payload.categoryId,
    categoryName: intent.payload.categoryName,
    requestedByUserId: userId,
  });

const deterministicResult = (
  requestId: string,
  reply: string,
  turnContext: KyrubiaTurnContext
): KyrubiaUserProviderChatResult => ({
  httpStatus: 200,
  body: {
    status: 'deterministic',
    reply,
    provider: 'kyrub',
    model: 'kyrub-runtime-v1',
    mode: 'deterministic',
    requestId,
    turnContext,
    capabilities: byoCapabilities,
    funding: 'none',
    usage: {},
  },
});

const shouldPauseAttributeCollection = (message: string): boolean =>
  /^(cancelar|cancela|parar|pare|depois|voltar)$/i.test(message.trim());

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
  const selectedOfferedIntentId = clean(raw.selectedOfferedIntentId, 160);
  const offeredIntentSelection = resolveKyrubiaOfferedIntentSelection({
    selectedOfferedIntentId,
    message: latestMessage,
    context: previousTurnContext,
  });

  const attributeProgress = previousTurnContext?.mercadoLivreRequirementProgress;
  if (previousTurnContext && attributeProgress?.pendingAttribute) {
    if (shouldPauseAttributeCollection(latestMessage)) {
      return deterministicResult(
        requestId,
        'Tudo bem. Interrompi a coleta dos atributos por enquanto. Nada do que foi respondido foi gravado no rascunho do Mercado Livre e nenhuma autorização de publicação foi criada.',
        {
          ...previousTurnContext,
          id: randomUUID(),
          generatedAt: new Date().toISOString(),
          offeredIntents: undefined,
          mercadoLivreRequirementProgress: undefined,
        }
      );
    }
    if (selectedOfferedIntentId && !offeredIntentSelection) {
      return deterministicResult(
        requestId,
        'Essa opção não pertence ao atributo que o Kyrub está validando agora. Não avancei e nada foi gravado.',
        previousTurnContext
      );
    }
    if (
      offeredIntentSelection &&
      offeredIntentSelection.offeredIntent.intent !== 'mercado_livre.attribute_value_select'
    ) {
      return deterministicResult(
        requestId,
        'A resposta selecionada não corresponde ao atributo obrigatório atual. O Kyrub não avançou nem gravou nada.',
        previousTurnContext
      );
    }
    try {
      const step = await continueMercadoLivreRequiredAttributeCollection({
        userId: user.uid,
        progress: attributeProgress,
        ...(offeredIntentSelection?.offeredIntent.intent === 'mercado_livre.attribute_value_select'
          ? { selectedValueIntent: offeredIntentSelection.offeredIntent }
          : {}),
        message: latestMessage,
      });
      return deterministicResult(
        requestId,
        appendDraftConfigurationCommand(step.reply, step.complete),
        withAttributeCollectorStep(previousTurnContext, step)
      );
    } catch (error) {
      return deterministicResult(
        requestId,
        mercadoLivreAttributeUnavailableReply(attributeProgress, error),
        previousTurnContext
      );
    }
  }

  if (
    previousTurnContext &&
    attributeProgress &&
    !attributeProgress.pendingAttribute &&
    isExplicitDraftConfigurationCommand(latestMessage)
  ) {
    try {
      const configuration = await configureKyrubiaMercadoLivreDraftRequirements({
        storeId: user.uid,
        proposalId: attributeProgress.proposalId,
        categoryId: attributeProgress.categoryId,
        categoryName: attributeProgress.categoryName,
        condition: attributeProgress.condition,
        listingTypeId: attributeProgress.listingTypeId,
        listingTypeName: attributeProgress.listingTypeName,
        attributes: attributeProgress.collectedAttributes,
        configuredByUserId: user.uid,
      });
      const writeLabel = configuration.idempotent
        ? 'A mesma configuração já estava persistida e foi reconhecida de forma idempotente.'
        : 'A configuração interna foi persistida agora.';
      const reply = [
        writeLabel,
        `O draft ficou configurado para “${configuration.category.name}”, condição “${conditionLabel(configuration.condition)}” e tipo de anúncio “${configuration.listingType.name}”.`,
        `Foram congelados ${configuration.requiredAttributeIds.length} requisito(s) básico(s) e ${configuration.conditionalAttributeIds.length} requisito(s) condicional(is) realmente confirmados pelo provedor; a configuração ficou ready=true.`,
        'A evidência da inspeção condicional foi persistida na mesma transação para manter o próximo gate coerente.',
        'Nenhuma autorização de publicação foi criada e nenhum anúncio foi criado ou alterado no Mercado Livre.',
        'Se quiser executar agora apenas o gate oficial de validação do payload, diga exatamente “Validar draft”. Esse comando chama /items/validate, mas não autoriza nem publica o item.',
      ].join(' ');
      return deterministicResult(
        requestId,
        reply,
        clearMercadoLivreRequirementProgress(previousTurnContext)
      );
    } catch (error) {
      return deterministicResult(
        requestId,
        mercadoLivreDraftConfigurationUnavailableReply(error),
        previousTurnContext
      );
    }
  }

  const listingValidationCommand = await handleKyrubiaMercadoLivreListingValidationCommand({
    userId: user.uid,
    message: latestMessage,
    context: previousTurnContext,
  });
  if (listingValidationCommand.handled) {
    return deterministicResult(
      requestId,
      listingValidationCommand.reply,
      listingValidationCommand.turnContext
    );
  }

  if (previousTurnContext && offeredIntentSelection) {
    const selected = offeredIntentSelection.offeredIntent;
    if (selected.intent === 'mercado_livre.category_select') {
      const selectedTurnContext = selectKyrubiaOfferedIntentContext(
        previousTurnContext,
        offeredIntentSelection
      );
      let reply: string;
      let nextTurnContext = selectedTurnContext;
      try {
        const options = await loadOptionsFor(user.uid, selected);
        reply = mercadoLivreCategoryOptionsReply(selected, options);
        nextTurnContext = withConditionChoices(selectedTurnContext, selected, options);
      } catch (error) {
        reply = mercadoLivreOptionsUnavailableReply(selected.payload.categoryName, error);
      }
      return deterministicResult(requestId, reply, nextTurnContext);
    }

    if (selected.intent === 'mercado_livre.condition_select') {
      const selectedTurnContext = selectKyrubiaOfferedIntentContext(
        previousTurnContext,
        offeredIntentSelection
      );
      let reply: string;
      let nextTurnContext = selectedTurnContext;
      try {
        const options = await loadOptionsFor(user.uid, selected);
        if (!options.conditions.includes(selected.payload.condition)) {
          throw new Error('MERCADO_LIVRE_OUTBOUND_CONDITION_NOT_AVAILABLE');
        }
        reply = mercadoLivreConditionReply(selected, options);
        nextTurnContext = withListingTypeChoices(selectedTurnContext, selected, options);
      } catch (error) {
        reply = mercadoLivreOptionsUnavailableReply(selected.label, error);
      }
      return deterministicResult(requestId, reply, nextTurnContext);
    }

    if (selected.intent === 'mercado_livre.listing_type_select') {
      const selectedTurnContext = selectKyrubiaOfferedIntentContext(
        previousTurnContext,
        offeredIntentSelection
      );
      let reply: string;
      let nextTurnContext = selectedTurnContext;
      try {
        const options = await loadOptionsFor(user.uid, selected);
        if (!options.conditions.includes(selected.payload.condition)) {
          throw new Error('MERCADO_LIVRE_OUTBOUND_CONDITION_NOT_AVAILABLE');
        }
        const currentListingType = options.listingTypes.find(
          listingType => listingType.id === selected.payload.listingTypeId
        );
        if (!currentListingType) {
          throw new Error('MERCADO_LIVRE_OUTBOUND_LISTING_TYPE_NOT_AVAILABLE');
        }
        if (currentListingType.name !== selected.payload.listingTypeName) {
          throw new Error('MERCADO_LIVRE_OUTBOUND_LISTING_TYPE_MISMATCH');
        }
        const step = await startMercadoLivreRequiredAttributeCollection({
          userId: user.uid,
          listingIntent: selected,
          options,
        });
        reply = `${mercadoLivreListingTypeConfirmation(selected, options)} ${appendDraftConfigurationCommand(step.reply, step.complete)}`;
        nextTurnContext = withAttributeCollectorStep(selectedTurnContext, step);
      } catch (error) {
        reply = mercadoLivreOptionsUnavailableReply(selected.label, error);
      }
      return deterministicResult(requestId, reply, nextTurnContext);
    }
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