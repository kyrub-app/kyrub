import { createHash, randomUUID } from 'node:crypto';
import type { KyrubAiConsultantResponse } from '../../shared/aiConsultant.js';
import type { KyrubiaTurnContext } from '../../shared/kyrubiaContext.js';
import {
  resolveAuthoritativeOwnStoreProductByExactName,
} from '../catalog/authoritativeProductIdentityService.js';
import { authenticateConsultantRequest } from './consultantAuth.js';
import {
  prepareKyrubiaMercadoLivrePublication,
  type KyrubiaMercadoLivrePrepareResult,
} from './kyrubiaMercadoLivrePrepareTool.js';

const clean = (value: unknown, maximum = 240): string =>
  typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, maximum)
    : '';

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

type AvailablePreparation = Extract<KyrubiaMercadoLivrePrepareResult, { prepared: true }>;
type CategorySuggestion = Extract<
  AvailablePreparation['requirementInspection'],
  { status: 'available' }
>['categorySuggestions'][number];

const categoryChoiceLabel = (suggestion: CategorySuggestion): string => {
  const hierarchy = suggestion.categoryPath
    .map(node => clean(node.name, 160))
    .filter(Boolean)
    .join(' > ');
  const fallbackContext = clean(suggestion.domainName, 160);
  const context = hierarchy || fallbackContext;
  return [
    clean(suggestion.categoryName, 160),
    suggestion.categoryId ? `ID ${suggestion.categoryId}` : '',
    context,
  ].filter(Boolean).join(' · ');
};

const categoryStepReply = (
  result: AvailablePreparation
): string => {
  const inspection = result.requirementInspection;
  if (inspection.status === 'unavailable') return inspection.message;
  if (inspection.categorySuggestions.length === 0) {
    return 'O Mercado Livre não retornou uma categoria sugerida para este produto. Precisamos revisar a classificação antes de continuar.';
  }
  const suggestions = inspection.categorySuggestions
    .slice(0, 3)
    .map((suggestion, index) => `${index + 1}) ${categoryChoiceLabel(suggestion)}`)
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
  result: AvailablePreparation;
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
      label: categoryChoiceLabel(suggestion),
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

const unresolvedProductResponse = (input: {
  targetName: string;
  reason: 'not_found' | 'ambiguous';
}): KyrubAiConsultantResponse => ({
  reply: input.reason === 'ambiguous'
    ? `Existe mais de um produto chamado “${input.targetName}” na loja autenticada. Não preparei nenhum rascunho do Mercado Livre. Identifique o item de forma mais específica.`
    : `Não encontrei “${input.targetName}” na loja autenticada. Não preparei nenhum rascunho do Mercado Livre. Confira o nome do produto e tente novamente.`,
  provider: 'kyrub',
  model: 'kyrub-mercado-livre-platform-runtime-v1',
  mode: 'deterministic',
  requestId: randomUUID(),
  capabilities: platformCapabilities,
});

export const prepareKyrubiaMercadoLivrePlatformConversation = async (input: {
  authorization: string;
  conversationId: string;
  message: string;
  erpContext: unknown;
}): Promise<KyrubAiConsultantResponse | null> => {
  const targetName = preparationTarget(input.message);
  if (!targetName) return null;

  const user = await authenticateConsultantRequest(input.authorization);
  const resolution = await resolveAuthoritativeOwnStoreProductByExactName({
    ownerUid: user.uid,
    targetName,
  });
  if (resolution.status !== 'found') {
    return unresolvedProductResponse({
      targetName,
      reason: resolution.status,
    });
  }
  const product = resolution.product;

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
