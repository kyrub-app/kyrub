import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';
import { loadOwnerStoreInstitutionalRepresentation } from '../store/storeInstitutionalIdentityService.js';
import { normalizeStoreSalesAnalyticsPeriod } from '../../shared/storeSalesAnalytics.js';
import { loadStoreSalesAnalytics } from './storeSalesAnalyticsService.js';

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

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const first = (value: string | string[] | undefined): string =>
  Array.isArray(value) ? value[0] ?? '' : value ?? '';

const bearer = (value: string): string =>
  /^Bearer\s+(.+)$/i.exec(value)?.[1]?.trim() ?? '';

const mapError = (error: unknown): { status: number; code: string; message: string } => {
  const code = error instanceof Error ? error.message : String(error);
  if (code === 'STORE_SALES_ANALYTICS_AUTH_REQUIRED') {
    return { status: 401, code, message: 'Faça login novamente.' };
  }
  if (code === 'STORE_REPRESENTATION_FORBIDDEN') {
    return { status: 403, code, message: 'Você não pode consultar as vendas desta loja.' };
  }
  if (code === 'STORE_SALES_ANALYTICS_STORE_REQUIRED') {
    return { status: 400, code, message: 'Loja não identificada.' };
  }
  console.error('[store-sales-analytics-serverless]', error);
  return {
    status: 503,
    code: 'STORE_SALES_ANALYTICS_UNAVAILABLE',
    message: 'Não foi possível carregar Vendas & Analytics agora.',
  };
};

export const handleStoreSalesAnalyticsServerlessRequest = async (
  request: RequestLike,
  response: ResponseLike
): Promise<void> => {
  response.setHeader('Cache-Control', 'no-store, max-age=0');
  response.setHeader('Content-Type', 'application/json; charset=utf-8');

  if ((request.method?.toUpperCase() || 'GET') !== 'GET') {
    response.setHeader('Allow', 'GET');
    response.status(405).json({ error: 'Método não permitido.', code: 'METHOD_NOT_ALLOWED' });
    return;
  }

  try {
    const token = bearer(first(request.headers.authorization ?? request.headers.Authorization));
    if (!token) throw new Error('STORE_SALES_ANALYTICS_AUTH_REQUIRED');
    const identity = await verifyFirebaseIdToken(token);
    const storeId = clean(first(request.query?.storeId));
    if (!storeId) throw new Error('STORE_SALES_ANALYTICS_STORE_REQUIRED');

    await loadOwnerStoreInstitutionalRepresentation({
      storeId,
      authenticatedUserId: identity.uid,
    });

    const period = normalizeStoreSalesAnalyticsPeriod(first(request.query?.period));
    response.status(200).json(await loadStoreSalesAnalytics({ storeId, period }));
  } catch (error) {
    const mapped = mapError(error);
    response.status(mapped.status).json({ error: mapped.message, code: mapped.code });
  }
};
