import { Router } from 'express';
import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';
import { loadStoreCrmSummary } from './storeCrmService.js';

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const bearerToken = (authorization: string): string =>
  /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim() ?? '';

const mapError = (error: unknown): { status: number; message: string } => {
  const message = error instanceof Error ? error.message : String(error);
  if (message === 'AUTH_REQUIRED') {
    return { status: 401, message: 'Faça login novamente para consultar o CRM.' };
  }
  if (message === 'STORE_CRM_STORE_REQUIRED') {
    return { status: 400, message: 'Loja não identificada.' };
  }
  if (message === 'STORE_CRM_FORBIDDEN') {
    return { status: 403, message: 'Você não pode consultar o CRM desta loja.' };
  }
  if (message.startsWith('STORE_CRM_')) {
    console.warn('[Store CRM]', message);
    return {
      status: 409,
      message: 'Os dados canônicos desta loja estão inconsistentes para o CRM.',
    };
  }
  console.error('[Store CRM]', error);
  return { status: 503, message: 'Não foi possível carregar o CRM da loja.' };
};

export const createStoreCrmRouter = (): Router => {
  const router = Router();

  router.get('/', async (request, response) => {
    try {
      const token = bearerToken(request.get('authorization') ?? '');
      if (!token) throw new Error('AUTH_REQUIRED');
      const identity = await verifyFirebaseIdToken(token);
      const storeId = clean(request.query.storeId);
      if (!storeId) throw new Error('STORE_CRM_STORE_REQUIRED');
      if (identity.uid !== storeId) throw new Error('STORE_CRM_FORBIDDEN');

      const summary = await loadStoreCrmSummary({ storeId });
      response.status(200).json(summary);
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message });
    }
  });

  return router;
};
