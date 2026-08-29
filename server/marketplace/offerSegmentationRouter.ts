import { Router } from 'express';
import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';
import { deriveMarketplaceOfferSegments } from './offerSegmentationService.js';

const bearerToken = (authorization: string): string =>
  /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim() ?? '';

const mapError = (error: unknown): { status: number; message: string } => {
  const message = error instanceof Error ? error.message : String(error);
  if (message === 'AUTH_REQUIRED') {
    return { status: 401, message: 'Faça login novamente para personalizar o marketplace.' };
  }
  if (
    message === 'MARKETPLACE_SEGMENT_STORE_IDS_REQUIRED' ||
    message === 'MARKETPLACE_SEGMENT_STORE_IDS_LIMIT'
  ) {
    return { status: 400, message: 'Lista de lojas inválida para personalização.' };
  }
  if (message.startsWith('MARKETPLACE_SEGMENT_')) {
    return { status: 409, message: 'Não foi possível classificar as ofertas agora.' };
  }
  console.error('[Marketplace offer segments]', error);
  return { status: 503, message: 'Não foi possível personalizar o marketplace.' };
};

export const createMarketplaceOfferSegmentationRouter = (): Router => {
  const router = Router();

  router.post('/', async (request, response) => {
    try {
      const token = bearerToken(request.get('authorization') ?? '');
      if (!token) throw new Error('AUTH_REQUIRED');
      const identity = await verifyFirebaseIdToken(token);
      const body = request.body && typeof request.body === 'object'
        ? request.body as Record<string, unknown>
        : {};
      const segments = await deriveMarketplaceOfferSegments({
        storeIds: body.storeIds,
        customerId: identity.uid,
      });
      response.status(200).json(segments);
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message });
    }
  });

  return router;
};