import {
  KYRUB_AI_CONSULTANT_COMPAT_ENDPOINT,
  KYRUB_AI_CONSULTANT_ENDPOINT,
  KYRUB_AI_CONSULTANT_LEGACY_ENDPOINT,
  KYRUB_AI_LIMITS,
  type KyrubAiConsultantRequest,
  type KyrubAiConsultantResponse,
  type KyrubAiHistoricalLink,
} from '../../shared/aiConsultant';
import { resolveKyrubiaDeterministicErpRead } from '../../shared/kyrubiaDeterministicErp';
import {
  describeKyrubiaTurnSelection,
  resolveKyrubiaContextualRecall,
  resolveKyrubiaMissingContextReply,
  resolveKyrubiaTurnSelection,
} from '../../shared/kyrubiaContext';
import { readKyrubErpContext } from '../actions/erpReadActionService';
import { auth } from '../utils/firebase';
import { emitKyrubAiActionProposal } from './actionEvents';
import { normalizeConsultantError } from './consultantError';
import { loadKyrubAiConversations } from './conversationStore';
import {
  isKyrubiaPureContinuationRequest,
  resolveKyrubiaCrossChatContinuation,
  type KyrubiaCrossChatCandidate,
} from './crossConversationMemory';
import { prepareKyrubAiOpportunityContinuation } from './opportunityContinuation';

export class KyrubAiClientError extends Error {
  constructor(
    message: string,
    public readonly code = 'AI_UNAVAILABLE',
    public readonly status = 503
  ) {
    super(message);
    this.name = 'KyrubAiClientError';
  }
}

const CONSULTANT_ENDPOINTS = [
  KYRUB_AI_CONSULTANT_ENDPOINT,
  KYRUB_AI_CONSULTANT_COMPAT_ENDPOINT,
  KYRUB_AI_CONSULTANT_LEGACY_ENDPOINT,
] as const;

const DETERMINISTIC_READ_ACTIONS = [
  'read_store_summary',
  'list_products',
  'list_low_stock_products',
  'list_pending_orders',
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const readResponseBody = async (response: Response): Promise<unknown> => {
  const text = await response.text().catch(() => '');
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
};

const hasTopLevelKyrubCode = (value: unknown): boolean =>
  isRecord(value) && typeof value.code === 'string' && value.code.length > 0;

const createRuntimeRequestId = (): string => {
  try {
    return globalThis.crypto.randomUUID();
  } catch {
    return `kyrub-runtime-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
};

const runtimeCapabilities = (): KyrubAiConsultantResponse['capabilities'] => ({
  actionsEnabled: true,
  enabledActions: ['create_note'],
  enabledReadActions: [...DETERMINISTIC_READ_ACTIONS],
  voiceEnabled: false,
  persistentCloudHistoryEnabled: false,
});

const appendStructuredReferenceContext = (
  screenContext: string | undefined,
  ...structuredContexts: Array<string | null | undefined>
): string | undefined => {
  const joined = [screenContext?.trim(), ...structuredContexts.map(item => item?.trim())]
    .filter(Boolean)
    .join(' | ')
    .slice(0, KYRUB_AI_LIMITS.maxScreenContextCharacters);
  return joined || undefined;
};

const historicalLinkFromCandidate = (
  candidate: KyrubiaCrossChatCandidate,
  memoryContext: string
): KyrubAiHistoricalLink => ({
  sourceConversationId: candidate.conversationId,
  sourceTitle: candidate.title,
  sourceTopic: candidate.topic,
  sourceUpdatedAt: candidate.updatedAt,
  linkedAt: new Date().toISOString(),
  memoryContext,
});

const continuationAcknowledgement = (
  candidate: KyrubiaCrossChatCandidate
): string => {
  const preview = candidate.preview
    ? ` O último contexto salvo foi: “${candidate.preview}”.`
    : '';
  return `Retomei a conversa “${candidate.title}” e vinculei este chat àquele contexto histórico.${preview} Podemos continuar por aqui.`;
};

export const requestKyrubAiConsultant = async (
  payload: KyrubAiConsultantRequest,
  signal?: AbortSignal
): Promise<KyrubAiConsultantResponse> => {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new KyrubAiClientError(
      'Faça login para conversar com a Kyrubia.',
      'AUTH_REQUIRED',
      401
    );
  }

  const requestPayload = prepareKyrubAiOpportunityContinuation(payload);
  const latestUserMessage = requestPayload.messages.at(-1);

  const missingContextReply = latestUserMessage?.role === 'user'
    ? resolveKyrubiaMissingContextReply(
        latestUserMessage.content,
        requestPayload.turnContext
      )
    : null;

  if (missingContextReply) {
    return {
      reply: missingContextReply,
      provider: 'kyrub',
      model: 'kyrub-runtime-v1',
      mode: 'deterministic',
      requestId: createRuntimeRequestId(),
      capabilities: runtimeCapabilities(),
    };
  }

  const storedConversations = typeof localStorage === 'undefined'
    ? []
    : loadKyrubAiConversations(localStorage, currentUser.uid);
  const crossChatResolution = latestUserMessage?.role === 'user'
    ? resolveKyrubiaCrossChatContinuation(
        latestUserMessage.content,
        storedConversations,
        requestPayload.conversationId
      )
    : { kind: 'not_requested' as const };

  if (
    crossChatResolution.kind === 'not_found' ||
    crossChatResolution.kind === 'ambiguous'
  ) {
    return {
      reply: crossChatResolution.reply,
      provider: 'kyrub',
      model: 'kyrub-runtime-v1',
      mode: 'deterministic',
      requestId: createRuntimeRequestId(),
      capabilities: runtimeCapabilities(),
    };
  }

  const resolvedHistoricalLink = crossChatResolution.kind === 'resolved'
    ? historicalLinkFromCandidate(
        crossChatResolution.candidate,
        crossChatResolution.memoryContext
      )
    : undefined;

  if (
    crossChatResolution.kind === 'resolved' &&
    latestUserMessage?.role === 'user' &&
    isKyrubiaPureContinuationRequest(latestUserMessage.content)
  ) {
    return {
      reply: continuationAcknowledgement(crossChatResolution.candidate),
      provider: 'kyrub',
      model: 'kyrub-runtime-v1',
      mode: 'deterministic',
      requestId: createRuntimeRequestId(),
      historicalLink: resolvedHistoricalLink,
      capabilities: runtimeCapabilities(),
    };
  }

  const historicalContext = resolvedHistoricalLink?.memoryContext
    ?? requestPayload.historicalLink?.memoryContext
    ?? null;

  let erpContext = requestPayload.erpContext;
  if (!erpContext) {
    try {
      erpContext = await readKyrubErpContext(currentUser);
    } catch (error) {
      if (signal?.aborted) throw error;
      console.warn(
        '[Kyrubia] ERP read context is temporarily unavailable.',
        error
      );
    }
  }

  const deterministic = latestUserMessage?.role === 'user'
    ? resolveKyrubiaDeterministicErpRead(latestUserMessage.content, erpContext)
    : null;

  if (deterministic) {
    const requestId = createRuntimeRequestId();
    const actionProposal = deterministic.noteDraft
      ? {
          id: createRuntimeRequestId(),
          type: 'create_note' as const,
          title: deterministic.noteDraft.title,
          content: deterministic.noteDraft.content,
          checklist: deterministic.noteDraft.checklist,
          requiresConfirmation: true as const,
          origin: 'kyrubia' as const,
          risk: 'low' as const,
        }
      : undefined;

    const result: KyrubAiConsultantResponse = {
      reply: deterministic.reply,
      provider: 'kyrub',
      model: 'kyrub-runtime-v1',
      mode: 'deterministic',
      requestId,
      actionProposal,
      turnContext: deterministic.turnContext,
      historicalLink: resolvedHistoricalLink,
      capabilities: runtimeCapabilities(),
    };

    emitKyrubAiActionProposal(requestPayload.conversationId, result);
    return result;
  }

  const contextualRecall = latestUserMessage?.role === 'user'
    ? resolveKyrubiaContextualRecall(
        latestUserMessage.content,
        requestPayload.turnContext
      )
    : null;

  if (contextualRecall) {
    return {
      reply: contextualRecall.reply,
      provider: 'kyrub',
      model: 'kyrub-runtime-v1',
      mode: 'deterministic',
      requestId: createRuntimeRequestId(),
      turnContext: contextualRecall.turnContext,
      historicalLink: resolvedHistoricalLink,
      capabilities: runtimeCapabilities(),
    };
  }

  const turnSelection = latestUserMessage?.role === 'user'
    ? resolveKyrubiaTurnSelection(
        latestUserMessage.content,
        requestPayload.turnContext
      )
    : null;
  const structuredReference = turnSelection
    ? describeKyrubiaTurnSelection(turnSelection)
    : null;

  let token = '';
  try {
    token = await currentUser.getIdToken();
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new KyrubAiClientError(
      'Não foi possível validar sua sessão agora. Verifique sua internet e tente novamente.',
      'AUTH_UNAVAILABLE',
      503
    );
  }

  const {
    historicalLink: _historicalLink,
    ...requestForServer
  } = requestPayload;
  const contextualPayload: KyrubAiConsultantRequest = {
    ...requestForServer,
    screenContext: appendStructuredReferenceContext(
      requestPayload.screenContext,
      structuredReference,
      historicalContext
    ),
  };
  const enrichedPayload: KyrubAiConsultantRequest = erpContext
    ? { ...contextualPayload, erpContext }
    : contextualPayload;

  let lastNetworkFailure: unknown = null;

  for (const [index, endpoint] of CONSULTANT_ENDPOINTS.entries()) {
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(enrichedPayload),
        cache: 'no-store',
        credentials: 'same-origin',
        signal,
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      lastNetworkFailure = error;
      continue;
    }

    const body = await readResponseBody(response);
    const hasAnotherEndpoint = index < CONSULTANT_ENDPOINTS.length - 1;
    const canTryCompatibilityRoute =
      hasAnotherEndpoint &&
      (response.status === 404 ||
        response.status === 405 ||
        (response.status >= 500 && !hasTopLevelKyrubCode(body)));

    if (canTryCompatibilityRoute) continue;

    if (!response.ok) {
      const normalized = normalizeConsultantError(body);
      throw new KyrubAiClientError(
        normalized.message,
        normalized.code,
        response.status
      );
    }

    if (
      !isRecord(body) ||
      typeof body.reply !== 'string' ||
      !body.reply.trim()
    ) {
      throw new KyrubAiClientError(
        'O servidor respondeu sem uma mensagem válida. Tente novamente.',
        'AI_UNAVAILABLE',
        503
      );
    }

    const result: KyrubAiConsultantResponse = {
      ...(body as KyrubAiConsultantResponse),
      historicalLink: resolvedHistoricalLink,
    };
    emitKyrubAiActionProposal(payload.conversationId, result);
    return result;
  }

  console.warn('[Kyrubia] AI endpoint connection failed.', lastNetworkFailure);
  throw new KyrubAiClientError(
    'Não foi possível conectar ao servidor da Kyrubia. Verifique sua internet e tente novamente.',
    'AI_UNAVAILABLE',
    503
  );
};