import { Router } from 'express';
import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';
import {
  MARKETPLACE_DISCOVERY_STORE_LIMIT,
  loadMarketplaceDiscovery,
} from './marketplaceDiscoveryService.js';

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const bearerToken = (authorization: string): string =>
  /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim() ?? '';

const parseStoreIds = (value: unknown): string[] => {
  const values = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : [];
  const storeIds = Array.from(new Set(values.map(clean).filter(Boolean)));
  if (storeIds.length > MARKETPLACE_DISCOVERY_STORE_LIMIT) {
    throw new Error('MARKETPLACE_DISCOVERY_STORE_LIMIT');
  }
  return storeIds;
};

const mapError = (error: unknown): { status: number; message: string } => {
  const message = error instanceof Error ? error.message : String(error);
  if (message === 'AUTH_REQUIRED') {
    return { status: 401, message: 'Faça login novamente para personalizar o marketplace.' };
  }
  if (message === 'MARKETPLACE_DISCOVERY_STORE_LIMIT') {
    return { status: 400, message: 'Muitas lojas foram solicitadas de uma só vez.' };
  }
  if (message.startsWith('MARKETPLACE_DISCOVERY_')) {
    console.warn('[Marketplace discovery]', message);
    return { status: 409, message: 'Não foi possível calcular a descoberta personalizada.' };
  }
  console.error('[Marketplace discovery]', error);
  return { status: 503, message: 'A personalização do marketplace está temporariamente indisponível.' };
};

export const createMarketplaceDiscoveryRouter = (): Router => {
  const router = Router();

  router.post('/', async (request, response) => {
    try {
      const token = bearerToken(request.get('authorization') ?? '');
      if (!token) throw new Error('AUTH_REQUIRED');
      const identity = await verifyFirebaseIdToken(token);
      const body = request.body && typeof request.body === 'object'
        ? request.body as Record<string, unknown>
        : {};
      const storeIds = parseStoreIds(body.storeIds);
      const result = await loadMarketplaceDiscovery({
        storeIds,
        customerId: identity.uid,
      });
      response.status(200).json(result);
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message });
    }
  });

  return router;
};
