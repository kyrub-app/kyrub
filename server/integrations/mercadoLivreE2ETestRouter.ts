import { Router } from 'express';
import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';
import {
  inspectMercadoLivreE2ECategoryOptions,
  listMercadoLivreE2EEligibleProducts,
} from './mercadoLivreE2ETestService.js';
import { inspectMercadoLivrePublicationCapability } from './mercadoLivrePublicationCapabilityService.js';

const clean = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const bearerToken = (authorization: string): string => /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim() ?? '';

const authenticatedOwner = async (authorization: string, storeId: string) => {
  const token = bearerToken(authorization);
  if (!token) throw new Error('AUTH_REQUIRED');
  const identity = await verifyFirebaseIdToken(token);
  if (identity.uid !== storeId) throw new Error('STORE_CONNECTION_FORBIDDEN');
  return identity;
};

const errorCode = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).split(':')[0].slice(0, 100);

const statusFor = (code: string): number => {
  if (code === 'AUTH_REQUIRED') return 401;
  if (
    code === 'STORE_CONNECTION_FORBIDDEN' ||
    code === 'MERCADO_LIVRE_E2E_FORBIDDEN' ||
    code === 'MERCADO_LIVRE_PUBLICATION_CAPABILITY_FORBIDDEN'
  ) return 403;
  if (code.includes('NOT_FOUND')) return 404;
  if (
    code.includes('REQUIRED') ||
    code.includes('INVALID') ||
    code.includes('MISMATCH') ||
    code.includes('INCONSISTENT') ||
    code.includes('NOT_PREDICTED') ||
    code.includes('NOT_LISTABLE')
  ) return 409;
  return 503;
};

export const createMercadoLivreE2ETestRouter = (): Router => {
  const router = Router();

  router.get('/:storeId/e2e/publication-capability', async (request, response) => {
    try {
      const storeId = clean(request.params.storeId);
      const identity = await authenticatedOwner(request.get('authorization') ?? '', storeId);
      response.setHeader('Cache-Control', 'no-store, max-age=0');
      response.json(await inspectMercadoLivrePublicationCapability({
        storeId,
        connectionId: clean(request.query.connectionId),
        requestedByUserId: identity.uid,
      }));
    } catch (error) {
      const code = errorCode(error);
      response.status(statusFor(code)).json({
        error: 'Não foi possível confirmar o modelo de publicação da conta Mercado Livre.',
        code,
      });
    }
  });

  router.get('/:storeId/e2e/eligible-products', async (request, response) => {
    try {
      const storeId = clean(request.params.storeId);
      const identity = await authenticatedOwner(request.get('authorization') ?? '', storeId);
      response.setHeader('Cache-Control', 'no-store, max-age=0');
      response.json(await listMercadoLivreE2EEligibleProducts({ storeId, requestedByUserId: identity.uid }));
    } catch (error) {
      const code = errorCode(error);
      response.status(statusFor(code)).json({ error: 'Não foi possível preparar os produtos para o teste.', code });
    }
  });

  router.post('/:storeId/e2e/outbound-publication-proposals/:proposalId/category-options', async (request, response) => {
    try {
      const storeId = clean(request.params.storeId);
      const identity = await authenticatedOwner(request.get('authorization') ?? '', storeId);
      response.setHeader('Cache-Control', 'no-store, max-age=0');
      response.json(await inspectMercadoLivreE2ECategoryOptions({
        storeId,
        proposalId: clean(request.params.proposalId),
        categoryId: clean(request.body?.categoryId),
        requestedByUserId: identity.uid,
      }));
    } catch (error) {
      const code = errorCode(error);
      response.status(statusFor(code)).json({ error: 'Não foi possível consultar as opções oficiais da categoria.', code });
    }
  });

  return router;
};
