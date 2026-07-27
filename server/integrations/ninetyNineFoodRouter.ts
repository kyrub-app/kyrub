import { Router, type Request, type Response } from 'express';
import { adminAuth } from '../firebaseAdmin';
import {
  connectNinetyNineFood,
  disconnectNinetyNineFood,
  getNinetyNineFoodStatus,
  pollAllNinetyNineFoodConnections,
  pollNinetyNineFood,
  sendNinetyNineFoodOrderStatus,
  type NinetyNineFoodConnectInput,
} from './ninetyNineFoodService';
import {
  drainNinetyNineFoodIngressQueue,
  enqueueNinetyNineFoodWebhook,
} from './ninetyNineFoodIngressQueue';
import type { NormalizedIntegrationOrder } from './openDelivery';

export interface RawBodyRequest extends Request {
  rawBody?: Buffer;
}

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

const publicAppUrl = (request: Request): string => {
  const configured = process.env.PUBLIC_APP_URL?.trim();
  if (configured) return configured;
  return `${request.protocol}://${request.get('host') ?? 'localhost:3000'}`;
};

const errorResponse = (response: Response, error: unknown): void => {
  const message = error instanceof Error ? error.message : String(error);
  if (message === 'AUTH_REQUIRED') {
    response.status(401).json({ error: 'Faça login novamente.' });
    return;
  }
  if (/id-token|token has expired|revoked/i.test(message)) {
    response.status(401).json({ error: 'Sua sessão expirou. Entre novamente.' });
    return;
  }
  if (/assinatura HMAC/i.test(message)) {
    response.status(403).json({ error: message });
    return;
  }
  if (/não está vinculado|não está configurada|não encontrado/i.test(message)) {
    response.status(404).json({ error: message });
    return;
  }
  if (/inválid|informe|HTTPS|excede|incompleto/i.test(message)) {
    response.status(400).json({ error: message });
    return;
  }
  console.error('[99Food Integration]', error);
  response.status(503).json({
    error: message || 'A integração 99Food está temporariamente indisponível.',
  });
};

const parseConnectInput = (value: unknown): NinetyNineFoodConnectInput => {
  const candidate = value && typeof value === 'object'
    ? value as Record<string, unknown>
    : {};
  return {
    externalStoreId: typeof candidate.externalStoreId === 'string'
      ? candidate.externalStoreId
      : '',
    accountLabel: typeof candidate.accountLabel === 'string'
      ? candidate.accountLabel
      : '',
    routingTarget: typeof candidate.routingTarget === 'string'
      ? candidate.routingTarget
      : '',
    environment: candidate.environment === 'production'
      ? 'production'
      : 'sandbox',
    baseUrl: typeof candidate.baseUrl === 'string' ? candidate.baseUrl : '',
    tokenUrl: typeof candidate.tokenUrl === 'string' ? candidate.tokenUrl : undefined,
    clientId: typeof candidate.clientId === 'string' ? candidate.clientId : '',
    clientSecret: typeof candidate.clientSecret === 'string'
      ? candidate.clientSecret
      : '',
  };
};

const ORDER_STATUSES = new Set<NormalizedIntegrationOrder['status']>([
  'accepted',
  'preparing',
  'ready',
  'out_for_delivery',
  'completed',
  'rejected',
  'cancelled',
]);

const cronAuthorized = (request: Request): boolean => {
  const configuredSecret = process.env.INTEGRATION_CRON_SECRET?.trim();
  if (!configuredSecret) return false;
  const explicitSecret = request.get('x-cron-secret')?.trim();
  return explicitSecret === configuredSecret || bearerToken(request) === configuredSecret;
};

export const createNinetyNineFoodRouter = (): Router => {
  const router = Router();

  router.get('/status', async (request, response) => {
    try {
      const tenantId = await authenticatedTenantId(request);
      response.json(await getNinetyNineFoodStatus(tenantId));
    } catch (error) {
      errorResponse(response, error);
    }
  });

  router.post('/connect', async (request, response) => {
    try {
      const tenantId = await authenticatedTenantId(request);
      const status = await connectNinetyNineFood(
        tenantId,
        parseConnectInput(request.body),
        publicAppUrl(request)
      );
      response.status(status.status === 'connected' ? 200 : 202).json(status);
    } catch (error) {
      errorResponse(response, error);
    }
  });

  router.delete('/connection', async (request, response) => {
    try {
      const tenantId = await authenticatedTenantId(request);
      await disconnectNinetyNineFood(tenantId);
      response.status(204).end();
    } catch (error) {
      errorResponse(response, error);
    }
  });

  router.post('/poll', async (request, response) => {
    try {
      const tenantId = await authenticatedTenantId(request);
      const ingress = await drainNinetyNineFoodIngressQueue(100);
      const polling = await pollNinetyNineFood(tenantId);
      response.json({ ...polling, ingress });
    } catch (error) {
      errorResponse(response, error);
    }
  });

  router.post('/orders/:externalOrderId/status', async (request, response) => {
    try {
      const tenantId = await authenticatedTenantId(request);
      const status = typeof request.body?.status === 'string'
        ? request.body.status as NormalizedIntegrationOrder['status']
        : 'pending';
      if (!ORDER_STATUSES.has(status)) {
        response.status(400).json({ error: 'Status 99Food não suportado.' });
        return;
      }
      const reason = typeof request.body?.reason === 'string'
        ? request.body.reason
        : '';
      await sendNinetyNineFoodOrderStatus(
        tenantId,
        request.params.externalOrderId,
        status,
        reason
      );
      response.status(204).end();
    } catch (error) {
      errorResponse(response, error);
    }
  });

  const webhookHandler = async (request: RawBodyRequest, response: Response) => {
    try {
      if (!request.rawBody) {
        response.status(400).json({ error: 'Corpo bruto do webhook indisponível.' });
        return;
      }
      const result = await enqueueNinetyNineFoodWebhook({
        externalStoreId: request.get('x-app-merchantid')?.trim() ?? '',
        signature: request.get('x-app-signature')?.trim() ?? '',
        rawBody: request.rawBody,
        payload: request.body,
      });
      response.setHeader(
        'x-kyrub-idempotent',
        result.duplicate ? 'duplicate' : 'queued'
      );
      response.status(200).end();
    } catch (error) {
      errorResponse(response, error);
    }
  };

  router.post('/webhook', webhookHandler);
  router.post('/v1/newEvent', webhookHandler);
  router.post('/v1/orderUpdate', webhookHandler);

  const drainHandler = async (request: Request, response: Response) => {
    if (!cronAuthorized(request)) {
      response.status(401).json({ error: 'Cron não autorizado.' });
      return;
    }
    try {
      response.json(await drainNinetyNineFoodIngressQueue(250));
    } catch (error) {
      errorResponse(response, error);
    }
  };

  const pollAllHandler = async (request: Request, response: Response) => {
    if (!cronAuthorized(request)) {
      response.status(401).json({ error: 'Cron não autorizado.' });
      return;
    }
    try {
      const ingress = await drainNinetyNineFoodIngressQueue(250);
      const polling = await pollAllNinetyNineFoodConnections();
      response.json({ ingress, polling });
    } catch (error) {
      errorResponse(response, error);
    }
  };

  router.get('/internal/drain', drainHandler);
  router.post('/internal/drain', drainHandler);
  router.get('/internal/poll-all', pollAllHandler);
  router.post('/internal/poll-all', pollAllHandler);

  return router;
};
