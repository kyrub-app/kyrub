import type {
  KyrubAiConsultantRequest,
  KyrubAiConsultantResponse,
} from '../../shared/aiConsultant';
import { readKyrubErpContext } from '../actions/erpReadActionService';
import { auth } from '../utils/firebase';
import {
  KyrubAiClientError,
  requestKyrubAiConsultant as requestLegacyKyrubAiConsultant,
} from './consultantClient';
import {
  shouldDeferTrustedReadToOperationalWorkflow,
} from './objectiveRuntimeService';
import {
  attachKyrubiaCapacityPlanSuggestions,
  createKyrubiaPlanFollowUpTurnContext,
  resolveKyrubiaOfferedIntentContinuation,
} from './offeredIntentRuntime';
import {
  describeKyrubiaPlanContextForGenerative,
  resolveKyrubiaPlanConversation,
} from './planConversationRuntime';
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
  const trustedRead =
    latestUserMessage?.role === 'user' &&
    typeof localStorage !== 'undefined' &&
    !shouldDeferTrustedReadToOperationalWorkflow(latestUserMessage.content)
      ? resolveKyrubiaTrustedReadRuntime(
          localStorage,
          user.uid,
          latestUserMessage.content
        )
      : null;

  // Trusted product truth and recent authoritative context must win over the
  // commercial plan wrapper. Explicit mutation intent is deliberately excluded
  // above so it can continue to the operational workflow, which still performs
  // preflight/review/confirmation and never receives authority from context.
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

  const planContext = describeKyrubiaPlanContextForGenerative(payload.messages);
  if (!planContext) {
    const legacyResult = await requestLegacyKyrubAiConsultant(
      withoutOfferedIntentSelection(payload),
      signal
    );
    return attachKyrubiaCapacityPlanSuggestions(
      legacyResult,
      payload.erpContext?.store?.id ?? null
    );
  }

  let erpContext = payload.erpContext;
  if (!erpContext) {
    try {
      erpContext = await readKyrubErpContext(user);
    } catch (error) {
      if (signal?.aborted) throw error;
      console.warn(
        '[Kyrubia] ERP context unavailable during plan conversation.',
        error
      );
    }
  }

  const resolved = resolveKyrubiaPlanConversation(payload.messages, erpContext);
  if (resolved) {
    const latestUserMessageContent = payload.messages.at(-1)?.content ?? '';
    return deterministicResponse(
      resolved.reply,
      createKyrubiaPlanFollowUpTurnContext(
        resolved.focusPlan,
        latestUserMessageContent,
        erpContext?.store?.id ?? null
      )
    );
  }

  // Open strategic/judgment questions still go to Gemini, but with the
  // commercial V1 facts attached so the model does not invent plan data.
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
