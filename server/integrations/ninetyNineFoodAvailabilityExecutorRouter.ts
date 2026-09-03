import { Router, type Request, type Response } from 'express';
import { adminAuth } from '../firebaseAdmin';
import { executeNinetyNineFoodAvailability } from './ninetyNineFoodAvailabilityExecutorService';
import { reconcileNinetyNineFoodAvailability } from './ninetyNineFoodAvailabilityReconciliationService';

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
  if (message === 'AUTH_REQUIRED' || /id-token|expired|revoked/i.test(message)) {
    response.status(401).json({ error: 'Faça login novamente.' });
    return;
  }
  if (/NOT_FOUND/.test(message)) {
    response.status(404).json({ error: message });
    return;
  }
  if (/STALE|CONFLICT|EXPIRED|AUTHORIZATION_INVALID|AMBIGUOUS/.test(message)) {
    response.status(409).json({ error: message });
    return;
  }
  if (/INPUT_INVALID|REQUIRED|CONTEXT_INVALID|CREDENTIALS_REQUIRED|QUANTITY_INVALID|EXECUTION_INVALID/.test(message)) {
    response.status(400).json({ error: message });
    return;
  }
  console.error('[99Food Availability Executor]', error);
  response.status(503).json({
    error: message || 'A execução da disponibilidade 99Food está temporariamente indisponível.',
  });
};

export const createNinetyNineFoodAvailabilityExecutorRouter = (): Router => {
  const router = Router();

  router.post('/availability-authorizations/:authorizationId/execute', async (request, response) => {
    try {
      const tenantId = await authenticatedTenantId(request);
      const authorizationToken = typeof request.body?.authorizationToken === 'string'
        ? request.body.authorizationToken
        : '';
      response.json(await executeNinetyNineFoodAvailability({
        tenantId,
        authorizationId: request.params.authorizationId,
        authorizationToken,
        attemptedByUserId: tenantId,
      }));
    } catch (error) {
      errorResponse(response, error);
    }
  });

  router.post('/availability-executions/:executionId/reconcile', async (request, response) => {
    try {
      const tenantId = await authenticatedTenantId(request);
      response.json(await reconcileNinetyNineFoodAvailability({
        tenantId,
        executionId: request.params.executionId,
        requestedByUserId: tenantId,
      }));
    } catch (error) {
      errorResponse(response, error);
    }
  });

  return router;
};
