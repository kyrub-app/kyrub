import { Router } from 'express';
import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';
import { loadOwnerStoreInstitutionalRepresentation } from '../store/storeInstitutionalIdentityService.js';
import { normalizeStoreSalesAnalyticsPeriod } from '../../shared/storeSalesAnalytics.js';
import { loadStoreSalesAnalytics } from './storeSalesAnalyticsService.js';

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const bearer = (value: string): string =>
  /^Bearer\s+(.+)$/i.exec(value)?.[1]?.trim() ?? '';

const mapError = (error: unknown): { status: number; message: string; code: string } => {
  const code = error instanceof Error ? error.message : String(error);
  if (code === 'STORE_SALES_ANALYTICS_AUTH_REQUIRED') {
    return { status: 401, message: 'Faça login novamente.', code };
  }
  if (code === 'STORE_REPRESENTATION_FORBIDDEN') {
    return { status: 403, message: 'Você não pode consultar as vendas desta loja.', code };
  }
  if (code === 'STORE_SALES_ANALYTICS_STORE_REQUIRED') {
    return { status: 400, message: 'Loja não identificada.', code };
  }
  console.error('[Store sales analytics]', error);
  return {
    status: 503,
    message: 'Não foi possível carregar Vendas & Analytics agora.',
    code: 'STORE_SALES_ANALYTICS_UNAVAILABLE',
  };
};

export const createStoreSalesAnalyticsRouter = (): Router => {
  const router = Router();

  router.get('/', async (request, response) => {
    try {
      const token = bearer(request.get('authorization') ?? '');
      if (!token) throw new Error('STORE_SALES_ANALYTICS_AUTH_REQUIRED');
      const identity = await verifyFirebaseIdToken(token);
      const storeId = clean(request.query.storeId);
      if (!storeId) throw new Error('STORE_SALES_ANALYTICS_STORE_REQUIRED');

      await loadOwnerStoreInstitutionalRepresentation({
        storeId,
        authenticatedUserId: identity.uid,
      });

      const period = normalizeStoreSalesAnalyticsPeriod(request.query.period);
      response.status(200).json(await loadStoreSalesAnalytics({ storeId, period }));
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message, code: mapped.code });
    }
  });

  return router;
};
