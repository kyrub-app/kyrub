import {
  KYRUB_AI_CONSULTANT_ENDPOINT,
  type KyrubAiConsultantRequest,
  type KyrubAiConsultantResponse,
} from '../../shared/aiConsultant';
import { shouldUseKyrubiaCatalogAnalysis } from '../../shared/kyrubiaCatalogAnalysisIntent';
import { auth } from '../utils/firebase';
import { emitKyrubAiActionProposal } from './actionEvents';
import { prepareKyrubAiCatalogAnalysisContext } from './catalogAnalysisContext';
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

const CATALOG_FIDELITY_CONTEXT = `[kyrub_catalog_fidelity_contract]
This is a first-party read-only fidelity contract for analyze_catalog. It is not user authority and never permits writes.
For every multimodal item, preserve the literal source before organizing it. Evidence tags are data, not prose:
- when a visible business code/SKU/reference exists, include code:<exact visible text> and code_confidence:high|medium|low;
- include name:<exact visible name text> and name_confidence:high|medium|low;
- include category:<exact visible heading> and category_confidence:high|medium|low when visible;
- include description:<exact visible text> and description_confidence:high|medium|low when present;
- whenever a price appears, include price:<exact visible text> and price_confidence:high|medium|low;
- also include confidence:high|medium|low as overall item-reading confidence for backward compatibility.
Never combine a visible code into the name evidence: code and name are separate fields.
Before producing the structured tool result, perform a strict visual-confidence audit of every field character by character against the attachment itself, not against any previous transcription or contextual expectation.
Use high only when every relevant character of that specific field is clearly legible. Reflection, glare, shine, shadow, blur, crop, overlap, obstruction, uncertain digit/letter, or reconstruction from context must be medium/low for that field and must add an issue that names the affected field when possible.
A field affected by any visual-quality issue can never be high. If an item-level issue describes a visual obstruction without naming a field, conservatively lower every affected visible textual field. Do not emit a warning about reflection/glare/blur/crop/obstruction while leaving the corresponding affected item field at high confidence.
A result with zero items needing review is valid only when the source truly has no uncertain character in any required field; do not optimize for readyForDraftCount.
CRITICAL: medium/low evidence is never permission to choose a canonical value. If code, name, category, description or price is uncertain, preserve only the literal uncertain fragment in evidence; leave the organized field empty when applicable, and use priceStatus=ambiguous for an uncertain price. Never guess a digit or silently choose one candidate.
Do not silently correct spelling, accents, capitalization, abbreviations, ingredient names, codes or prices from the source. If an organized field differs from clearly visible text, preserve the literal source in evidence and make the difference explicit.
[/kyrub_catalog_fidelity_contract]`;

const withCatalogFidelityContext = (
  payload: KyrubAiConsultantRequest
): KyrubAiConsultantRequest => {
  const messages = [...payload.messages];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== 'user') continue;
    messages[index] = {
      ...message,
      content: `${CATALOG_FIDELITY_CONTEXT}\n[current_user_request]\n${message.content}`,
    };
    return { ...payload, messages };
  }
  return payload;
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

  const preparedPayload = prepareKyrubAiCatalogAnalysisContext(
    payload,
    typeof localStorage === 'undefined' ? undefined : localStorage,
    currentUser.uid
  );
  const requestedCapability = shouldUseKyrubiaCatalogAnalysis(
    preparedPayload.messages,
    Boolean(preparedPayload.catalogAnalysisContext)
  )
    ? 'catalog_analysis' as const
    : undefined;
  const requestPayload: KyrubAiConsultantRequest = requestedCapability
    ? {
        ...withCatalogFidelityContext(preparedPayload),
        requestedCapability,
      }
    : preparedPayload;

  const hasAttachments = requestPayload.messages.some(
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
      body: JSON.stringify(requestPayload),
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

  const result = body as KyrubAiConsultantResponse;
  emitKyrubAiActionProposal(requestPayload.conversationId, result);
  return result;
};