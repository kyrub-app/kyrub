import {
  KYRUB_AI_CONSULTANT_ENDPOINT,
  type KyrubAiConsultantRequest,
  type KyrubAiConsultantResponse,
} from '../../shared/aiConsultant';
import { buildKyrubInventoryAttachmentIntakeProposal } from '../../shared/kyrubInventoryIntake';
import { auth } from '../utils/firebase';
import { emitKyrubAiActionProposal } from './actionEvents';
import { loadKyrubiaCatalogAnalysis } from './catalogAnalysisStore';
import { KyrubAiClientError } from './consultantClient';
import { normalizeConsultantError } from './consultantError';

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

const withCatalogAnalysisContext = (
  payload: KyrubAiConsultantRequest,
  uid: string
): KyrubAiConsultantRequest => {
  if (payload.catalogAnalysisContext || typeof localStorage === 'undefined') {
    return payload;
  }
  const analysis = loadKyrubiaCatalogAnalysis(
    localStorage,
    uid,
    payload.conversationId
  );
  return analysis ? { ...payload, catalogAnalysisContext: analysis } : payload;
};

const latestAttachmentMessage = (
  payload: KyrubAiConsultantRequest
) => {
  for (let index = payload.messages.length - 1; index >= 0; index -= 1) {
    const message = payload.messages[index];
    if (message.role === 'user' && (message.attachments?.length ?? 0) > 0) {
      return message;
    }
  }
  return null;
};

const latestUserMessage = (
  payload: KyrubAiConsultantRequest
) => {
  for (let index = payload.messages.length - 1; index >= 0; index -= 1) {
    const message = payload.messages[index];
    if (message.role === 'user') return message;
  }
  return null;
};

const withDeterministicInventoryProposal = (
  payload: KyrubAiConsultantRequest,
  result: KyrubAiConsultantResponse
): KyrubAiConsultantResponse => {
  if (result.actionProposal) return result;

  const attachmentMessage = latestAttachmentMessage(payload);
  const intentMessage = latestUserMessage(payload);
  if (!attachmentMessage || !intentMessage) return result;

  const proposal = buildKyrubInventoryAttachmentIntakeProposal(
    intentMessage.content,
    result.reply,
    payload.conversationId,
    (attachmentMessage.attachments ?? []).map(attachment => attachment.id)
  );
  return proposal ? { ...result, actionProposal: proposal } : result;
};

export const requestKyrubAiMultimodalConsultant = async (
  payload: KyrubAiConsultantRequest,
  signal?: AbortSignal
): Promise<KyrubAiConsultantResponse> => {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new KyrubAiClientError(
      'Faça login para enviar anexos à Kyrubia.',
      'AUTH_REQUIRED',
      401
    );
  }

  const contextualPayload = withCatalogAnalysisContext(payload, currentUser.uid);
  const hasAttachments = payload.messages.some(
    message => message.role === 'user' && (message.attachments?.length ?? 0) > 0
  );
  if (!hasAttachments) {
    throw new KyrubAiClientError(
      'Esta conversa não possui anexos multimodais.',
      'INVALID_REQUEST',
      400
    );
  }

  let token = '';
  try {
    token = await currentUser.getIdToken();
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new KyrubAiClientError(
      'Não foi possível validar sua sessão para ler os anexos. Tente novamente.',
      'AUTH_UNAVAILABLE',
      503
    );
  }

  let response: Response;
  try {
    response = await fetch(KYRUB_AI_CONSULTANT_ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(contextualPayload),
      cache: 'no-store',
      credentials: 'same-origin',
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new KyrubAiClientError(
      'Não foi possível conectar ao servidor multimodal da Kyrubia. Verifique sua internet e tente novamente.',
      'AI_UNAVAILABLE',
      503
    );
  }

  const body = await readResponseBody(response);
  if (!response.ok) {
    const normalized = normalizeConsultantError(body);
    throw new KyrubAiClientError(
      normalized.message,
      normalized.code,
      response.status
    );
  }

  if (!isRecord(body) || typeof body.reply !== 'string' || !body.reply.trim()) {
    throw new KyrubAiClientError(
      'O servidor multimodal respondeu sem uma mensagem válida. Tente novamente.',
      'AI_UNAVAILABLE',
      503
    );
  }

  const result = withDeterministicInventoryProposal(
    contextualPayload,
    body as KyrubAiConsultantResponse
  );
  emitKyrubAiActionProposal(contextualPayload.conversationId, result);
  return result;
};
