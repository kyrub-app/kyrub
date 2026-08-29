import { Router } from 'express';
import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';
import { loadStoreRelationshipSummary } from './storeRelationshipService.js';

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const bearerToken = (authorization: string): string =>
  /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim() ?? '';

const mapError = (error: unknown): { status: number; message: string } => {
  const message = error instanceof Error ? error.message : String(error);
  if (message === 'AUTH_REQUIRED') {
    return { status: 401, message: 'Faça login novamente para consultar seu relacionamento.' };
  }
  if (message === 'STORE_RELATIONSHIP_REQUIRED') {
    return { status: 400, message: 'Loja não identificada.' };
  }
  if (message.startsWith('STORE_RELATIONSHIP_')) {
    console.warn('[Store relationship]', message);
    return { status: 409, message: 'Os dados de fidelidade desta loja estão inconsistentes.' };
  }
  console.error('[Store relationship]', error);
  return { status: 503, message: 'Não foi possível carregar seu relacionamento com a loja.' };
};

export const createStoreRelationshipRouter = (): Router => {
  const router = Router();

  router.get('/', async (request, response) => {
    try {
      const token = bearerToken(request.get('authorization') ?? '');
      if (!token) throw new Error('AUTH_REQUIRED');
      const identity = await verifyFirebaseIdToken(token);
      const storeId = clean(request.query.storeId);
      if (!storeId) throw new Error('STORE_RELATIONSHIP_REQUIRED');

      const summary = await loadStoreRelationshipSummary({
        storeId,
        customerId: identity.uid,
      });
      response.status(200).json(summary);
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message });
    }
  });

  return router;
};