import {
  KYRUB_AI_CONSULTANT_ENDPOINT,
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

  const token = await currentUser.getIdToken();
  const response = await fetch(KYRUB_AI_CONSULTANT_ENDPOINT, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal,
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = body as Partial<KyrubAiConsultantErrorResponse>;
    throw new KyrubAiClientError(
      error.error || 'O Consultor Kyrub está temporariamente indisponível.',
      error.code || 'AI_UNAVAILABLE',
      response.status
    );
  }

  return body as KyrubAiConsultantResponse;
};
