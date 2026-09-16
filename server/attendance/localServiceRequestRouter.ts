import { Router, type Response } from 'express';
import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';
import { loadOwnerStoreInstitutionalRepresentation } from '../store/storeInstitutionalIdentityService.js';
import {
  acknowledgeLocalServiceRequest,
  cancelOwnLocalServiceRequest,
  createLocalServiceRequest,
  listActiveLocalServiceRequests,
  resolveLocalServiceRequest,
} from './localServiceRequestService.js';

const clean = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const bearerToken = (authorization: string): string =>
  /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim() ?? '';

const requireIdentity = async (authorization: string) => {
  const token = bearerToken(authorization);
  if (!token) throw new Error('AUTH_REQUIRED');
  return verifyFirebaseIdToken(token);
};

const requireOwner = async (authorization: string, legacyStoreId: string) => {
  const identity = await requireIdentity(authorization);
  return loadOwnerStoreInstitutionalRepresentation({
    storeId: legacyStoreId,
    authenticatedUserId: identity.uid,
  });
};

const mapError = (error: unknown): { status: number; message: string } => {
  const code = error instanceof Error ? error.message : String(error);
  if (code === 'AUTH_REQUIRED' || code === 'LOCAL_SERVICE_REQUEST_AUTH_REQUIRED') {
    return { status: 401, message: 'Faça login novamente para solicitar atendimento.' };
  }
  if (
    code === 'STORE_REPRESENTATION_FORBIDDEN' ||
    code === 'LOCAL_SERVICE_REQUEST_ORDER_FORBIDDEN' ||
    code === 'LOCAL_SERVICE_REQUEST_FORBIDDEN'
  ) {
    return { status: 403, message: 'Esta solicitação não pertence à sua conta.' };
  }
  if (code === 'LOCAL_SERVICE_REQUEST_ORDER_NOT_FOUND' || code === 'LOCAL_SERVICE_REQUEST_NOT_FOUND') {
    return { status: 404, message: 'Pedido ou solicitação de atendimento não encontrado.' };
  }
  if (code === 'LOCAL_SERVICE_REQUEST_ORDER_CLOSED') {
    return { status: 409, message: 'Este pedido já foi encerrado.' };
  }
  if (code === 'LOCAL_SERVICE_REQUEST_NOT_ACTIVE') {
    return { status: 409, message: 'Esta solicitação já foi encerrada.' };
  }
  if (code.startsWith('LOCAL_SERVICE_REQUEST_') || code.startsWith('IN_PERSON_ORDER_')) {
    return { status: 400, message: 'Não foi possível validar a solicitação de atendimento.' };
  }
  console.error('[Local service request]', error);
  return { status: 503, message: 'O atendimento está temporariamente indisponível.' };
};

const sendError = (response: Response, error: unknown): void => {
  const mapped = mapError(error);
  response.status(mapped.status).json({ error: mapped.message });
};

export const createLocalServiceRequestRouter = (): Router => {
  const router = Router();

  router.post('/', async (request, response) => {
    try {
      const identity = await requireIdentity(request.get('authorization') ?? '');
      response.status(201).json({
        request: await createLocalServiceRequest({
          authenticatedUserId: identity.uid,
          value: request.body,
        }),
      });
    } catch (error) {
      sendError(response, error);
    }
  });

  router.get('/', async (request, response) => {
    try {
      const storeId = clean(request.query.storeId);
      if (!storeId) throw new Error('LOCAL_SERVICE_REQUEST_STORE_REQUIRED');
      await requireOwner(request.get('authorization') ?? '', storeId);
      response.status(200).json({
        requests: await listActiveLocalServiceRequests({ legacyStoreId: storeId }),
      });
    } catch (error) {
      sendError(response, error);
    }
  });

  router.post('/:requestId/acknowledge', async (request, response) => {
    try {
      const storeId = clean(request.body?.storeId);
      if (!storeId) throw new Error('LOCAL_SERVICE_REQUEST_STORE_REQUIRED');
      const representation = await requireOwner(request.get('authorization') ?? '', storeId);
      response.status(200).json({
        request: await acknowledgeLocalServiceRequest({
          legacyStoreId: storeId,
          requestId: clean(request.params.requestId),
          actorUserId: representation.authenticatedUserId,
        }),
      });
    } catch (error) {
      sendError(response, error);
    }
  });

  router.post('/:requestId/resolve', async (request, response) => {
    try {
      const storeId = clean(request.body?.storeId);
      if (!storeId) throw new Error('LOCAL_SERVICE_REQUEST_STORE_REQUIRED');
      const representation = await requireOwner(request.get('authorization') ?? '', storeId);
      response.status(200).json({
        request: await resolveLocalServiceRequest({
          legacyStoreId: storeId,
          requestId: clean(request.params.requestId),
          actorUserId: representation.authenticatedUserId,
        }),
      });
    } catch (error) {
      sendError(response, error);
    }
  });

  router.post('/:requestId/cancel', async (request, response) => {
    try {
      const identity = await requireIdentity(request.get('authorization') ?? '');
      response.status(200).json({
        request: await cancelOwnLocalServiceRequest({
          authenticatedUserId: identity.uid,
          legacyStoreId: clean(request.body?.storeId),
          requestId: clean(request.params.requestId),
        }),
      });
    } catch (error) {
      sendError(response, error);
    }
  });

  return router;
};
