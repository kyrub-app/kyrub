import {
  KYRUB_AI_CONSULTANT_ENDPOINT,
  KYRUB_AI_CONSULTANT_LEGACY_ENDPOINT,
  type KyrubAiConsultantErrorResponse,
  type KyrubAiConsultantRequest,
  type KyrubAiConsultantResponse,
} from '../../shared/aiConsultant';
import { auth } from '../utils/firebase';

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
  KYRUB_AI_CONSULTANT_LEGACY_ENDPOINT,
] as const;

const readResponseBody = async (
  response: Response
): Promise<Partial<KyrubAiConsultantResponse & KyrubAiConsultantErrorResponse>> =>
  response.json().catch(() => ({}));

export const requestKyrubAiConsultant = async (
  payload: KyrubAiConsultantRequest,
  signal?: AbortSignal
): Promise<KyrubAiConsultantResponse> => {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new KyrubAiClientError(
      'Faça login para conversar com o Consultor Kyrub.',
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
      'Não foi possível validar sua sessão agora. Verifique sua internet e tente novamente.',
      'AUTH_UNAVAILABLE',
      503
    );
  }

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
        body: JSON.stringify(payload),
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
    const canTryCompatibilityRoute =
      index === 0 &&
      (response.status === 404 ||
        response.status === 405 ||
        (response.status >= 500 && !body.code));

    if (canTryCompatibilityRoute) continue;

    if (!response.ok) {
      throw new KyrubAiClientError(
        body.error || 'O Consultor Kyrub está temporariamente indisponível.',
        body.code || 'AI_UNAVAILABLE',
        response.status
      );
    }

    if (typeof body.reply !== 'string' || !body.reply.trim()) {
      throw new KyrubAiClientError(
        'O servidor respondeu sem uma mensagem válida. Tente novamente.',
        'AI_UNAVAILABLE',
        503
      );
    }

    return body as KyrubAiConsultantResponse;
  }

  console.warn('[Kyrub AI] Consultant endpoint connection failed.', lastNetworkFailure);
  throw new KyrubAiClientError(
    'Não foi possível conectar ao servidor da Kyrub I.A. Verifique sua internet e tente novamente.',
    'AI_UNAVAILABLE',
    503
  );
};
