import { Router } from 'express';
import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';
import {
  loadStoreConnectionOnboarding,
  saveStoreCommerceChannelDeclaration,
} from './storeConnectionOnboardingService.js';
import { updateStoreConnectionSyncAuthority } from './storeConnectionRegistry.js';
import { loadStoreInventoryAuthorityHealth } from './storeInventoryAuthorityHealthService.js';

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const bearerToken = (authorization: string): string =>
  /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim() ?? '';

const authenticatedOwner = async (authorization: string, storeId: string) => {
  const token = bearerToken(authorization);
  if (!token) throw new Error('AUTH_REQUIRED');
  const identity = await verifyFirebaseIdToken(token);
  if (identity.uid !== storeId) throw new Error('STORE_CONNECTION_FORBIDDEN');
  return identity;
};

const mapError = (error: unknown): { status: number; message: string } => {
  const message = error instanceof Error ? error.message : String(error);
  if (message === 'AUTH_REQUIRED') return { status: 401, message: 'Faça login novamente.' };
  if (
    message === 'STORE_CONNECTION_FORBIDDEN' ||
    message === 'STORE_REPRESENTATION_FORBIDDEN' ||
    message === 'STORE_INVENTORY_AUTHORITY_FORBIDDEN'
  ) {
    return { status: 403, message: 'Você não pode administrar conexões desta loja.' };
  }
  if (message === 'STORE_INSTITUTIONAL_NOT_FOUND' || message === 'STORE_CONNECTION_NOT_FOUND') {
    return { status: 404, message: 'A loja ou conexão ainda não foi encontrada.' };
  }
  if (message === 'STORE_CONNECTION_SYNC_AUTHORITY_UNAVAILABLE') {
    return {
      status: 409,
      message: 'A sincronização automática deste canal ainda não está habilitada. Use revisão manual por enquanto.',
    };
  }
  if (
    message.includes('TARGET_REQUIRED') ||
    message.includes('SCOPE_INVALID') ||
    message === 'STORE_CONNECTION_SYNC_AUTHORITY_INVALID'
  ) {
    return { status: 400, message: 'Os dados de canais da loja são inválidos.' };
  }
  console.error('[Store Connection Onboarding]', error);
  return { status: 503, message: 'Não foi possível atualizar os canais da loja agora.' };
};

export const createStoreConnectionOnboardingRouter = (): Router => {
  const router = Router();

  router.get('/:storeId', async (request, response) => {
    try {
      const storeId = clean(request.params.storeId);
      const identity = await authenticatedOwner(request.get('authorization') ?? '', storeId);
      response.setHeader('Cache-Control', 'no-store, max-age=0');
      response.json(await loadStoreConnectionOnboarding({ storeId, userId: identity.uid }));
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message });
    }
  });

  router.get('/:storeId/inventory-authority-health', async (request, response) => {
    try {
      const storeId = clean(request.params.storeId);
      const identity = await authenticatedOwner(request.get('authorization') ?? '', storeId);
      response.setHeader('Cache-Control', 'no-store, max-age=0');
      response.json(await loadStoreInventoryAuthorityHealth({
        tenantId: identity.uid,
        requestedByUserId: identity.uid,
      }));
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message });
    }
  });

  router.put('/:storeId/channels', async (request, response) => {
    try {
      const storeId = clean(request.params.storeId);
      const identity = await authenticatedOwner(request.get('authorization') ?? '', storeId);
      response.setHeader('Cache-Control', 'no-store, max-age=0');
      response.json(await saveStoreCommerceChannelDeclaration({
        storeId,
        userId: identity.uid,
        channels: request.body?.channels,
        answer: typeof request.body?.answer === 'string' ? request.body.answer : undefined,
      }));
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message });
    }
  });

  router.patch('/:storeId/:connectionId/sync-authority', async (request, response) => {
    try {
      const storeId = clean(request.params.storeId);
      await authenticatedOwner(request.get('authorization') ?? '', storeId);
      response.setHeader('Cache-Control', 'no-store, max-age=0');
      response.json(await updateStoreConnectionSyncAuthority({
        storeId,
        connectionId: clean(request.params.connectionId),
        syncAuthority: request.body?.syncAuthority,
      }));
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message });
    }
  });

  return router;
};
