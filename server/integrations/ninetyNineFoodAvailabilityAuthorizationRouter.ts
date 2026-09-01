import { Router, type Request, type Response } from 'express';
import { adminAuth } from '../firebaseAdmin';
import { authorizeNinetyNineFoodAvailability } from './ninetyNineFoodAvailabilityAuthorizationService';
import { createNinetyNineFoodAvailabilityExecutorRouter } from './ninetyNineFoodAvailabilityExecutorRouter';

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
  if (message === 'AUTH_REQUIRED' || /id-token|token has expired|revoked/i.test(message)) {
    response.status(401).json({ error: 'Faça login novamente.' });
    return;
  }
  if (/NOT_FOUND/.test(message)) {
    response.status(404).json({ error: message });
    return;
  }
  if (/STALE|CONFLICT/.test(message)) {
    response.status(409).json({ error: message });
    return;
  }
  if (/INPUT_INVALID|REQUIRED|PROPOSAL_INVALID|CANONICAL_STORE_REQUIRED/.test(message)) {
    response.status(400).json({ error: message });
    return;
  }
  console.error('[99Food Availability Authorization]', error);
  response.status(503).json({ error: message || 'A autorização de disponibilidade 99Food está temporariamente indisponível.' });
};

export const createNinetyNineFoodAvailabilityAuthorizationRouter = (): Router => {
  const router = Router();
  router.use(createNinetyNineFoodAvailabilityExecutorRouter());

  router.post('/availability-proposals/:proposalId/authorize', async (request, response) => {
    try {
      const tenantId = await authenticatedTenantId(request);
      response.status(201).json(await authorizeNinetyNineFoodAvailability({
        tenantId,
        proposalId: request.params.proposalId,
        authorizedByUserId: tenantId,
      }));
    } catch (error) {
      errorResponse(response, error);
    }
  });

  return router;
};
