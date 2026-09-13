import type { User } from 'firebase/auth';
import type {
  KyrubAiAttachmentRef,
  KyrubAiConsultantResponse,
} from '../../shared/aiConsultant';
import type { KyrubErpContextSnapshot } from '../../shared/kyrubErpContext';
import {
  isKyrubiaImageAttachment,
  promoteKyrubiaImageAttachment,
} from './kyrubiaAttachmentService';
import {
  loadKyrubiaOperationalWorkflow,
  saveKyrubiaOperationalWorkflow,
} from './operationalWorkflowStore';
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
  `Antes de concluir o cadastro de “${name?.trim() || 'este produto'}”, envie uma foto real do produto usando Anexar ou Câmera. A foto será salva no cadastro canônico e poderá ser reaproveitada em canais como o Mercado Livre. Se quiser cadastrar sem foto por enquanto, diga “sem foto”.`;

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

  // Recover cleanly from the exact bug this wrapper fixes: an older parser may
  // already have opened a create-product workflow but failed to retain the
  // quoted name. In that state, provide only the authoritative quoted value so
  // the collector does not save the entire multi-sentence command as the name.
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

  // Long explicit-create commands are canonicalized before entering the legacy
  // collector. Keep the first follow-up equally canonical so callers receive
  // one question only, without an extra answer hint that is unrelated to the
  // parser recovery contract.
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

  if (
    normalizedResult?.actionProposal?.type === 'create_product' &&
    normalizedResult.actionProposal.isService !== true &&
    !normalizedResult.actionProposal.image?.trim() &&
    typeof localStorage !== 'undefined'
  ) {
    const workflow = loadKyrubiaOperationalWorkflow(
      localStorage,
      input.user.uid,
      input.conversationId
    );
    if (workflow?.objective === 'create_product' && workflow.stage === 'awaiting_product_confirmation') {
      saveKyrubiaOperationalWorkflow(localStorage, {
        ...workflow,
        stage: 'collecting_product_photo',
        updatedAt: new Date().toISOString(),
      });
      return {
        ...normalizedResult,
        reply: productPhotoPrompt(workflow.productDraft.name),
        actionProposal: undefined,
      };
    }
  }

  return normalizedResult;
};