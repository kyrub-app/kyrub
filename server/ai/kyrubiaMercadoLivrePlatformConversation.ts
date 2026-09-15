import { createHash, randomUUID } from 'node:crypto';
import type { KyrubAiConsultantResponse } from '../../shared/aiConsultant.js';
import type { KyrubiaTurnContext } from '../../shared/kyrubiaContext.js';
import {
  resolveAuthoritativeOwnStoreProductByExactName,
  type AuthoritativeProductIdentity,
  type AuthoritativeProductIdentityResolution,
} from '../catalog/authoritativeProductIdentityService.js';
import { adminDb } from '../firebaseAdmin.js';
import { authenticateConsultantRequest } from './consultantAuth.js';
import {
  handleKyrubiaMercadoLivreBoundUpdateAuthorizationCommand,
  isKyrubiaMercadoLivreBoundUpdateAuthorizationCandidate,
} from './kyrubiaMercadoLivreBoundListingUpdateAuthorizationCommand.js';
import {
  prepareKyrubiaMercadoLivrePublication,
  type KyrubiaMercadoLivrePrepareResult,
} from './kyrubiaMercadoLivrePrepareTool.js';
import { extractKyrubiaMercadoLivrePreparationTarget } from './kyrubiaMercadoLivrePreparationTarget.js';

const clean = (value: unknown, maximum = 240): string =>
  typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, maximum)
    : '';

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const PREPARABLE_CANONICAL_PRODUCT_STATUSES = new Set(['published', 'paused']);

const explicitCanonicalProductId = (target: string): string => {
  const match = /^(?:produto\s+)?id\s+(product-[a-z0-9_-]{8,180})$/i.exec(clean(target, 220));
  return clean(match?.[1], 180);
};

const resolveCanonicalProductByExplicitId = async (input: {
  ownerUid: string;
  productId: string;
}): Promise<AuthoritativeProductIdentityResolution> => {
  const ownerUid = clean(input.ownerUid, 180);
  const productId = clean(input.productId, 180);
  if (!ownerUid || !productId || productId.includes('/')) return { status: 'not_found' };

  const privateStoreDoc = await adminDb.doc(`users/${ownerUid}/stores/${ownerUid}`).get();
  if (!privateStoreDoc.exists) return { status: 'not_found' };
  const canonicalStoreId = clean(
    (privateStoreDoc.data() as Record<string, unknown>).canonicalStoreId,
    180
  );
  if (!canonicalStoreId) return { status: 'not_found' };

  const productDoc = await adminDb.doc(`stores/${canonicalStoreId}/products/${productId}`).get();
  if (!productDoc.exists) return { status: 'not_found' };
  const data = productDoc.data() as Record<string, unknown>;
  const storedId = clean(data.id, 180);
  const storeId = clean(data.storeId, 180);
  const name = clean(data.name, 180);
  const publicationStatus = clean(data.publicationStatus, 80);
  if (
    storedId !== productId ||
    storeId !== canonicalStoreId ||
    !name ||
    !PREPARABLE_CANONICAL_PRODUCT_STATUSES.has(publicationStatus)
  ) return { status: 'not_found' };

  return { status: 'found', product: { id: productId, name } };
};

export const isKyrubiaMercadoLivrePlatformPreparationText = (
  message: string
): boolean => Boolean(extractKyrubiaMercadoLivrePreparationTarget(message));

type AvailablePreparation = Extract<KyrubiaMercadoLivrePrepareResult, { prepared: true }>;
type CategorySuggestion = Extract<
  AvailablePreparation['requirementInspection'],
  { status: 'available' }
>['categorySuggestions'][number];

type CanonicalDuplicateProvenance = {
  productId: string;
  mercadoLivreProposalIds: string[];
  configuredCategory?: {
    id: string;
    name: string;
  };
};

const inspectCanonicalDuplicateProvenance = async (input: {
  ownerUid: string;
  matches: AuthoritativeProductIdentity[];
}): Promise<CanonicalDuplicateProvenance[]> => {
  const ownerUid = clean(input.ownerUid, 180);
  if (!ownerUid) return [];

  return Promise.all(input.matches.slice(0, 5).map(async match => {
    try {
      const proposals = await adminDb
        .collection(`stores/${ownerUid}/catalogOutboundPublicationProposals`)
        .where('canonicalProductId', '==', match.id)
        .limit(10)
        .get();
      const proposalIds = proposals.docs
        .map(document => clean(document.id, 180))
        .filter(Boolean);

      let configuredCategory: CanonicalDuplicateProvenance['configuredCategory'];
      for (const proposalId of proposalIds) {
        const configuration = await adminDb.doc(
          `stores/${ownerUid}/catalogOutboundRequirementConfigurations/${proposalId}`
        ).get();
        if (!configuration.exists) continue;
        const category = record(
          (configuration.data() as Record<string, unknown>).category
        );
        const categoryId = clean(category.id, 180);
        const categoryName = clean(category.name, 180);
        if (categoryId || categoryName) {
          configuredCategory = {
            id: categoryId,
            name: categoryName,
          };
          break;
        }
      }

      return {
        productId: match.id,
        mercadoLivreProposalIds: proposalIds,
        ...(configuredCategory ? { configuredCategory } : {}),
      };
    } catch (error) {
      console.warn('[kyrubia][mercado_livre_duplicate_provenance_unavailable]', {
        productId: match.id,
        message: error instanceof Error ? error.message : String(error),
      });
      return {
        productId: match.id,
        mercadoLivreProposalIds: [],
      };
    }
  }));
};

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

const provenanceLabel = (
  match: AuthoritativeProductIdentity,
  provenance: CanonicalDuplicateProvenance | undefined
): string => {
  if (provenance?.configuredCategory) {
    const category = [
      provenance.configuredCategory.name,
      provenance.configuredCategory.id ? `ID ${provenance.configuredCategory.id}` : '',
    ].filter(Boolean).join(' · ');
    return `${match.name} · ID ${match.id} · Mercado Livre já configurado${category ? `: ${category}` : ''}`;
  }
  if ((provenance?.mercadoLivreProposalIds.length ?? 0) > 0) {
    return `${match.name} · ID ${match.id} · já possui rascunho interno do Mercado Livre`;
  }
  return `${match.name} · ID ${match.id} · sem rascunho do Mercado Livre encontrado`;
};

const canonicalDuplicateOptions = (
  matches: AuthoritativeProductIdentity[],
  provenance: CanonicalDuplicateProvenance[] = []
): string => matches
  .slice(0, 5)
  .map((match, index) => {
    const context = provenance.find(item => item.productId === match.id);
    return `${index + 1}) ${provenanceLabel(match, context)}`;
  })
  .join('; ');

const unresolvedProductResponse = (input: {
  targetName: string;
  reason: 'not_found' | 'ambiguous';
  matches?: AuthoritativeProductIdentity[];
  provenance?: CanonicalDuplicateProvenance[];
}): KyrubAiConsultantResponse => {
  const options = canonicalDuplicateOptions(
    input.matches ?? [],
    input.provenance ?? []
  );
  const firstId = clean(input.matches?.[0]?.id, 180);
  const ambiguityReply = options
    ? [
        `Existe mais de um produto canônico chamado “${input.targetName}” na loja autenticada.`,
        `Encontrei: ${options}.`,
        'Não escolhi nenhum automaticamente e não preparei rascunho do Mercado Livre.',
        firstId
          ? `Escolha o item desejado pelo ID e envie, por exemplo: “Prepare o produto ID ${firstId} para vender no Mercado Livre”.`
          : 'Escolha o item pelo ID canônico para continuar.',
      ].join(' ')
    : `Existe mais de um produto chamado “${input.targetName}” na loja autenticada. Não preparei nenhum rascunho do Mercado Livre. Identifique o item de forma mais específica.`;

  return {
    reply: input.reason === 'ambiguous'
      ? ambiguityReply
      : `Não encontrei “${input.targetName}” na loja autenticada. Não preparei nenhum rascunho do Mercado Livre. Confira o nome ou ID do produto e tente novamente.`,
    provider: 'kyrub',
    model: 'kyrub-mercado-livre-platform-runtime-v1',
    mode: 'deterministic',
    requestId: randomUUID(),
    capabilities: platformCapabilities,
  };
};

export const prepareKyrubiaMercadoLivrePlatformConversation = async (input: {
  authorization: string;
  conversationId: string;
  message: string;
  erpContext: unknown;
}): Promise<KyrubAiConsultantResponse | null> => {
  const boundUpdateAuthorization = await handleKyrubiaMercadoLivreBoundUpdateAuthorizationCommand({
    authorization: input.authorization,
    message: input.message,
  });
  if (boundUpdateAuthorization) return boundUpdateAuthorization;

  const targetName = extractKyrubiaMercadoLivrePreparationTarget(input.message);
  if (!targetName) return null;

  const user = await authenticateConsultantRequest(input.authorization);
  const explicitProductId = explicitCanonicalProductId(targetName);
  const resolution = explicitProductId
    ? await resolveCanonicalProductByExplicitId({
        ownerUid: user.uid,
        productId: explicitProductId,
      })
    : await resolveAuthoritativeOwnStoreProductByExactName({
        ownerUid: user.uid,
        targetName,
      });
  if (resolution.status !== 'found') {
    const provenance = resolution.status === 'ambiguous'
      ? await inspectCanonicalDuplicateProvenance({
          ownerUid: user.uid,
          matches: resolution.matches,
        })
      : undefined;
    if (resolution.status === 'ambiguous') {
      console.warn('[kyrubia][mercado_livre_canonical_product_provenance]', {
        matches: provenance,
      });
    }
    return unresolvedProductResponse({
      targetName,
      reason: resolution.status,
      ...(resolution.status === 'ambiguous' ? { matches: resolution.matches } : {}),
      ...(provenance ? { provenance } : {}),
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
  if (isKyrubiaMercadoLivreBoundUpdateAuthorizationCandidate(input.message)) return false;

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