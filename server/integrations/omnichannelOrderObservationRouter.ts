import { Router, type Request, type Response } from 'express';
import { adminAuth } from '../firebaseAdmin.js';
import { listRecentOmnichannelObservedOrders } from './omnichannelOrderObservationService.js';

const bearerToken = (request: Request): string => {
  const authorization = request.get('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  return match?.[1]?.trim() ?? '';
};

const authenticatedTenantId = async (request: Request): Promise<string> => {
  const token = bearerToken(request);
  if (!token) throw new Error('AUTH_REQUIRED');
  const decoded = await adminAuth.verifyIdToken(token, true);
  return decoded.uid;
};

const errorResponse = (response: Response, error: unknown): void => {
  const message = error instanceof Error ? error.message : String(error);
  if (
    message === 'AUTH_REQUIRED' ||
    /id-token|token has expired|revoked/i.test(message)
  ) {
    response.status(401).json({ error: 'Faça login novamente.' });
    return;
  }
  if (message === 'OMNICHANNEL_ORDER_OBSERVATION_FORBIDDEN') {
    response.status(403).json({ error: message });
    return;
  }
  if (message === 'OMNICHANNEL_ORDER_OBSERVATION_CANONICAL_STORE_REQUIRED') {
    response.status(409).json({ error: message });
    return;
  }
  console.error('[Omnichannel Order Observation]', error);
  response.status(503).json({
    error: message || 'A observabilidade omnichannel está temporariamente indisponível.',
  });
};

export const createOmnichannelOrderObservationRouter = (): Router => {
  const router = Router();

  router.get('/orders/recent', async (request, response) => {
    try {
      const tenantId = await authenticatedTenantId(request);
      const requestedLimit = Number(request.query.limit ?? 30);
      response.json(await listRecentOmnichannelObservedOrders({
        tenantId,
        requestedByUserId: tenantId,
        limit: Number.isFinite(requestedLimit) ? requestedLimit : 30,
      }));
    } catch (error) {
      errorResponse(response, error);
    }
  });

  return router;
};
