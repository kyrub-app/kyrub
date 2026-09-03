import { Router, type Request, type Response } from 'express';
import { adminAuth } from '../firebaseAdmin';
import {
  reconcileConnectedNinetyNineFoodOrdersUpdatedSince,
  reconcileTenantOrdersUpdatedSince,
} from '../inventory/recentOrderInventorySweep';
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
  bindNinetyNineFoodProduct,
  deactivateNinetyNineFoodProductBinding,
  listNinetyNineFoodProductBindings,
} from './ninetyNineFoodProductBindingService';
import {
  listNinetyNineFoodBlockedOrders,
  preflightNinetyNineFoodBlockedOrderReservation,
  rejectNinetyNineFoodBlockedOrder,
  retryNinetyNineFoodBlockedOrderReservation,
} from './ninetyNineFoodOrderBlockResolutionService';
import { createNinetyNineFoodAvailabilityProposalRouter } from './ninetyNineFoodAvailabilityProposalRouter';
import { createNinetyNineFoodMenuCapabilityRouter } from './ninetyNineFoodMenuCapabilityRouter';
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
  if (/PRODUCT_BINDING_FORBIDDEN|NINETY_NINE_FOOD_BLOCK_FORBIDDEN/.test(message)) {
    response.status(403).json({ error: message });
    return;
  }
  if (/PRODUCT_BINDING_NOT_FOUND|PRODUCT_BINDING_CANONICAL_PRODUCT_NOT_FOUND|PRODUCT_BINDING_CONNECTION_REQUIRED|NINETY_NINE_FOOD_BLOCK_ORDER_NOT_FOUND/.test(message)) {
    response.status(404).json({ error: message });
    return;
  }
  if (/PRODUCT_BINDING_ALREADY_ACTIVE|PRODUCT_BINDING_CONFLICT|NINETY_NINE_FOOD_BLOCK_ORDER_NOT_BLOCKED|NINETY_NINE_FOOD_BLOCK_REJECTION_ALREADY_RESERVED/.test(message)) {
    response.status(409).json({ error: message });
    return;
  }
  if (/não está vinculado|não está configurada|não encontrado/i.test(message)) {
    response.status(404).json({ error: message });
    return;
  }
  if (/PRODUCT_BINDING_INPUT_INVALID|PRODUCT_BINDING_CANONICAL_PRODUCT_INVALID|PRODUCT_BINDING_CANONICAL_STORE_REQUIRED|PRODUCT_BINDING_CONNECTION_INVALID|NINETY_NINE_FOOD_BLOCK_INPUT_INVALID|NINETY_NINE_FOOD_BLOCK_CANONICAL_STORE_REQUIRED|NINETY_NINE_FOOD_BLOCK_EXTERNAL_ORDER_REQUIRED|NINETY_NINE_FOOD_BLOCK_SOURCE_MISMATCH/.test(message)) {
    response.status(400).json({ error: message });
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
  router.use(createNinetyNineFoodAvailabilityProposalRouter());
  router.use(createNinetyNineFoodMenuCapabilityRouter());

  router.get('/status', async (request, response) => {
    try {
      const tenantId = await authenticatedTenantId(request);
      response.json(await getNinetyNineFoodStatus(tenantId));
    } catch (error) {
      errorResponse(response, error);
    }
  });

  router.get('/product-bindings', async (request, response) => {
    try {
      const tenantId = await authenticatedTenantId(request);
      response.json(await listNinetyNineFoodProductBindings({
        tenantId,
        requestedByUserId: tenantId,
      }));
    } catch (error) {
      errorResponse(response, error);
    }
  });

  router.put('/product-bindings/:externalProductId', async (request, response) => {
    try {
      const tenantId = await authenticatedTenantId(request);
      const canonicalProductId = typeof request.body?.canonicalProductId === 'string'
        ? request.body.canonicalProductId
        : '';
      const result = await bindNinetyNineFoodProduct({
        tenantId,
        externalProductId: request.params.externalProductId,
        canonicalProductId,
        boundByUserId: tenantId,
      });
      response.status(result.alreadyBound ? 200 : 201).json(result);
    } catch (error) {
      errorResponse(response, error);
    }
  });

  router.delete('/product-bindings/:externalProductId', async (request, response) => {
    try {
      const tenantId = await authenticatedTenantId(request);
      response.json(await deactivateNinetyNineFoodProductBinding({
        tenantId,
        externalProductId: request.params.externalProductId,
        deactivatedByUserId: tenantId,
      }));
    } catch (error) {
      errorResponse(response, error);
    }
  });

  router.get('/blocked-orders', async (request, response) => {
    try {
      const tenantId = await authenticatedTenantId(request);
      response.json(await listNinetyNineFoodBlockedOrders({
        tenantId,
        requestedByUserId: tenantId,
      }));
    } catch (error) {
      errorResponse(response, error);
    }
  });

  router.get('/blocked-orders/:orderId/preflight', async (request, response) => {
    try {
      const tenantId = await authenticatedTenantId(request);
      response.json(await preflightNinetyNineFoodBlockedOrderReservation({
        tenantId,
        orderId: request.params.orderId,
        requestedByUserId: tenantId,
      }));
    } catch (error) {
      errorResponse(response, error);
    }
  });

  router.post('/blocked-orders/:orderId/retry-reservation', async (request, response) => {
    try {
      const tenantId = await authenticatedTenantId(request);
      response.json(await retryNinetyNineFoodBlockedOrderReservation({
        tenantId,
        orderId: request.params.orderId,
        requestedByUserId: tenantId,
      }));
    } catch (error) {
      errorResponse(response, error);
    }
  });

  router.post('/blocked-orders/:orderId/reject', async (request, response) => {
    try {
      const tenantId = await authenticatedTenantId(request);
      const reason = typeof request.body?.reason === 'string' ? request.body.reason : '';
      const result = await rejectNinetyNineFoodBlockedOrder({
        tenantId,
        orderId: request.params.orderId,
        reason,
        requestedByUserId: tenantId,
      });
      response.status(result.status === 'provider_write_succeeded' ? 200 : 202).json(result);
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
      const startedAt = Date.now() - 5_000;
      const ingress = await drainNinetyNineFoodIngressQueue(100);
      const polling = await pollNinetyNineFood(tenantId);
      const inventory = await reconcileTenantOrdersUpdatedSince(
        tenantId,
        startedAt
      );
      response.json({ ...polling, ingress, inventory });
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
      const startedAt = Date.now() - 5_000;
      const ingress = await drainNinetyNineFoodIngressQueue(250);
      const polling = await pollAllNinetyNineFoodConnections();
      const inventory =
        await reconcileConnectedNinetyNineFoodOrdersUpdatedSince(startedAt);
      response.json({ ingress, polling, inventory });
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
