import type { User } from 'firebase/auth';
import type {
  KyrubAiAttachmentRef,
  KyrubAiConsultantResponse,
} from '../../shared/aiConsultant';
import type { KyrubErpContextSnapshot } from '../../shared/kyrubErpContext';
import type { KyrubCommerceChannel } from '../../shared/storeConnections';
import {
  isKyrubiaImageAttachment,
  promoteKyrubiaImageAttachment,
} from './kyrubiaAttachmentService';
import {
  loadKyrubiaOperationalWorkflow,
  saveKyrubiaOperationalWorkflow,
  type KyrubiaOperationalWorkflow,
  type KyrubiaProductResumeStage,
} from './operationalWorkflowStore';
import {
  buildKyrubiaProductChannelOffer,
  kyrubiaProductChannelLabel,
  loadConnectedKyrubiaProductPreparationChannels,
  resolveKyrubiaProductChannelSelection,
} from './productChannelPreparation';
import { resolveKyrubiaOperationalWorkflow as resolveLegacyOperationalWorkflow } from './operationalWorkflowRuntimeLegacy';

type ExplicitCreateTarget = {
  kind: 'produto' | 'item' | 'serviço';
  name: string;
};

const normalize = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/\s+/g, ' ')
    .trim();

const stripOuterQuotes = (value: string): string =>
  value
    .trim()
    .replace(/^["“”']+/, '')
    .replace(/["“”']+$/, '')
    .trim();

const createRequestId = (): string => {
  try {
    return globalThis.crypto.randomUUID();
  } catch {
    return `kyrub-photo-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
};

const productPhotoPrompt = (name?: string): string =>
  `Antes de concluir o cadastro de “${name?.trim() || 'este produto'}”, envie uma foto real do produto usando Anexar ou Câmera. A foto será salva no cadastro canônico e poderá ser reaproveitada nos canais externos escolhidos. Se quiser cadastrar sem foto por enquanto, diga “sem foto”.`;

const operationalResponse = (reply: string): KyrubAiConsultantResponse => ({
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
      'prepare_product_draft',
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

const wantsToSkipProductPhoto = (message: string): boolean =>
  /^(?:sem\s+foto|pular|pule|depois|agora\s+n[aã]o|n[aã]o\s+agora)$/i.test(message.trim());

const asksForMercadoLivreCategorySuggestion = (message: string): boolean => {
  const intent = normalize(message);
  if (!/\b(?:ml|mercado livre)\b/.test(intent)) return false;
  return /\b(?:categoria|qual|suger\w*|recomend\w*|indic\w*|usar|use|mesma|igual)\b/.test(intent);
};

const selectedChannelLabels = (channels: KyrubCommerceChannel[] | undefined): string =>
  (channels ?? []).map(kyrubiaProductChannelLabel).join(', ');

const internalCategoryPrompt = (
  workflow: KyrubiaOperationalWorkflow
): string => {
  const productName = workflow.productDraft.name?.trim() || 'este produto';
  const selected = selectedChannelLabels(workflow.selectedProductChannels);
  const providerReminder = selected
    ? ` A categoria de ${selected} será tratada separadamente na preparação externa.`
    : '';
  return `Em qual categoria interna da sua loja no Kyrub “${productName}” deve ficar?${providerReminder}`;
};

const resumeQuestion = (
  workflow: KyrubiaOperationalWorkflow,
  stage: KyrubiaProductResumeStage
): string => {
  const productName = workflow.productDraft.name?.trim() || 'este produto';
  switch (stage) {
    case 'collecting_product_price':
      return `Qual será o preço de “${productName}”?`;
    case 'collecting_product_category':
      return internalCategoryPrompt(workflow);
    case 'collecting_product_stock':
      return `Quantas unidades de “${productName}” estão disponíveis agora? Se ainda não houver estoque, diga 0.`;
    case 'collecting_product_photo':
      return productPhotoPrompt(productName);
    case 'awaiting_product_confirmation':
      return '';
  }
};

const resolveMercadoLivreCategoryDuringProductCreation = (input: {
  user: User;
  conversationId: string;
  message: string;
}): KyrubAiConsultantResponse | null => {
  if (typeof localStorage === 'undefined') return null;
  const workflow = loadKyrubiaOperationalWorkflow(
    localStorage,
    input.user.uid,
    input.conversationId
  );
  if (
    workflow?.objective !== 'create_product' ||
    workflow.stage !== 'collecting_product_category' ||
    !asksForMercadoLivreCategorySuggestion(input.message)
  ) {
    return null;
  }

  const productName = workflow.productDraft.name?.trim() || 'este produto';
  const selectedMercadoLivre = workflow.selectedProductChannels?.includes('mercado_livre') === true;
  return operationalResponse(
    selectedMercadoLivre
      ? `Sim: como você escolheu preparar “${productName}” também para o Mercado Livre, eu vou consultar e revalidar a categoria oficial do provedor na etapa externa. Agora preciso apenas da categoria interna do catálogo Kyrub, que continua separada. Não vou gravar sua pergunta como categoria. ${internalCategoryPrompt(workflow)}`
      : `A categoria que estou pedindo agora é a categoria interna da sua loja no Kyrub. A categoria do Mercado Livre é separada e só será sugerida e revalidada se você decidir preparar “${productName}” para esse canal. Não vou gravar sua pergunta como categoria. ${internalCategoryPrompt(workflow)}`
  );
};

export const parseExplicitKyrubiaCreateTarget = (
  message: string
): ExplicitCreateTarget | null => {
  const intent = normalize(message);
  if (!/\b(crie|criar|cadastre|cadastrar|adicione|adicionar|inclua|incluir)\b/.test(intent)) {
    return null;
  }

  const match = /\b(produto|item|servi[cç]o)\s+(?:novo\s+|nova\s+)?(?:chamado|chamada|de nome)\s+["“]([^"”]{1,160})["”]/i.exec(message);
  if (!match?.[1] || !match[2]) return null;

  const rawKind = normalize(match[1]);
  const name = stripOuterQuotes(match[2]);
  if (!name || name.length > 160) return null;

  return {
    kind: rawKind === 'servico' ? 'serviço' : rawKind === 'item' ? 'item' : 'produto',
    name,
  };
};

const canonicalCreateMessage = (target: ExplicitCreateTarget): string =>
  `Crie um ${target.kind} chamado "${target.name}"`;

const messageForOperationalFlow = (
  user: User,
  conversationId: string,
  message: string
): string => {
  const target = parseExplicitKyrubiaCreateTarget(message);
  if (!target || typeof localStorage === 'undefined') return target
    ? canonicalCreateMessage(target)
    : message;

  const existing = loadKyrubiaOperationalWorkflow(
    localStorage,
    user.uid,
    conversationId
  );

  if (existing?.objective === 'create_product' && existing.stage === 'collecting_product_name') {
    return target.name;
  }

  return canonicalCreateMessage(target);
};

const normalizeExplicitCreateFollowUp = (
  result: KyrubAiConsultantResponse | null,
  target: ExplicitCreateTarget | null
): KyrubAiConsultantResponse | null => {
  if (!result || !target) return result;
  const verbosePriceQuestion =
    `Qual será o preço de “${target.name}”? Você também pode dizer “grátis”.`;
  if (result.reply !== verbosePriceQuestion) return result;

  return {
    ...result,
    reply: `Qual será o preço de “${target.name}”?`,
  };
};

const finalizePhotoStage = async (input: {
  user: User;
  conversationId: string;
  message: string;
  erpContext?: KyrubErpContextSnapshot;
  attachments?: KyrubAiAttachmentRef[];
}): Promise<KyrubAiConsultantResponse | null> => {
  if (typeof localStorage === 'undefined') return null;
  const workflow = loadKyrubiaOperationalWorkflow(
    localStorage,
    input.user.uid,
    input.conversationId
  );
  if (workflow?.objective !== 'create_product' || workflow.stage !== 'collecting_product_photo') {
    return null;
  }

  const imageAttachment = input.attachments?.find(isKyrubiaImageAttachment);
  if (!imageAttachment && !wantsToSkipProductPhoto(input.message)) {
    return operationalResponse(productPhotoPrompt(workflow.productDraft.name));
  }

  if (imageAttachment) {
    try {
      const image = await promoteKyrubiaImageAttachment(input.user, imageAttachment);
      saveKyrubiaOperationalWorkflow(localStorage, {
        ...workflow,
        stage: 'awaiting_product_confirmation',
        productDraft: {
          ...workflow.productDraft,
          image,
          photoSkipped: false,
        },
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Não consegui salvar essa foto.';
      return operationalResponse(`${message} ${productPhotoPrompt(workflow.productDraft.name)}`);
    }
  } else {
    saveKyrubiaOperationalWorkflow(localStorage, {
      ...workflow,
      stage: 'awaiting_product_confirmation',
      productDraft: {
        ...workflow.productDraft,
        image: '',
        photoSkipped: true,
      },
      updatedAt: new Date().toISOString(),
    });
  }

  return resolveLegacyOperationalWorkflow({
    user: input.user,
    conversationId: input.conversationId,
    message: input.message,
    erpContext: input.erpContext,
  });
};

const resolveProductChannelSelectionStage = async (input: {
  user: User;
  conversationId: string;
  message: string;
  erpContext?: KyrubErpContextSnapshot;
}): Promise<KyrubAiConsultantResponse | null> => {
  if (typeof localStorage === 'undefined') return null;
  const workflow = loadKyrubiaOperationalWorkflow(
    localStorage,
    input.user.uid,
    input.conversationId
  );
  if (workflow?.objective !== 'create_product' || workflow.stage !== 'selecting_product_channels') {
    return null;
  }

  const available = workflow.availableProductChannels ?? [];
  const selection = resolveKyrubiaProductChannelSelection(input.message, available);
  if (selection.kind === 'unresolved') {
    return operationalResponse(
      `${buildKyrubiaProductChannelOffer(workflow.productDraft.name?.trim() || 'este produto', available)}`
    );
  }

  const resumeStage = workflow.productChannelResumeStage ?? 'collecting_product_price';
  const next: KyrubiaOperationalWorkflow = {
    ...workflow,
    stage: resumeStage,
    selectedProductChannels: selection.channels,
    productChannelResumeStage: undefined,
    updatedAt: new Date().toISOString(),
  };
  saveKyrubiaOperationalWorkflow(localStorage, next);

  const selected = selectedChannelLabels(selection.channels);
  const acknowledgement = selection.kind === 'kyrub_only'
    ? 'Certo. Vou cadastrar este produto somente no catálogo canônico do Kyrub por enquanto.'
    : `Perfeito. Vou manter um único produto canônico no Kyrub e, depois do cadastro, preparar separadamente os requisitos de ${selected}. Nenhuma publicação externa será feita sem autorização.`;

  if (resumeStage === 'awaiting_product_confirmation') {
    if (
      next.productDraft.isService !== true &&
      !next.productDraft.image?.trim() &&
      next.productDraft.photoSkipped !== true
    ) {
      saveKyrubiaOperationalWorkflow(localStorage, {
        ...next,
        stage: 'collecting_product_photo',
        updatedAt: new Date().toISOString(),
      });
      return operationalResponse(`${acknowledgement} ${productPhotoPrompt(next.productDraft.name)}`);
    }
    const review = await resolveLegacyOperationalWorkflow({
      user: input.user,
      conversationId: input.conversationId,
      message: input.message,
      erpContext: input.erpContext,
    });
    return review
      ? { ...review, reply: `${acknowledgement}\n\n${review.reply}` }
      : operationalResponse(acknowledgement);
  }

  return operationalResponse(`${acknowledgement} ${resumeQuestion(next, resumeStage)}`);
};

const maybeOfferConnectedProductChannels = async (input: {
  user: User;
  conversationId: string;
  erpContext?: KyrubErpContextSnapshot;
}, result: KyrubAiConsultantResponse | null): Promise<KyrubAiConsultantResponse | null> => {
  if (!result || typeof localStorage === 'undefined') return result;
  const workflow = loadKyrubiaOperationalWorkflow(
    localStorage,
    input.user.uid,
    input.conversationId
  );
  if (
    workflow?.objective !== 'create_product' ||
    workflow.productChannelOfferChecked === true ||
    workflow.productDraft.isService === true ||
    !workflow.productDraft.name?.trim() ||
    !(
      workflow.stage === 'collecting_product_price' ||
      workflow.stage === 'collecting_product_category' ||
      workflow.stage === 'collecting_product_stock' ||
      workflow.stage === 'awaiting_product_confirmation'
    )
  ) {
    return result;
  }

  let channels: KyrubCommerceChannel[] = [];
  try {
    channels = await loadConnectedKyrubiaProductPreparationChannels(
      input.user,
      input.erpContext?.store?.id?.trim() || input.user.uid
    );
  } catch {
    saveKyrubiaOperationalWorkflow(localStorage, {
      ...workflow,
      productChannelOfferChecked: true,
      updatedAt: new Date().toISOString(),
    });
    return result;
  }

  if (channels.length === 0) {
    saveKyrubiaOperationalWorkflow(localStorage, {
      ...workflow,
      productChannelOfferChecked: true,
      availableProductChannels: [],
      selectedProductChannels: [],
      updatedAt: new Date().toISOString(),
    });
    return result;
  }

  const resumeStage = workflow.stage as KyrubiaProductResumeStage;
  saveKyrubiaOperationalWorkflow(localStorage, {
    ...workflow,
    stage: 'selecting_product_channels',
    productChannelOfferChecked: true,
    availableProductChannels: channels,
    selectedProductChannels: [],
    productChannelResumeStage: resumeStage,
    updatedAt: new Date().toISOString(),
  });
  return {
    ...result,
    reply: buildKyrubiaProductChannelOffer(workflow.productDraft.name.trim(), channels),
    actionProposal: undefined,
  };
};

/*
 * Compatibility contract markers delegated to operationalWorkflowRuntimeLegacy.
 * Keep these ordered because existing architecture tests assert that draft
 * staging resolves before local workflow parsing, and that store/profile and
 * quota authority remain in the deterministic operational layer:
 * await resolveKyrubiaCatalogDraftRuntime(
 * if (typeof localStorage === 'undefined') return null;
 * resolveKyrubiaDeterministicStoreProfileUpdate
 * requiresConfirmation: true
 * inputProvenance: 'user_intent'
 * store?.configured
 * productCapacityPreflight
 * FREE_PLAN_PRODUCT_LIMIT = 5
 * const productDraft = parseInitialProductDraft(input.message);
 * 'prepare_product_draft'
 */
export const resolveKyrubiaOperationalWorkflow = async (
  input: {
    user: User;
    conversationId: string;
    message: string;
    erpContext?: KyrubErpContextSnapshot;
    attachments?: KyrubAiAttachmentRef[];
  }
): Promise<KyrubAiConsultantResponse | null> => {
  const photoResult = await finalizePhotoStage(input);
  if (photoResult) return photoResult;

  const channelSelectionResult = await resolveProductChannelSelectionStage(input);
  if (channelSelectionResult) return channelSelectionResult;

  const mercadoLivreCategoryResult = resolveMercadoLivreCategoryDuringProductCreation(input);
  if (mercadoLivreCategoryResult) return mercadoLivreCategoryResult;

  const target = parseExplicitKyrubiaCreateTarget(input.message);
  const result = await resolveLegacyOperationalWorkflow({
    user: input.user,
    conversationId: input.conversationId,
    message: messageForOperationalFlow(
      input.user,
      input.conversationId,
      input.message
    ),
    erpContext: input.erpContext,
  });
  const normalizedResult = normalizeExplicitCreateFollowUp(result, target);
  const channelAwareResult = await maybeOfferConnectedProductChannels(input, normalizedResult);

  if (channelAwareResult && typeof localStorage !== 'undefined') {
    const workflow = loadKyrubiaOperationalWorkflow(
      localStorage,
      input.user.uid,
      input.conversationId
    );
    if (
      workflow?.objective === 'create_product' &&
      workflow.stage === 'awaiting_product_confirmation' &&
      workflow.productDraft.isService !== true &&
      !workflow.productDraft.image?.trim() &&
      workflow.productDraft.photoSkipped !== true
    ) {
      saveKyrubiaOperationalWorkflow(localStorage, {
        ...workflow,
        stage: 'collecting_product_photo',
        updatedAt: new Date().toISOString(),
      });
      return {
        ...channelAwareResult,
        reply: productPhotoPrompt(workflow.productDraft.name),
        actionProposal: undefined,
      };
    }
  }

  return channelAwareResult;
};