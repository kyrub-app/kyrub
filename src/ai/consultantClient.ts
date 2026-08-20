import type {
  KyrubAiConsultantRequest,
  KyrubAiConsultantResponse,
} from '../../shared/aiConsultant';
import { readKyrubErpContext } from '../actions/erpReadActionService';
import { auth } from '../utils/firebase';
import { resolveKyrubiaDeterministicStoreOperation } from './deterministicStoreOperation';
import { emitKyrubStoreOperationProposal } from './storeOperationEvents';
import {
  requestKyrubAiConsultant as requestKyrubAiConsultantBase,
} from './consultantClientBase';

export { KyrubAiClientError } from './consultantClientBase';

const createRuntimeRequestId = (): string => {
  try {
    return globalThis.crypto.randomUUID();
  } catch {
    return `kyrub-store-runtime-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
};

export const requestKyrubAiConsultant = async (
  payload: KyrubAiConsultantRequest,
  signal?: AbortSignal
): Promise<KyrubAiConsultantResponse> => {
  const currentUser = auth.currentUser;
  const latestUserMessage = payload.messages.at(-1);

  if (!currentUser || latestUserMessage?.role !== 'user') {
    return requestKyrubAiConsultantBase(payload, signal);
  }

  let erpContext = payload.erpContext;
  if (!erpContext) {
    try {
      erpContext = await readKyrubErpContext(currentUser);
    } catch (error) {
      if (signal?.aborted) throw error;
      console.warn('[Kyrubia] Store operation preflight could not load ERP context.', error);
    }
  }

  const currentStatus = erpContext?.store?.configured === true
    ? erpContext.store.status
    : null;
  const storeOperation = currentStatus
    ? resolveKyrubiaDeterministicStoreOperation(
        latestUserMessage.content,
        currentStatus
      )
    : null;

  if (storeOperation) {
    const requestId = createRuntimeRequestId();
    emitKyrubStoreOperationProposal(
      payload.conversationId,
      requestId,
      storeOperation.proposal
    );
    return {
      reply: storeOperation.reply,
      provider: 'kyrub',
      model: 'kyrub-store-operation-runtime-v1',
      mode: 'deterministic',
      requestId,
      capabilities: {
        actionsEnabled: true,
        voiceEnabled: false,
        persistentCloudHistoryEnabled: false,
      },
    };
  }

  return requestKyrubAiConsultantBase(
    erpContext ? { ...payload, erpContext } : payload,
    signal
  );
};
