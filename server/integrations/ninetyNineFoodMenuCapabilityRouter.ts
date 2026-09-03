import { Router, type Request, type Response } from 'express';
import { adminAuth } from '../firebaseAdmin';
import {
  discoverNinetyNineFoodMenuCapability,
  getCurrentNinetyNineFoodMenuCapability,
} from './ninetyNineFoodMenuCapabilityService';

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
    response.status(401).json({ error: message === 'AUTH_REQUIRED' ? 'Faça login novamente.' : 'Sua sessão expirou. Entre novamente.' });
    return;
  }
  if (/FORBIDDEN/.test(message)) {
    response.status(403).json({ error: message });
    return;
  }
  if (/CONNECTION_REQUIRED/.test(message)) {
    response.status(404).json({ error: message });
    return;
  }
  if (/CONNECTION_STALE/.test(message)) {
    response.status(409).json({ error: message });
    return;
  }
  if (/BASE_URL_INVALID|CONNECTION_INVALID|RESPONSE_INVALID|STATE_INVALID/.test(message)) {
    response.status(400).json({ error: message });
    return;
  }
  if (/DISCOVERY_HTTP_/.test(message)) {
    response.status(502).json({ error: message });
    return;
  }
  console.error('[99Food Menu Capability Discovery]', error);
  response.status(503).json({
    error: message || 'A descoberta de capability de Menu da 99Food está temporariamente indisponível.',
  });
};

export const createNinetyNineFoodMenuCapabilityRouter = (): Router => {
  const router = Router();

  router.get('/capabilities/menu', async (request, response) => {
    try {
      const tenantId = await authenticatedTenantId(request);
      response.json({
        capability: await getCurrentNinetyNineFoodMenuCapability({
          tenantId,
          requestedByUserId: tenantId,
        }),
      });
    } catch (error) {
      errorResponse(response, error);
    }
  });

  router.post('/capabilities/menu/discover', async (request, response) => {
    try {
      const tenantId = await authenticatedTenantId(request);
      response.json({
        capability: await discoverNinetyNineFoodMenuCapability({
          tenantId,
          requestedByUserId: tenantId,
        }),
      });
    } catch (error) {
      errorResponse(response, error);
    }
  });

  return router;
};
