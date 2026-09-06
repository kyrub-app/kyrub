import { createHash, randomUUID } from 'node:crypto';
import type { KyrubAiConsultantResponse } from '../../shared/aiConsultant.js';
import type { KyrubiaTurnContext } from '../../shared/kyrubiaContext.js';
import { authenticateConsultantRequest } from './consultantAuth.js';
import {
  prepareKyrubiaMercadoLivrePublication,
  type KyrubiaMercadoLivrePrepareResult,
} from './kyrubiaMercadoLivrePrepareTool.js';

const clean = (value: unknown, maximum = 240): string =>
  typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, maximum)
    : '';

const normalize = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const preparationTarget = (message: string): string => {
  const text = clean(message, 600);
  if (!text) return '';
  const match = /^(?:kyrubia\s*[,,:-]?\s*)?(?:prepare|preparar)\s+(?:(?:o|a|um|uma)\s+)?(.+?)\s+para\s+(?:(?:vender|anunciar|publicar)\s+)?(?:tamb[eé]m\s+)?(?:(?:no|na|o|a)\s+)?mercado\s+livre[.!?\s]*$/i.exec(text);
  return clean(match?.[1], 180);
};

export const isKyrubiaMercadoLivrePlatformPreparationText = (
  message: string
): boolean => Boolean(preparationTarget(message));

const productLocatorFromErpContext = (
  erpContext: unknown,
  targetName: string
): { id: string; name: string } | null => {
  const context = record(erpContext);
  if (!Array.isArray(context.products)) return null;
  const target = normalize(targetName);
  if (!target) return null;
  const matches = context.products.flatMap(candidate => {
    const product = record(candidate);
    const id = clean(product.id, 160);
    const name = clean(product.name, 180);
    if (!id || id.includes('/') || !name || normalize(name) !== target) return [];
    return [{ id, name }];
  });
  return matches.length === 1 ? matches[0] : null;
};

const categoryStepReply = (
  result: Extract<KyrubiaMercadoLivrePrepareResult, { prepared: true }>
): string => {
  const inspection = result.requirementInspection;
  if (inspection.status === 'unavailable') return inspection.message;
  if (inspection.categorySuggestions.length === 0) {
    return 'O Mercado Livre não retornou uma categoria sugerida para este produto. Precisamos revisar a classificação antes de continuar.';
  }
  const suggestions = inspection.categorySuggestions
    .slice(0, 3)
    .map((suggestion, index) => `${index + 1}) ${suggestion.categoryName}`)
    .join('; ');
  return [
    `O Mercado Livre sugeriu estas categorias: ${suggestions}.`,
    'Escolha a categoria correta antes de continuarmos.',
    'Depois dela, o Kyrub consultará as opções oficiais de condição, tipo de anúncio e atributos obrigatórios.',
  ].join(' ');
};

const preparationReply = (result: KyrubiaMercadoLivrePrepareResult): string => {
  if ('message' in result) return result.message;
  const model = result.providerPublicationModel === 'user_products'
    ? 'User Products'
    : 'itens legado';
  return [
    `Encontrei o produto real no catálogo e preparei o rascunho interno para o Mercado Livre usando o modelo ${model}.`,
    categoryStepReply(result),
    'Nenhuma publicação foi enviada ao Mercado Livre e nenhuma autorização de publicação foi criada.',
  ].join(' ');
};

const categoryTurnContext = (input: {
  uid: string;
  conversationId: string;
  productId: string;
  productLabel: string;
  result: Extract<KyrubiaMercadoLivrePrepareResult, { prepared: true }>;
}): KyrubiaTurnContext | undefined => {
  const inspection = input.result.requirementInspection;
  if (inspection.status !== 'available') return undefined;
  const suggestions = inspection.categorySuggestions.slice(0, 3);
  if (suggestions.length === 0) return undefined;
  const fingerprint = createHash('sha256')
    .update(`${input.conversationId}:${input.result.proposalId}:${suggestions.map(item => item.categoryId).join(',')}`)
    .digest('hex')
    .slice(0, 32);
  return {
    version: 1,
    id: `ml-category-turn-${fingerprint}`,
    source: 'kyrub_runtime',
    sourceAction: 'mercado_livre_publication_preparation',
    generatedAt: new Date().toISOString(),
    scope: { kind: 'own_store', storeId: input.uid },
    entities: [{
      entityType: 'product',
      entityId: input.productId,
      label: input.productLabel,
      position: 1,
    }],
    offeredIntents: suggestions.map((suggestion, index) => ({
      id: `ml-category-${createHash('sha256')
        .update(`${input.result.proposalId}:${suggestion.categoryId}`)
        .digest('hex')
        .slice(0, 28)}`,
      intent: 'mercado_livre.category_select' as const,
      label: suggestion.categoryName,
      payload: {
        proposalId: input.result.proposalId,
        categoryId: suggestion.categoryId,
        categoryName: suggestion.categoryName,
        providerAuthority: inspection.authority,
      },
      authorization: 'intent_only' as const,
      primary: index === 0,
    })),
  };
};

const platformCapabilities: KyrubAiConsultantResponse['capabilities'] = {
  actionsEnabled: true,
  enabledActions: [],
  enabledReadActions: ['list_products'],
  voiceEnabled: false,
  persistentCloudHistoryEnabled: false,
};

export const prepareKyrubiaMercadoLivrePlatformConversation = async (input: {
  authorization: string;
  conversationId: string;
  message: string;
  erpContext: unknown;
}): Promise<KyrubAiConsultantResponse | null> => {
  const targetName = preparationTarget(input.message);
  if (!targetName) return null;

  const user = await authenticateConsultantRequest(input.authorization);
  const product = productLocatorFromErpContext(input.erpContext, targetName);
  if (!product) {
    return {
      reply:
        `Não consegui resolver “${targetName}” como um único produto exato no snapshot atual do catálogo. ` +
        'Não preparei nenhum rascunho do Mercado Livre. Atualize o catálogo ou informe exatamente o nome do produto que deseja preparar.',
      provider: 'kyrub',
      model: 'kyrub-mercado-livre-platform-runtime-v1',
      mode: 'deterministic',
      requestId: randomUUID(),
      capabilities: platformCapabilities,
    };
  }

  const prepared = await prepareKyrubiaMercadoLivrePublication({
    uid: user.uid,
    productId: product.id,
  });
  const turnContext = prepared.prepared
    ? categoryTurnContext({
        uid: user.uid,
        conversationId: clean(input.conversationId, 180) || `conversation-${randomUUID()}`,
        productId: product.id,
        productLabel: product.name,
        result: prepared,
      })
    : undefined;

  return {
    reply: preparationReply(prepared),
    provider: 'kyrub',
    model: 'kyrub-mercado-livre-platform-runtime-v1',
    mode: 'deterministic',
    requestId: randomUUID(),
    ...(turnContext ? { turnContext } : {}),
    capabilities: platformCapabilities,
  };
};

const exactLateGate = (message: string): boolean =>
  /^(?:(?:validar|valide)(?:\s+o)?\s+(?:draft|rascunho)|(?:autorizar|autorize)(?:\s+a)?\s+publica(?:ção|cao)|(?:publicar|publique)\s+agora)$/i.test(message.trim());

export const shouldRouteKyrubiaMercadoLivrePlatformContinuation = (input: {
  turnContext: unknown;
  selectedOfferedIntentId?: unknown;
  message: string;
}): boolean => {
  const context = record(input.turnContext);
  const sourceAction = clean(context.sourceAction, 120);
  if (
    sourceAction !== 'mercado_livre_publication_preparation' &&
    sourceAction !== 'mercado_livre_requirement_options'
  ) return false;

  if (clean(input.selectedOfferedIntentId, 160)) return true;
  if (Array.isArray(context.offeredIntents) && context.offeredIntents.length > 0) return true;
  if (context.mercadoLivreRequirementProgress) return true;
  return exactLateGate(input.message);
};
