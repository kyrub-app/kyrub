import { Router } from 'express';
import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';
import {
  reconcilePersistedCustomerOrdersIntoCrm,
  syncCanonicalOrderCustomerIntoCrm,
} from './storeCrmOrderSyncService.js';
import { loadStoreCrmSummary } from './storeCrmService.js';

const clean = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const bearerToken = (authorization: string): string => /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim() ?? '';

const syncErrorStatus = (error: unknown): number => {
  const code = error instanceof Error ? error.message : '';
  if (code === 'STORE_CRM_ORDER_BUYER_FORBIDDEN' || code === 'STORE_CRM_ORDER_SOURCE_FORBIDDEN') return 403;
  if (code === 'STORE_CRM_ORDER_NOT_FOUND') return 404;
  if (
    code === 'STORE_CRM_STORE_REQUIRED' ||
    code === 'STORE_CRM_ORDER_REQUIRED' ||
    code === 'STORE_CRM_BUYER_REQUIRED' ||
    code === 'STORE_CRM_ORDER_INVALID' ||
    code === 'STORE_CRM_NOW_INVALID'
  ) return 400;
  return 503;
};

export const createStoreCrmRouter = (): Router => {
  const router = Router();

  router.get('/', async (request, response) => {
    try {
      const token = bearerToken(request.get('authorization') ?? '');
      if (!token) return response.status(401).json({ error: 'Faça login novamente para acessar o CRM.' });
      const identity = await verifyFirebaseIdToken(token);
      const storeId = clean(request.query.storeId);
      if (!storeId) return response.status(400).json({ error: 'Loja não identificada.' });
      if (identity.uid !== storeId) {
        return response.status(403).json({ error: 'Apenas o proprietário pode consultar este CRM nesta versão.' });
      }

      await reconcilePersistedCustomerOrdersIntoCrm({ storeId });
      response.status(200).json(await loadStoreCrmSummary({ storeId }));
    } catch (error) {
      console.error('[Store CRM]', error);
      response.status(503).json({ error: 'Não foi possível carregar o CRM da loja.' });
    }
  });

  router.post('/', async (request, response) => {
    try {
      const token = bearerToken(request.get('authorization') ?? '');
      if (!token) return response.status(401).json({ error: 'Faça login novamente para sincronizar o pedido.' });
      const identity = await verifyFirebaseIdToken(token);
      const storeId = clean(request.body?.storeId);
      const orderId = clean(request.body?.orderId);
      if (!storeId) return response.status(400).json({ error: 'Loja não identificada.' });
      if (!orderId) return response.status(400).json({ error: 'Pedido não identificado.' });

      const result = await syncCanonicalOrderCustomerIntoCrm({
        storeId,
        orderId,
        authenticatedBuyerId: identity.uid,
      });
      response.status(200).json({ ok: true, ...result });
    } catch (error) {
      console.error('[Store CRM sync]', error);
      response.status(syncErrorStatus(error)).json({
        error: 'Não foi possível sincronizar este pedido com o CRM.',
        code: error instanceof Error ? error.message : 'STORE_CRM_SYNC_REJECTED',
      });
    }
  });

  return router;
};
