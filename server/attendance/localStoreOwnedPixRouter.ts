import { Router } from 'express';
import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';
import { loadOwnerStoreInstitutionalRepresentation } from '../store/storeInstitutionalIdentityService.js';
import { loadMercadoPagoStoreConnectionMetadata } from '../integrations/mercadoPagoStoreConnectionSecretStore.js';
import { loadStoreOwnedPixConnectionMetadata } from '../integrations/storeOwnedPixSecretStore.js';
import { attachStoreOwnedPixToLocalIntent } from './localStoreOwnedPixService.js';
import { confirmStoreOwnedPixLocalPayment } from './localStoreOwnedPixConfirmationService.js';

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';
const bearerToken = (authorization: string): string =>
  /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim() ?? '';

const requireStoreAuthority = async (input: {
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

const mapError = (error: unknown): { status: number; message: string } => {
  const message = error instanceof Error ? error.message : String(error);
  if (message === 'AUTH_REQUIRED') {
    return { status: 401, message: 'Faça login novamente para operar os recebimentos.' };
  }
  if (
    message === 'STORE_REPRESENTATION_FORBIDDEN' ||
    message === 'LOCAL_STORE_PIX_FORBIDDEN' ||
    message === 'LOCAL_STORE_PIX_CONFIRM_FORBIDDEN'
  ) {
    return { status: 403, message: 'Você não pode operar os recebimentos desta loja.' };
  }
  if (message === 'STORE_INSTITUTIONAL_NOT_FOUND') {
    return { status: 404, message: 'A loja ainda não está disponível para recebimentos.' };
  }
  if (message === 'STORE_PIX_NOT_CONFIGURED') {
    return { status: 409, message: 'Configure a chave em Integrações → Recebimentos → Pix próprio antes de gerar a cobrança.' };
  }
  if (message === 'STORE_PIX_DISABLED') {
    return { status: 409, message: 'O Pix próprio está desativado nesta loja.' };
  }
  if (
    message === 'LOCAL_STORE_PIX_PAYMENT_STATE_MISSING' ||
    message === 'LOCAL_STORE_PIX_ORDER_NOT_FOUND' ||
    message === 'LOCAL_STORE_PIX_CONFIRM_PAYMENT_STATE_MISSING' ||
    message === 'LOCAL_STORE_PIX_CONFIRM_ORDER_NOT_FOUND'
  ) {
    return { status: 404, message: 'A cobrança Pix não está mais disponível.' };
  }
  if (
    message === 'LOCAL_STORE_PIX_INTENT_EXPIRED' ||
    message === 'LOCAL_STORE_PIX_CONFIRM_INTENT_EXPIRED'
  ) {
    return { status: 409, message: 'A tentativa Kyrub expirou. Inicie uma nova cobrança antes de confirmar o recebimento.' };
  }
  if (message === 'LOCAL_STORE_PIX_CONFIRM_EXPLICIT_ACK_REQUIRED') {
    return { status: 400, message: 'Confirme explicitamente que o crédito foi conferido na conta recebedora.' };
  }
  if (
    message === 'LOCAL_STORE_PIX_BINDING_CONFLICT' ||
    message === 'LOCAL_STORE_PIX_PAYMENT_PAIR_MISMATCH' ||
    message === 'LOCAL_STORE_PIX_PAYMENT_NOT_PENDING' ||
    message === 'LOCAL_STORE_PIX_ATTENDANCE_APPROVAL_REQUIRED' ||
    message === 'LOCAL_STORE_PIX_CUSTOMER_IDENTIFICATION_REQUIRED' ||
    message === 'LOCAL_STORE_PIX_CONTEXT_CHANGED' ||
    message === 'LOCAL_STORE_PIX_OTHER_PAYMENT_PENDING' ||
    message === 'LOCAL_STORE_PIX_INTENT_STALE' ||
    message === 'LOCAL_STORE_PIX_PAYMENT_CONTEXT_CONFLICT' ||
    message === 'LOCAL_STORE_PIX_CONFIRM_PAYMENT_PAIR_MISMATCH' ||
    message === 'LOCAL_STORE_PIX_CONFIRM_PAYMENT_NOT_PENDING' ||
    message === 'LOCAL_STORE_PIX_CONFIRM_RECONCILIATION_REQUIRED' ||
    message === 'LOCAL_STORE_PIX_CONFIRM_CONTEXT_CHANGED' ||
    message === 'LOCAL_STORE_PIX_CONFIRM_OTHER_PAYMENT_PENDING' ||
    message === 'LOCAL_STORE_PIX_CONFIRM_INTENT_STALE'
  ) {
    return {
      status: 409,
      message:
        message.includes('ATTENDANCE_APPROVAL_REQUIRED')
          ? 'Aprove o atendimento antes de gerar o Pix.'
          : message.includes('CUSTOMER_IDENTIFICATION_REQUIRED')
            ? 'Identifique o Cairubido antes de gerar o Pix.'
            : message.includes('BINDING_CONFLICT')
              ? 'Esta tentativa já está vinculada a outro modo de recebimento.'
              : 'A situação financeira mudou e precisa ser revisada antes de continuar.',
    };
  }
  if (
    message.startsWith('LOCAL_STORE_PIX_') ||
    message.startsWith('STORE_PIX_')
  ) {
    console.warn('[Store-owned local Pix]', message);
    return { status: 400, message: 'Os dados da cobrança Pix próprio são inválidos.' };
  }
  console.error('[Store-owned local Pix]', error);
  return { status: 503, message: 'O Pix próprio está temporariamente indisponível.' };
};

export const createLocalStoreOwnedPixRouter = (): Router => {
  const router = Router();

  router.get('/payment-options', async (request, response) => {
    try {
      const storeId = clean(request.query.storeId);
      if (!storeId) throw new Error('LOCAL_STORE_PIX_STORE_REQUIRED');
      await requireStoreAuthority({
        authorization: request.get('authorization') ?? '',
        storeId,
      });
      const [mercadoPago, storePix] = await Promise.all([
        loadMercadoPagoStoreConnectionMetadata(storeId),
        loadStoreOwnedPixConnectionMetadata(storeId),
      ]);
      response.setHeader('Cache-Control', 'no-store, max-age=0');
      response.status(200).json({
        mercadoPagoConnected: mercadoPago?.status === 'connected',
        storePixConfigured: storePix.configured,
        storePixEnabled: storePix.enabled,
      });
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message });
    }
  });

  router.post('/payment-intents/store-pix', async (request, response) => {
    try {
      const storeId = clean(request.body?.storeId);
      if (!storeId) throw new Error('LOCAL_STORE_PIX_STORE_REQUIRED');
      const representation = await requireStoreAuthority({
        authorization: request.get('authorization') ?? '',
        storeId,
      });
      const result = await attachStoreOwnedPixToLocalIntent({
        authenticatedUserId: representation.authenticatedUserId,
        value: request.body,
      });
      response.status(200).json(result);
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message });
    }
  });

  router.post('/payment-intents/store-pix/confirm', async (request, response) => {
    try {
      const storeId = clean(request.body?.storeId);
      if (!storeId) throw new Error('LOCAL_STORE_PIX_STORE_REQUIRED');
      const representation = await requireStoreAuthority({
        authorization: request.get('authorization') ?? '',
        storeId,
      });
      const result = await confirmStoreOwnedPixLocalPayment({
        authenticatedUserId: representation.authenticatedUserId,
        value: request.body,
      });
      response.status(200).json(result);
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message });
    }
  });

  return router;
};
