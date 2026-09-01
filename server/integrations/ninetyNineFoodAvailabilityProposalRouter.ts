import { Router, type Request, type Response } from 'express';
import { adminAuth } from '../firebaseAdmin';
import {
  createNinetyNineFoodAvailabilityProposal,
  listNinetyNineFoodAvailabilityProposals,
} from './ninetyNineFoodAvailabilityProposalService';

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
  if (/NOT_FOUND|ACTIVE_BINDING_REQUIRED/.test(message)) {
    response.status(404).json({ error: message });
    return;
  }
  if (/CONFLICT/.test(message)) {
    response.status(409).json({ error: message });
    return;
  }
  if (/INPUT_INVALID|SNAPSHOT_INVALID|CANONICAL_STORE_REQUIRED/.test(message)) {
    response.status(400).json({ error: message });
    return;
  }
  console.error('[99Food Availability Proposal]', error);
  response.status(503).json({ error: message || 'A proposta de disponibilidade 99Food está temporariamente indisponível.' });
};

export const createNinetyNineFoodAvailabilityProposalRouter = (): Router => {
  const router = Router();

  router.get('/availability-proposals', async (request, response) => {
    try {
      const tenantId = await authenticatedTenantId(request);
      response.json(await listNinetyNineFoodAvailabilityProposals({
        tenantId,
        requestedByUserId: tenantId,
      }));
    } catch (error) {
      errorResponse(response, error);
    }
  });

  router.post('/product-bindings/:externalProductId/availability-proposals', async (request, response) => {
    try {
      const tenantId = await authenticatedTenantId(request);
      const channelAvailabilitySnapshotId = typeof request.body?.channelAvailabilitySnapshotId === 'string'
        ? request.body.channelAvailabilitySnapshotId
        : '';
      const result = await createNinetyNineFoodAvailabilityProposal({
        tenantId,
        externalProductId: request.params.externalProductId,
        channelAvailabilitySnapshotId,
        proposedByUserId: tenantId,
      });
      response.status(result.alreadyExisted ? 200 : 201).json(result);
    } catch (error) {
      errorResponse(response, error);
    }
  });

  return router;
};
