import type {
  KyrubAiConsultantRequest,
  KyrubAiConsultantResponse,
} from '../../shared/aiConsultant';
import type { KyrubErpContextSnapshot } from '../../shared/kyrubErpContext';
import { isKyrubProductPublicationIntent } from '../../shared/kyrubProductPublicationIntent';
import { resolveKyrubiaDeterministicTask } from '../../shared/kyrubiaDeterministicTask';
import { readKyrubErpContext } from '../actions/erpReadActionService';
import { rehydrateKyrubiaAuthoritativeReceipt } from '../observability/kyrubAuthoritativeReceiptRehydration';
import { hydrateActivePlanCatalog } from '../utils/activePlanCatalog';
import { auth } from '../utils/firebase';
import {
  resolveKyrubiaActivePlanKnowledge,
} from './activePlanKnowledgeRuntime';
import {
  bypassLegacyFreeCapacityContext,
  resolveActivePlanProductCapacity,
} from './activePlanProductCapacity';
import { emitKyrubAiActionProposal } from './actionEvents';
import {
  KyrubAiClientError,
  requestKyrubAiConsultant as requestLegacyKyrubAiConsultant,
} from './consultantClient';
import {
  isKyrubiaDeterministicProductUpdateIntent,
  resolveKyrubiaDeterministicProductUpdate,
} from './deterministicProductUpdate';
import {
  shouldDeferTrustedReadToOperationalWorkflow,
} from './objectiveRuntimeService';
import {
  attachKyrubiaCapacityPlanSuggestions,
  createKyrubiaPlanFollowUpTurnContext,
  resolveKyrubiaOfferedIntentContinuation,
} from './offeredIntentRuntime';
import {
  loadKyrubiaOperationalWorkflow,
} from './operationalWorkflowStore';
import {
  describeKyrubiaPlanContextForGenerative,
  resolveKyrubiaPlanConversation,
} from './planConversationRuntime';
import { resolveKyrubProductPublication } from './productPublicationRuntime';
import { resolveKyrubiaTrustedReadRuntime } from './trustedReadRuntime';

export { KyrubAiClientError };

const createRequestId = (): string => {
  try {
    return globalThis.crypto.randomUUID();
  } catch {
    return `kyrub-plan-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
};

const capabilities = (): KyrubAiConsultantResponse['capabilities'] => ({
  actionsEnabled: true,
  enabledActions: [
    'create_note',
    'create_task',
    'start_store_activation',
    'update_store_profile',
    'create_product',
    'update_product',
    'set_product_publication',
  ],
  enabledReadActions: [
    'read_store_summary',
    'list_products',
    'list_low_stock_products',
    'list_pending_orders',
  ],
  voiceEnabled: false,
  persistentCloudHistoryEnabled: false,
});

const appendPlanScreenContext = (
  planContext: string,
  existing?: string
): string =>
  [planContext, existing?.trim()]
    .filter(Boolean)
    .join(' | ')
    .slice(0, 240);

const withoutOfferedIntentSelection = (
  payload: KyrubAiConsultantRequest
): KyrubAiConsultantRequest => {
  const {
    selectedOfferedIntentId: _selectedOfferedIntentId,
    ...cleanPayload
  } = payload;
  return cleanPayload;
};

const deterministicResponse = (
  reply: string,
  turnContext: NonNullable<KyrubAiConsultantResponse['turnContext']>
): KyrubAiConsultantResponse => ({
  reply,
  provider: 'kyrub',
  model: 'kyrub-plan-runtime-v1',
  mode: 'deterministic',
  requestId: createRequestId(),
  turnContext,
  capabilities: capabilities(),
});

const trustedReadResponse = (
  reply: string
): KyrubAiConsultantResponse => ({
  reply,
  provider: 'kyrub',
  model: 'kyrub-trusted-read-v1',
  mode: 'deterministic',
  requestId: createRequestId(),
  capabilities: capabilities(),
});

const readErpContextSafely = async (
  user: NonNullable<typeof auth.currentUser>,
  signal?: AbortSignal
): Promise<KyrubErpContextSnapshot | undefined> => {
  try {
    return await readKyrubErpContext(user);
  } catch (error) {
    if (signal?.aborted) throw error;
    console.warn('[Kyrubia] ERP context unavailable during plan runtime.', error);
    return undefined;
  }
};

const isRecentActionResultQuestion = (message: string): boolean => {
  const intent = message
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/\s+/g, ' ')
    .trim();
  return /\b(deu certo|funcionou|foi salvo|salvou mesmo|conseguiu salvar|a gravacao deu certo|a alteracao deu certo)\b/.test(intent);
};

export const requestKyrubAiConsultant = async (
  payload: KyrubAiConsultantRequest,
  signal?: AbortSignal
): Promise<KyrubAiConsultantResponse> => {
  const user = auth.currentUser;
  if (!user) {
    return requestLegacyKyrubAiConsultant(
      withoutOfferedIntentSelection(payload),
      signal
    );
  }

  const latestUserMessage = payload.messages.at(-1);
  const latestContent = latestUserMessage?.role === 'user'
    ? latestUserMessage.content
    : '';

  const deterministicTask = latestUserMessage?.role === 'user'
    ? resolveKyrubiaDeterministicTask(latestContent)
    : null;
  if (deterministicTask) {
    const result: KyrubAiConsultantResponse = {
      reply: deterministicTask.reply,
      provider: 'kyrub',
      model: 'kyrub-task-runtime-v1',
      mode: 'deterministic',
      requestId: createRequestId(),
      actionProposal: {
        id: createRequestId(),
        type: 'create_task',
        title: deterministicTask.taskDraft.title,
        content: deterministicTask.taskDraft.content,
        reminderDateTime: deterministicTask.taskDraft.reminderDateTime,
        requiresConfirmation: true,
        origin: 'kyrubia',
        risk: 'low',
        inputProvenance: 'user_intent',
        impact: { entityCount: 1, reversibility: 'easy' },
      },
      capabilities: capabilities(),
    };
    emitKyrubAiActionProposal(payload.conversationId, result);
    return result;
  }

  await hydrateActivePlanCatalog(signal);

  let erpContext = payload.erpContext;

  if (
    latestUserMessage?.role === 'user' &&
    typeof localStorage !== 'undefined' &&
    isRecentActionResultQuestion(latestContent)
  ) {
    await rehydrateKyrubiaAuthoritativeReceipt(localStorage, user);
  }

  if (
    latestUserMessage?.role === 'user' &&
    isKyrubiaDeterministicProductUpdateIntent(latestContent)
  ) {
    erpContext ??= await readErpContextSafely(user, signal);
    const productUpdate = resolveKyrubiaDeterministicProductUpdate(
      latestContent,
      erpContext
    );
    if (productUpdate) {
      const result: KyrubAiConsultantResponse = {
        reply: productUpdate.reply,
        provider: 'kyrub',
        model: 'kyrub-product-update-runtime-v1',
        mode: 'deterministic',
        requestId: createRequestId(),
        actionProposal: productUpdate.actionProposal,
        capabilities: capabilities(),
      };
      emitKyrubAiActionProposal(payload.conversationId, result);
      return result;
    }
  }

  // Publication is a distinct catalog lifecycle mutation. It must resolve
  // against canonical drafts for publish and the authoritative public ERP
  // snapshot for unpublish, before plan/knowledge routing can reinterpret
  // commercial words inside a product name.
  if (
    latestUserMessage?.role === 'user' &&
    isKyrubProductPublicationIntent(latestContent)
  ) {
    const publication = await resolveKyrubProductPublication(user, latestContent);
    if (publication) {
      const result: KyrubAiConsultantResponse = {
        reply: publication.reply,
        provider: 'kyrub',
        model: 'kyrub-product-publication-runtime-v1',
        mode: 'deterministic',
        requestId: createRequestId(),
        actionProposal: publication.actionProposal,
        capabilities: capabilities(),
      };
      emitKyrubAiActionProposal(payload.conversationId, result);
      return result;
    }
  }

  const defersToOperational = latestUserMessage?.role === 'user'
    ? shouldDeferTrustedReadToOperationalWorkflow(latestContent)
    : false;

  const activePlanKnowledge =
    latestUserMessage?.role === 'user' && !defersToOperational
      ? resolveKyrubiaActivePlanKnowledge(latestContent)
      : null;
  if (activePlanKnowledge) {
    return trustedReadResponse(activePlanKnowledge);
  }

  const trustedRead =
    latestUserMessage?.role === 'user' &&
    typeof localStorage !== 'undefined' &&
    !defersToOperational
      ? resolveKyrubiaTrustedReadRuntime(
          localStorage,
          user.uid,
          latestContent
        )
      : null;

  if (trustedRead) {
    return trustedReadResponse(trustedRead.reply);
  }

  const offeredContinuation = resolveKyrubiaOfferedIntentContinuation(
    payload.messages,
    payload.turnContext,
    payload.selectedOfferedIntentId,
    payload.erpContext
  );
  if (offeredContinuation) {
    return deterministicResponse(
      offeredContinuation.reply,
      offeredContinuation.turnContext
    );
  }

  const storedWorkflow =
    typeof localStorage !== 'undefined'
      ? loadKyrubiaOperationalWorkflow(
          localStorage,
          user.uid,
          payload.conversationId
        )
      : null;
  const productOperationalTurn =
    latestUserMessage?.role === 'user' &&
    (defersToOperational || storedWorkflow?.objective === 'create_product');

  let legacyErpContext = erpContext;
  if (productOperationalTurn) {
    erpContext ??= await readErpContextSafely(user, signal);
    const capacity = resolveActivePlanProductCapacity(
      latestContent,
      erpContext,
      storedWorkflow
    );
    if (capacity.reply) {
      return attachKyrubiaCapacityPlanSuggestions(
        trustedReadResponse(capacity.reply),
        erpContext?.store?.id ?? null
      );
    }
    legacyErpContext = bypassLegacyFreeCapacityContext(
      erpContext,
      capacity.bypassLegacyFreeCapacity
    );
  }

  const planContext = describeKyrubiaPlanContextForGenerative(payload.messages);
  if (!planContext) {
    const legacyResult = await requestLegacyKyrubAiConsultant(
      {
        ...withoutOfferedIntentSelection(payload),
        ...(legacyErpContext ? { erpContext: legacyErpContext } : {}),
      },
      signal
    );
    return attachKyrubiaCapacityPlanSuggestions(
      legacyResult,
      erpContext?.store?.id ?? payload.erpContext?.store?.id ?? null
    );
  }

  if (!erpContext) {
    erpContext = await readErpContextSafely(user, signal);
  }

  const resolved = resolveKyrubiaPlanConversation(payload.messages, erpContext);
  if (resolved) {
    return deterministicResponse(
      resolved.reply,
      createKyrubiaPlanFollowUpTurnContext(
        resolved.focusPlan,
        latestContent,
        erpContext?.store?.id ?? null
      )
    );
  }

  return requestLegacyKyrubAiConsultant(
    {
      ...withoutOfferedIntentSelection(payload),
      ...(erpContext ? { erpContext } : {}),
      screenContext: appendPlanScreenContext(
        planContext,
        payload.screenContext
      ),
    },
    signal
  );
};
