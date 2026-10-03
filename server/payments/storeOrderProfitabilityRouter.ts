import { Router } from 'express';
import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';
import { loadOwnerStoreInstitutionalRepresentation } from '../store/storeInstitutionalIdentityService.js';
import { reconcileStoreOrderProfitability } from './storeOrderProfitabilityService.js';
import { reconcileStoreProductProfitability } from './storeProductProfitabilityService.js';
import { backfillStoreProfitabilityPage } from './storeProfitabilityBackfillService.js';

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const bearerToken = (authorization: string): string =>
  /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim() ?? '';

const requireOwner = async (
  authorization: string,
  storeId: string
): Promise<void> => {
  const token = bearerToken(authorization);
  if (!token) throw new Error('AUTH_REQUIRED');
  const identity = await verifyFirebaseIdToken(token);
  await loadOwnerStoreInstitutionalRepresentation({
    storeId,
    authenticatedUserId: identity.uid,
  });
};

const mapError = (error: unknown): { status: number; code: string; message: string } => {
  const code = error instanceof Error ? error.message : String(error);
  if (code === 'AUTH_REQUIRED') {
    return { status: 401, code, message: 'Faça login novamente.' };
  }
  if (code === 'STORE_REPRESENTATION_FORBIDDEN') {
    return {
      status: 403,
      code,
      message: 'Você não pode consultar os resultados desta loja.',
    };
  }
  if (code === 'STORE_ORDER_PROFITABILITY_STORE_REQUIRED') {
    return { status: 400, code, message: 'Loja não identificada.' };
  }
  if (
    code === 'STORE_ECONOMIC_LEDGER_CURSOR_INVALID' ||
    code === 'STORE_ECONOMIC_LEDGER_PAGE_LIMIT_INVALID'
  ) {
    return { status: 400, code, message: 'Página histórica inválida.' };
  }
  console.error('[Store order profitability]', error);
  return {
    status: 503,
    code: 'STORE_ORDER_PROFITABILITY_UNAVAILABLE',
    message: 'Não foi possível consolidar os resultados dos pedidos agora.',
  };
};

export const createStoreOrderProfitabilityRouter = (): Router => {
  const router = Router();

  router.get('/', async (request, response) => {
    try {
      const storeId = clean(request.query.storeId);
      if (!storeId) throw new Error('STORE_ORDER_PROFITABILITY_STORE_REQUIRED');
      await requireOwner(request.get('authorization') ?? '', storeId);
      const profitability = await reconcileStoreOrderProfitability(storeId);
      response.status(200).json(profitability);
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({
        error: mapped.message,
        code: mapped.code,
      });
    }
  });

  router.get('/products', async (request, response) => {
    try {
      const storeId = clean(request.query.storeId);
      if (!storeId) throw new Error('STORE_ORDER_PROFITABILITY_STORE_REQUIRED');
      await requireOwner(request.get('authorization') ?? '', storeId);
      const profitability = await reconcileStoreProductProfitability(storeId);
      response.status(200).json(profitability);
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({
        error: mapped.message,
        code: mapped.code,
      });
    }
  });

  router.post('/backfill', async (request, response) => {
    try {
      const storeId = clean(request.query.storeId);
      if (!storeId) throw new Error('STORE_ORDER_PROFITABILITY_STORE_REQUIRED');
      await requireOwner(request.get('authorization') ?? '', storeId);
      const body = request.body && typeof request.body === 'object'
        ? request.body as Record<string, unknown>
        : {};
      const rawLimit = body.limit;
      const limit = rawLimit === undefined ? undefined : Number(rawLimit);
      if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1 || limit > 50)) {
        throw new Error('STORE_ECONOMIC_LEDGER_PAGE_LIMIT_INVALID');
      }
      const result = await backfillStoreProfitabilityPage({
        storeId,
        cursor: clean(body.cursor) || undefined,
        limit,
      });
      response.status(200).json(result);
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({
        error: mapped.message,
        code: mapped.code,
      });
    }
  });

  return router;
};