import {
  KYRUB_AI_CATALOG_ANALYSIS_ENDPOINT,
  type KyrubAiConsultantRequest,
  type KyrubAiConsultantResponse,
} from '../../shared/aiConsultant';
import { normalizeKyrubCatalogAnalysis } from '../../shared/kyrubCatalogAnalysis';
import { auth } from '../utils/firebase';
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

export const requestKyrubiaCatalogAnalysis = async (
  payload: KyrubAiConsultantRequest,
  signal?: AbortSignal
): Promise<KyrubAiConsultantResponse> => {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new KyrubAiClientError(
      'Faça login para analisar um catálogo com a Kyrubia.',
      'AUTH_REQUIRED',
      401
    );
  }

  let token = '';
  try {
    token = await currentUser.getIdToken();
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new KyrubAiClientError(
      'Não foi possível validar sua sessão para analisar o catálogo.',
      'AUTH_UNAVAILABLE',
      503
    );
  }

  let response: Response;
  try {
    response = await fetch(KYRUB_AI_CATALOG_ANALYSIS_ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(payload),
      cache: 'no-store',
      credentials: 'same-origin',
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new KyrubAiClientError(
      'Não foi possível conectar à análise de catálogo da Kyrubia.',
      'AI_UNAVAILABLE',
      503
    );
  }

  const body = await readResponseBody(response);
  if (!response.ok) {
    const normalized = normalizeConsultantError(body);
    throw new KyrubAiClientError(normalized.message, normalized.code, response.status);
  }
  if (!isRecord(body) || typeof body.reply !== 'string' || !body.reply.trim()) {
    throw new KyrubAiClientError(
      'A análise do catálogo voltou sem uma resposta válida.',
      'AI_UNAVAILABLE',
      503
    );
  }

  const rawAnalysis = isRecord(body.catalogAnalysis) ? body.catalogAnalysis : null;
  const sourceKind = rawAnalysis?.sourceKind === 'multimodal' ? 'multimodal' : 'text';
  const attachmentCount = typeof rawAnalysis?.attachmentCount === 'number'
    ? rawAnalysis.attachmentCount
    : 0;
  const catalogAnalysis = normalizeKyrubCatalogAnalysis(rawAnalysis, {
    sourceKind,
    attachmentCount,
  });
  if (!catalogAnalysis) {
    throw new KyrubAiClientError(
      'A Kyrubia respondeu, mas a análise estruturada do catálogo ficou inválida.',
      'AI_UNAVAILABLE',
      503
    );
  }

  return {
    ...(body as KyrubAiConsultantResponse),
    catalogAnalysis,
    actionProposal: undefined,
  };
};
