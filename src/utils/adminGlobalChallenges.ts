import type { User } from 'firebase/auth';
import { assertKyrubChallengeDefinition, type KyrubChallengeDefinition } from '../../shared/gamification';
import type { GlobalChallengeListOptions, GlobalChallengePage } from '../../shared/globalChallengeAdmin';

export class GlobalChallengeApiError extends Error {
  constructor(readonly status: number, readonly code: string, readonly retryAfter = 0) {
    super(status === 401 ? 'Sua sessão expirou. Entre novamente no Control Plane.' :
      status === 403 ? 'Acesso negado. É necessário um perfil ativo de Super Admin.' :
      status === 409 ? 'O desafio já existe ou mudou de estado. Atualize a consulta antes de continuar.' :
      status === 429 ? `Limite de requisições atingido. Tente novamente${retryAfter ? ` em ${retryAfter} segundos` : ' em instantes'}.` :
      status === 404 ? 'Desafio não encontrado. Atualize a lista.' :
      [400, 411, 413, 415].includes(status) ? 'Revise os dados, os limites e o período do desafio.' :
      'Não foi possível concluir a operação. Tente novamente.');
  }
}

// Fresh Firebase token per request; all reads/writes go through the server API.
// Mutations are deliberately never retried automatically.
export const createGlobalChallengeAdminClient = (user: Pick<User, 'getIdToken'>) => {
  const request = async <T>(query: Record<string, string>, body?: unknown, signal?: AbortSignal): Promise<T> => {
    const token = await user.getIdToken();
    const response = await fetch(`/api/admin/global-challenges?${new URLSearchParams(query)}`, {
      method: body === undefined ? 'GET' : 'POST', cache: 'no-store', signal,
      headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new GlobalChallengeApiError(response.status, typeof data?.code === 'string' ? data.code : 'GLOBAL_CHALLENGE_UNAVAILABLE', Number(response.headers.get('retry-after')) || 0);
    if (!data || typeof data !== 'object') throw new GlobalChallengeApiError(503, 'GLOBAL_CHALLENGE_RESPONSE_INVALID');
    return data as T;
  };
  return {
    list: (options: GlobalChallengeListOptions = {}, signal?: AbortSignal) => request<GlobalChallengePage>({ operation: 'list', limit: String(options.limit ?? 20),
      ...(options.status ? { status: options.status } : {}), ...(options.cursor ? { cursor: options.cursor } : {}) }, undefined, signal),
    get: (id: string, signal?: AbortSignal) => request<{ challenge: KyrubChallengeDefinition }>({ operation: 'get', challengeId: id }, undefined, signal),
    create: (challenge: KyrubChallengeDefinition, signal?: AbortSignal) => request<{ challenge: KyrubChallengeDefinition }>({ operation: 'create' }, assertKyrubChallengeDefinition(challenge), signal),
    publish: (challengeId: string, signal?: AbortSignal) => request<{ challenge: KyrubChallengeDefinition }>({ operation: 'publish' }, { challengeId }, signal),
  };
};
