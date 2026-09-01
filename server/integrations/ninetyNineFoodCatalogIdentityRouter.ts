import { Router, type Request, type Response } from 'express';
import { adminAuth } from '../firebaseAdmin';
import {
  getCurrentNinetyNineFoodCatalogIdentity,
  resolveNinetyNineFoodCatalogIdentity,
} from './ninetyNineFoodCatalogIdentityService';

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
  if (/FORBIDDEN/.test(message)) {
    response.status(403).json({ error: message });
    return;
  }
  if (/REQUIRED|NOT_FOUND/.test(message)) {
    response.status(404).json({ error: message });
    return;
  }
  if (/STALE|MISMATCH|AMBIGUOUS/.test(message)) {
    response.status(409).json({ error: message });
    return;
  }
  if (/INPUT_INVALID|CONTEXT_INVALID|CONNECTION_INVALID|RESPONSE_INVALID|ENDPOINT_INVALID/.test(message)) {
    response.status(400).json({ error: message });
    return;
  }
  if (/AUTHORIZATION_FLOW_REQUIRED|MERCHANT_GET_UNAVAILABLE/.test(message)) {
    response.status(422).json({ error: message });
    return;
  }
  console.error('[99Food Catalog Identity]', error);
  response.status(503).json({ error: message || 'A identidade de catálogo 99Food está temporariamente indisponível.' });
};

export const createNinetyNineFoodCatalogIdentityRouter = (): Router => {
  const router = Router();

  router.get('/product-bindings/:externalProductId/catalog-identity', async (request, response) => {
    try {
      const tenantId = await authenticatedTenantId(request);
      response.json(await getCurrentNinetyNineFoodCatalogIdentity({
        tenantId,
        externalProductId: request.params.externalProductId,
        requestedByUserId: tenantId,
      }));
    } catch (error) {
      errorResponse(response, error);
    }
  });

  router.post('/product-bindings/:externalProductId/catalog-identity/resolve', async (request, response) => {
    try {
      const tenantId = await authenticatedTenantId(request);
      const result = await resolveNinetyNineFoodCatalogIdentity({
        tenantId,
        externalProductId: request.params.externalProductId,
        requestedByUserId: tenantId,
      });
      response.status(result.status === 'resolved' ? 200 : 202).json(result);
    } catch (error) {
      errorResponse(response, error);
    }
  });

  return router;
};
