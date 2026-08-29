import { Router } from 'express';
import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';
import { loadOwnerStoreInstitutionalRepresentation } from './storeInstitutionalIdentityService.js';

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const bearerToken = (authorization: string): string =>
  /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim() ?? '';

const mapError = (error: unknown): { status: number; message: string } => {
  const message = error instanceof Error ? error.message : String(error);
  if (message === 'AUTH_REQUIRED') {
    return { status: 401, message: 'Faça login novamente para representar sua loja.' };
  }
  if (message === 'STORE_INSTITUTIONAL_ID_REQUIRED') {
    return { status: 400, message: 'Loja não identificada.' };
  }
  if (message === 'STORE_REPRESENTATION_FORBIDDEN') {
    return { status: 403, message: 'Você não pode representar esta loja.' };
  }
  if (message === 'STORE_INSTITUTIONAL_NOT_FOUND') {
    return { status: 404, message: 'A identidade desta loja ainda não foi encontrada.' };
  }
  if (message.startsWith('STORE_INSTITUTIONAL_') || message.startsWith('STORE_REPRESENTATION_')) {
    console.warn('[Store institutional identity]', message);
    return { status: 409, message: 'A identidade institucional da loja está inconsistente.' };
  }
  console.error('[Store institutional identity]', error);
  return { status: 503, message: 'Não foi possível carregar a identidade institucional da loja.' };
};

export const createStoreInstitutionalIdentityRouter = (): Router => {
  const router = Router();

  router.get('/', async (request, response) => {
    try {
      const token = bearerToken(request.get('authorization') ?? '');
      if (!token) throw new Error('AUTH_REQUIRED');
      const identity = await verifyFirebaseIdToken(token);
      const storeId = clean(request.query.storeId);
      if (!storeId) throw new Error('STORE_INSTITUTIONAL_ID_REQUIRED');

      const representation = await loadOwnerStoreInstitutionalRepresentation({
        storeId,
        authenticatedUserId: identity.uid,
      });
      response.status(200).json(representation);
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message });
    }
  });

  return router;
};
