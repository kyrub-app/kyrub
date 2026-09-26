import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';
import { syncCanonicalOrderCustomerIntoCrm } from './storeCrmOrderSyncService.js';
import { loadStoreCrmSummary } from './storeCrmService.js';

type RequestLike = {
  method?: string;
  query?: Record<string, string | string[] | undefined>;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
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
const bodyRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const syncErrorStatus = (error: unknown): number => {
  const code = error instanceof Error ? error.message : '';
  if (code === 'STORE_CRM_ORDER_BUYER_FORBIDDEN' || code === 'STORE_CRM_ORDER_SOURCE_FORBIDDEN') return 403;
  if (code === 'STORE_CRM_ORDER_NOT_FOUND') return 404;
  if (
    code === 'STORE_CRM_STORE_REQUIRED' ||
    code === 'STORE_CRM_ORDER_REQUIRED' ||
    code === 'STORE_CRM_BUYER_REQUIRED' ||
    code === 'STORE_CRM_ORDER_INVALID' ||
    code === 'STORE_CRM_NOW_INVALID'
  ) return 400;
  return 401;
};

export const handleStoreCrmServerlessRequest = async (
  request: RequestLike,
  response: ResponseLike
): Promise<void> => {
  response.setHeader('Cache-Control', 'no-store, max-age=0');
  response.setHeader('Content-Type', 'application/json; charset=utf-8');

  const method = request.method?.toUpperCase() || 'GET';
  if (method !== 'GET' && method !== 'POST') {
    response.setHeader('Allow', 'GET, POST');
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

    if (method === 'POST') {
      const body = bodyRecord(request.body);
      const storeId = clean(body.storeId);
      const orderId = clean(body.orderId);
      if (!storeId) {
        response.status(400).json({ error: 'Loja não informada.', code: 'STORE_CRM_STORE_REQUIRED' });
        return;
      }
      if (!orderId) {
        response.status(400).json({ error: 'Pedido não informado.', code: 'STORE_CRM_ORDER_REQUIRED' });
        return;
      }

      const result = await syncCanonicalOrderCustomerIntoCrm({
        storeId,
        orderId,
        authenticatedBuyerId: identity.uid,
      });
      response.status(200).json({ ok: true, ...result });
      return;
    }

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
    const status = method === 'POST' ? syncErrorStatus(error) : 401;
    response.status(status).json({
      error: method === 'POST'
        ? 'Não foi possível sincronizar este pedido com o CRM.'
        : 'Não foi possível autenticar ou carregar o CRM.',
      code: method === 'POST'
        ? (error instanceof Error ? error.message : 'STORE_CRM_SYNC_REJECTED')
        : 'STORE_CRM_REQUEST_REJECTED',
    });
  }
};
