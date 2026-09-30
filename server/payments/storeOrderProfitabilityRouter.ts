import { Router } from 'express';
import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';
import { loadOwnerStoreInstitutionalRepresentation } from '../store/storeInstitutionalIdentityService.js';
import { reconcileStoreOrderProfitability } from './storeOrderProfitabilityService.js';

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

  return router;
};
