import { Router } from 'express';
import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';
import { loadOwnerStoreInstitutionalRepresentation } from '../store/storeInstitutionalIdentityService.js';
import {
  listStoreCustomerChatInbox,
  loadStoreCustomerChatThread,
  markStoreCustomerChatRead,
  sendStoreCustomerChatMessage,
} from './storeCustomerChatService.js';

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const bearerToken = (authorization: string): string =>
  /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim() ?? '';

const requireIdentity = async (authorization: string) => {
  const token = bearerToken(authorization);
  if (!token) throw new Error('AUTH_REQUIRED');
  return verifyFirebaseIdToken(token);
};

const requireStoreConversationRepresentation = async (
  storeId: string,
  authenticatedUserId: string
): Promise<void> => {
  const representation = await loadOwnerStoreInstitutionalRepresentation({
    storeId,
    authenticatedUserId,
  });
  if (!representation.capabilities.includes('conversation_act')) {
    throw new Error('STORE_CUSTOMER_CHAT_FORBIDDEN');
  }
};

const mapError = (error: unknown): { status: number; message: string } => {
  const message = error instanceof Error ? error.message : String(error);
  if (message === 'AUTH_REQUIRED') {
    return { status: 401, message: 'Faça login novamente para acessar a conversa.' };
  }
  if (
    message === 'STORE_REPRESENTATION_FORBIDDEN' ||
    message === 'STORE_CUSTOMER_CHAT_FORBIDDEN'
  ) {
    return { status: 403, message: 'Você não pode responder em nome desta loja.' };
  }
  if (message === 'STORE_INSTITUTIONAL_NOT_FOUND') {
    return { status: 404, message: 'Loja não encontrada.' };
  }
  if (message === 'STORE_CUSTOMER_CHAT_ORDER_NOT_FOUND') {
    return { status: 404, message: 'Pedido não encontrado para esta conversa.' };
  }
  if (message === 'STORE_CUSTOMER_CHAT_ORDER_SCOPE_INVALID') {
    return { status: 403, message: 'Este pedido não pertence a esta conversa.' };
  }
  if (message === 'STORE_CUSTOMER_CHAT_MESSAGE_REQUIRED') {
    return { status: 400, message: 'Escreva uma mensagem antes de enviar.' };
  }
  if (message === 'STORE_CUSTOMER_CHAT_MESSAGE_TOO_LONG') {
    return { status: 400, message: 'A mensagem deve ter no máximo 4000 caracteres.' };
  }
  if (
    message.startsWith('STORE_CUSTOMER_CHAT_') ||
    message.startsWith('STORE_INSTITUTIONAL_') ||
    message.startsWith('STORE_REPRESENTATION_')
  ) {
    console.warn('[Store customer chat]', message);
    return { status: 409, message: 'A conversa está com dados inconsistentes.' };
  }
  console.error('[Store customer chat]', error);
  return { status: 503, message: 'O chat da loja está temporariamente indisponível.' };
};

export const createStoreCustomerChatRouter = (): Router => {
  const router = Router();

  router.get('/thread', async (request, response) => {
    try {
      const identity = await requireIdentity(request.get('authorization') ?? '');
      const storeId = clean(request.query.storeId);
      if (!storeId) throw new Error('STORE_CUSTOMER_CHAT_PARTICIPANT_INVALID');
      const result = await loadStoreCustomerChatThread({
        storeId,
        customerId: identity.uid,
      });
      response.status(200).json(result);
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message });
    }
  });

  router.post('/send', async (request, response) => {
    try {
      const identity = await requireIdentity(request.get('authorization') ?? '');
      const storeId = clean(request.body?.storeId);
      const message = await sendStoreCustomerChatMessage({
        storeId,
        customerId: identity.uid,
        senderKind: 'customer',
        actorUserId: identity.uid,
        text: request.body?.text,
        orderId: clean(request.body?.orderId),
      });
      response.status(201).json(message);
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message });
    }
  });

  router.post('/read', async (request, response) => {
    try {
      const identity = await requireIdentity(request.get('authorization') ?? '');
      await markStoreCustomerChatRead({
        storeId: clean(request.body?.storeId),
        customerId: identity.uid,
        perspective: 'customer',
      });
      response.status(204).end();
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message });
    }
  });

  router.get('/inbox', async (request, response) => {
    try {
      const identity = await requireIdentity(request.get('authorization') ?? '');
      const storeId = clean(request.query.storeId);
      await requireStoreConversationRepresentation(storeId, identity.uid);
      const conversations = await listStoreCustomerChatInbox({ storeId });
      response.status(200).json({ conversations });
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message });
    }
  });

  router.get('/thread-as-store', async (request, response) => {
    try {
      const identity = await requireIdentity(request.get('authorization') ?? '');
      const storeId = clean(request.query.storeId);
      const customerId = clean(request.query.customerId);
      await requireStoreConversationRepresentation(storeId, identity.uid);
      const result = await loadStoreCustomerChatThread({ storeId, customerId });
      response.status(200).json(result);
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message });
    }
  });

  router.post('/send-as-store', async (request, response) => {
    try {
      const identity = await requireIdentity(request.get('authorization') ?? '');
      const storeId = clean(request.body?.storeId);
      const customerId = clean(request.body?.customerId);
      await requireStoreConversationRepresentation(storeId, identity.uid);
      const message = await sendStoreCustomerChatMessage({
        storeId,
        customerId,
        senderKind: 'store',
        actorUserId: identity.uid,
        text: request.body?.text,
        orderId: clean(request.body?.orderId),
      });
      response.status(201).json(message);
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message });
    }
  });

  router.post('/read-as-store', async (request, response) => {
    try {
      const identity = await requireIdentity(request.get('authorization') ?? '');
      const storeId = clean(request.body?.storeId);
      const customerId = clean(request.body?.customerId);
      await requireStoreConversationRepresentation(storeId, identity.uid);
      await markStoreCustomerChatRead({
        storeId,
        customerId,
        perspective: 'store',
      });
      response.status(204).end();
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message });
    }
  });

  return router;
};
