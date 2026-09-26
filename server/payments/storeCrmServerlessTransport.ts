import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';
import { loadStoreCrmSummary } from './storeCrmService.js';

type RequestLike = {
  method?: string;
  query?: Record<string, string | string[] | undefined>;
  headers: Record<string, string | string[] | undefined>;
};

type ResponseLike = {
  setHeader(name: string, value: string): void;
  status(code: number): ResponseLike;
  json(payload: unknown): void;
};

const clean = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const queryValue = (value: string | string[] | undefined): string =>
  Array.isArray(value) ? value[0] ?? '' : value ?? '';
const headerValue = (value: string | string[] | undefined): string =>
  Array.isArray(value) ? value[0] ?? '' : value ?? '';
const bearerToken = (authorization: string): string => {
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? '';
};

export const handleStoreCrmServerlessRequest = async (
  request: RequestLike,
  response: ResponseLike
): Promise<void> => {
  response.setHeader('Cache-Control', 'no-store, max-age=0');
  response.setHeader('Content-Type', 'application/json; charset=utf-8');

  const method = request.method?.toUpperCase() || 'GET';
  if (method !== 'GET') {
    response.setHeader('Allow', 'GET');
    response.status(405).json({ error: 'Método não permitido.', code: 'METHOD_NOT_ALLOWED' });
    return;
  }

  const token = bearerToken(headerValue(
    request.headers.authorization ?? request.headers.Authorization
  ));
  if (!token) {
    response.status(401).json({ error: 'Autenticação obrigatória.', code: 'STORE_CRM_AUTH_REQUIRED' });
    return;
  }

  try {
    const identity = await verifyFirebaseIdToken(token);
    const storeId = clean(queryValue(request.query?.storeId));
    if (!storeId) {
      response.status(400).json({ error: 'Loja não informada.', code: 'STORE_CRM_STORE_REQUIRED' });
      return;
    }
    if (identity.uid !== storeId) {
      response.status(403).json({ error: 'Você não pode acessar o CRM desta loja.', code: 'STORE_CRM_FORBIDDEN' });
      return;
    }

    response.status(200).json(await loadStoreCrmSummary({ storeId }));
  } catch (error) {
    console.error(
      '[store-crm-serverless]',
      error instanceof Error ? error.message : String(error)
    );
    response.status(401).json({
      error: 'Não foi possível autenticar ou carregar o CRM.',
      code: 'STORE_CRM_REQUEST_REJECTED',
    });
  }
};
