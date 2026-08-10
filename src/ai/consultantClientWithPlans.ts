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
  describeKyrubiaPlanContextForGenerative,
  resolveKyrubiaPlanConversation,
} from './planConversationRuntime';

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

export const requestKyrubAiConsultant = async (
  payload: KyrubAiConsultantRequest,
  signal?: AbortSignal
): Promise<KyrubAiConsultantResponse> => {
  const user = auth.currentUser;
  if (!user) {
    return requestLegacyKyrubAiConsultant(payload, signal);
  }

  const planContext = describeKyrubiaPlanContextForGenerative(payload.messages);
  if (!planContext) {
    return requestLegacyKyrubAiConsultant(payload, signal);
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
    return {
      reply: resolved.reply,
      provider: 'kyrub',
      model: 'kyrub-plan-runtime-v1',
      mode: 'deterministic',
      requestId: createRequestId(),
      capabilities: capabilities(),
    };
  }

  // Open strategic/judgment questions still go to Gemini, but with the
  // commercial V1 facts attached so the model does not invent plan data.
  return requestLegacyKyrubAiConsultant(
    {
      ...payload,
      ...(erpContext ? { erpContext } : {}),
      screenContext: appendPlanScreenContext(
        planContext,
        payload.screenContext
      ),
    },
    signal
  );
};
