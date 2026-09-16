import { Router } from 'express';
import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';
import { loadOwnerStoreInstitutionalRepresentation } from '../store/storeInstitutionalIdentityService.js';
import {
  linkInPersonOrderCustomer,
  loadInPersonCustomerContext,
  searchInPersonCustomerCandidates,
} from './inPersonCustomerIdentityService.js';

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const bearerToken = (authorization: string): string =>
  /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim() ?? '';

const authorizeOwnerStore = async (input: {
  authorization: string;
  storeId: string;
}) => {
  const token = bearerToken(input.authorization);
  if (!token) throw new Error('AUTH_REQUIRED');
  const identity = await verifyFirebaseIdToken(token);
  return loadOwnerStoreInstitutionalRepresentation({
    storeId: input.storeId,
    authenticatedUserId: identity.uid,
  });
};

const mapError = (error: unknown): { status: number; message: string; code?: string } => {
  const code = error instanceof Error ? error.message : String(error);
  if (code === 'AUTH_REQUIRED') {
    return { status: 401, message: 'Faça login novamente para identificar o cliente.' };
  }
  if (
    code === 'STORE_REPRESENTATION_FORBIDDEN' ||
    code === 'IN_PERSON_CUSTOMER_FORBIDDEN'
  ) {
    return { status: 403, message: 'Você não pode identificar clientes desta loja.' };
  }
  if (
    code === 'IN_PERSON_CUSTOMER_ORDER_NOT_FOUND' ||
    code === 'IN_PERSON_CUSTOMER_CANONICAL_ORDER_NOT_FOUND'
  ) {
    return { status: 404, message: 'Pedido presencial não encontrado.', code };
  }
  if (code === 'IN_PERSON_CUSTOMER_REF_NOT_FOUND') {
    return { status: 404, message: 'A confirmação do cliente expirou. Pesquise novamente.', code };
  }
  if (
    code === 'IN_PERSON_CUSTOMER_ORDER_CLOSED' ||
    code === 'IN_PERSON_CUSTOMER_ALREADY_LINKED' ||
    code === 'IN_PERSON_CUSTOMER_REF_INVALID' ||
    code === 'IN_PERSON_CUSTOMER_IDENTITY_NOT_APPROVED'
  ) {
    return {
      status: 409,
      message:
        code === 'IN_PERSON_CUSTOMER_ALREADY_LINKED'
          ? 'Este pedido já está vinculado a outro cliente.'
          : code === 'IN_PERSON_CUSTOMER_ORDER_CLOSED'
            ? 'Pedido cancelado ou recusado não pode receber vínculo de cliente.'
            : 'A confirmação do cliente não é mais válida. Pesquise e confirme novamente.',
      code,
    };
  }
  if (code === 'IN_PERSON_CUSTOMER_LINK_TARGET_NOT_FOUND') {
    return { status: 404, message: 'A conta Cairuvi selecionada não está mais disponível.', code };
  }
  if (
    code.startsWith('IN_PERSON_CUSTOMER_') ||
    code.startsWith('IN_PERSON_ORDER_') ||
    code.startsWith('STORE_INSTITUTIONAL_') ||
    code.startsWith('STORE_REPRESENTATION_')
  ) {
    return { status: 400, message: 'Revise os dados usados para identificar o cliente.', code };
  }
  console.error('[In-person customer identity]', error);
  return { status: 503, message: 'A identificação do cliente está temporariamente indisponível.' };
};

const sendError = (response: Parameters<Router['use']>[0] extends never ? never : any, error: unknown): void => {
  const mapped = mapError(error);
  response.status(mapped.status).json({
    error: mapped.message,
    ...(mapped.code ? { code: mapped.code } : {}),
  });
};

export const createInPersonCustomerIdentityRouter = (): Router => {
  const router = Router();

  router.post('/search', async (request, response) => {
    try {
      const storeId = clean(request.body?.storeId);
      if (!storeId) throw new Error('IN_PERSON_CUSTOMER_LOOKUP_SCOPE_REQUIRED');
      const representation = await authorizeOwnerStore({
        authorization: request.get('authorization') ?? '',
        storeId,
      });
      response.status(200).json(
        await searchInPersonCustomerCandidates({
          authenticatedUserId: representation.authenticatedUserId,
          value: request.body,
        })
      );
    } catch (error) {
      sendError(response, error);
    }
  });

  router.get('/context', async (request, response) => {
    try {
      const storeId = clean(request.query.storeId);
      const orderId = clean(request.query.orderId);
      if (!storeId || !orderId) throw new Error('IN_PERSON_CUSTOMER_LOOKUP_SCOPE_REQUIRED');
      const representation = await authorizeOwnerStore({
        authorization: request.get('authorization') ?? '',
        storeId,
      });
      response.status(200).json({
        context: await loadInPersonCustomerContext({
          authenticatedUserId: representation.authenticatedUserId,
          storeId,
          orderId,
        }),
      });
    } catch (error) {
      sendError(response, error);
    }
  });

  router.post('/link', async (request, response) => {
    try {
      const storeId = clean(request.body?.storeId);
      if (!storeId) throw new Error('IN_PERSON_CUSTOMER_LINK_REQUIRED');
      const representation = await authorizeOwnerStore({
        authorization: request.get('authorization') ?? '',
        storeId,
      });
      response.status(200).json({
        context: await linkInPersonOrderCustomer({
          authenticatedUserId: representation.authenticatedUserId,
          value: request.body,
        }),
      });
    } catch (error) {
      sendError(response, error);
    }
  });

  return router;
};
