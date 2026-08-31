import { Router, type Request, type Response } from 'express';
import { adminAuth } from '../firebaseAdmin.js';
import {
  createChannelAvailabilitySnapshot,
  setChannelAvailabilityPolicy,
} from './channelAvailabilityPolicyService.js';
import type { CommerceChannel } from '../../shared/channelAvailabilityFiscalFoundation.js';

const bearerToken = (request: Request): string => {
  const authorization = request.get('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  return match?.[1]?.trim() ?? '';
};

const authenticatedUserId = async (request: Request): Promise<string> => {
  const token = bearerToken(request);
  if (!token) throw new Error('AUTH_REQUIRED');
  const decoded = await adminAuth.verifyIdToken(token, true);
  return decoded.uid;
};

const channelFrom = (value: unknown): CommerceChannel =>
  typeof value === 'string' ? value.trim() as CommerceChannel : 'other';

const errorResponse = (response: Response, error: unknown): void => {
  const message = error instanceof Error ? error.message : String(error);
  if (message === 'AUTH_REQUIRED') {
    response.status(401).json({ error: 'Faça login novamente.' });
    return;
  }
  if (/OWNER_REQUIRED|OWNER_UNRESOLVED/i.test(message)) {
    response.status(403).json({ error: message });
    return;
  }
  if (/REQUIRED|INVALID|UNSUPPORTED|NOT_FOUND|COMPOSITION/i.test(message)) {
    response.status(400).json({ error: message });
    return;
  }
  console.error('[Channel Availability]', error);
  response.status(503).json({ error: message || 'Disponibilidade temporariamente indisponível.' });
};

export const createChannelAvailabilityPolicyRouter = (): Router => {
  const router = Router();

  router.put('/:storeId/policies/:channel', async (request, response) => {
    try {
      const userId = await authenticatedUserId(request);
      const result = await setChannelAvailabilityPolicy({
        storeId: request.params.storeId,
        channel: channelFrom(request.params.channel),
        enabled: request.body?.enabled,
        safetyStockUnits: request.body?.safetyStockUnits,
        allocationCapUnits: request.body?.allocationCapUnits ?? null,
        configuredByUserId: userId,
      });
      response.json(result);
    } catch (error) {
      errorResponse(response, error);
    }
  });

  router.post('/:storeId/products/:productId/snapshots/:channel', async (request, response) => {
    try {
      const userId = await authenticatedUserId(request);
      const result = await createChannelAvailabilitySnapshot({
        storeId: request.params.storeId,
        productId: request.params.productId,
        channel: channelFrom(request.params.channel),
        requestedByUserId: userId,
      });
      response.status(result.alreadyExisted ? 200 : 201).json(result);
    } catch (error) {
      errorResponse(response, error);
    }
  });

  return router;
};
