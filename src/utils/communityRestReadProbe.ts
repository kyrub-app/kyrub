import type { User } from 'firebase/auth';

/**
 * Optional one-shot comparison against Google's official Firestore REST API.
 * Uses the existing Firebase session token only for a direct HTTPS request
 * to firestore.googleapis.com. Neither token nor document data is logged,
 * displayed, persisted or forwarded to a Kyrub endpoint.
 */
export const probeCommunityGoogleRest = async (user: User, communityId: string): Promise<string> => {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(communityId)) return 'identificador inválido';
  const resource = 'projects/kyrub-b8d0e/databases/(default)/documents/communities/' + communityId;
  const url = 'https://firestore.googleapis.com/v1/' +
    resource + '?mask.fieldPaths=name';
  try {
    const idToken = await user.getIdToken();
    if (!idToken) return 'sem token de autenticação';
    const response = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      mode: 'cors',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      headers: { Authorization: 'Bearer ' + idToken, Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (response.status === 404) return 'documento não encontrado (HTTP 404)';
    if (response.status === 401) return 'sessão rejeitada (HTTP 401)';
    if (response.status === 403) return 'acesso negado (HTTP 403)';
    if (response.status === 429) return 'limite de consultas (HTTP 429)';
    if (response.status >= 500) return 'serviço indisponível (HTTP ' + response.status + ')';
    if (!response.ok) return 'HTTP ' + response.status;
    // A field mask minimizes response data. Only inspect the resource ID:
    // never expose fields, owner ID, or returned document payload.
    const body = await response.json() as { name?: unknown };
    return body?.name === resource ? 'documento encontrado (HTTP 200)' :
      'resposta de recurso inesperado';
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      return 'tempo de resposta excedido';
    }
    return 'indisponível ou bloqueado pelo navegador';
  }
};
