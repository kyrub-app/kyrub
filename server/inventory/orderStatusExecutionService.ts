import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';
import { adminDb } from '../firebaseAdmin.js';
import {
  transitionOrderStatusWithInventory,
  type OrderStatusDecisionInput,
} from './orderInventoryService.js';
import type { InventoryOrderStatus } from '../../shared/inventoryConsumption.js';

const SUPPORTED_STATUSES = new Set<InventoryOrderStatus>([
  'accepted',
  'preparing',
  'ready',
  'out_for_delivery',
  'completed',
  'rejected',
  'cancelled',
]);

const PICKUP_MAX_ATTEMPTS = 5;

type DeliveryProvider = 'kyrub' | 'merchant';

type OrderStatusExecutionInput = {
  orderId: string;
  status: InventoryOrderStatus;
  decision: OrderStatusDecisionInput & {
    deliveryProvider?: DeliveryProvider;
    handoffCode?: string;
  };
};

type PickupCodeReadInput = {
  storeId: string;
  orderId: string;
};

export type OrderStatusExecutionHttpResult = {
  status: number;
  body: unknown;
};

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const bearerToken = (authorization: string): string =>
  /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim() ?? '';

const orderReference = (tenantId: string, orderId: string) =>
  adminDb.doc(`artifacts/${tenantId}/public/data/customerOrders/${orderId}`);

const pickupSecretId = (tenantId: string, orderId: string): string =>
  createHash('sha256').update(`${tenantId}:${orderId}`).digest('hex');

const pickupSecretReference = (tenantId: string, orderId: string) =>
  adminDb.doc(`orderPickupSecrets/${pickupSecretId(tenantId, orderId)}`);

const pickupCodeHash = (orderId: string, code: string): string =>
  createHash('sha256').update(`${orderId}:${code}`).digest('hex');

const safeEqualHex = (left: string, right: string): boolean => {
  if (!/^[a-f0-9]{64}$/i.test(left) || !/^[a-f0-9]{64}$/i.test(right)) {
    return false;
  }
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
};

const parseInput = (body: unknown): OrderStatusExecutionInput => {
  const candidate = body && typeof body === 'object' && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {};
  const orderId = clean(candidate.orderId);
  const status = clean(candidate.status) as InventoryOrderStatus;
  const rawDecision = candidate.decision && typeof candidate.decision === 'object' && !Array.isArray(candidate.decision)
    ? candidate.decision as Record<string, unknown>
    : {};
  const deliveryProvider =
    rawDecision.deliveryProvider === 'kyrub' || rawDecision.deliveryProvider === 'merchant'
      ? rawDecision.deliveryProvider
      : undefined;
  const handoffCode = clean(rawDecision.handoffCode).replace(/\D/g, '').slice(0, 6);

  if (!orderId || orderId.length > 240) throw new Error('Pedido não identificado.');
  if (!SUPPORTED_STATUSES.has(status)) throw new Error('Status do pedido não suportado.');

  return {
    orderId,
    status,
    decision: {
      reason: clean(rawDecision.reason),
      alternative: clean(rawDecision.alternative),
      ...(deliveryProvider ? { deliveryProvider } : {}),
      ...(handoffCode ? { handoffCode } : {}),
    },
  };
};

const parsePickupCodeReadInput = (body: unknown): PickupCodeReadInput => {
  const candidate = body && typeof body === 'object' && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {};
  const storeId = clean(candidate.storeId);
  const orderId = clean(candidate.orderId);
  if (!storeId || !orderId || storeId.length > 128 || orderId.length > 240) {
    throw new Error('Pedido não identificado.');
  }
  return { storeId, orderId };
};

const canonicalStoreIdFor = async (tenantId: string): Promise<string> => {
  const tenantSnapshot = await adminDb.doc(`tenants/${tenantId}`).get();
  return clean(tenantSnapshot.data()?.canonicalStoreId);
};

const persistOrderPayload = async (
  tenantId: string,
  orderId: string,
  payload: Record<string, unknown>
): Promise<void> => {
  const canonicalStoreId = await canonicalStoreIdFor(tenantId);
  const batch = adminDb.batch();
  batch.set(orderReference(tenantId, orderId), payload, { merge: true });
  if (canonicalStoreId) {
    batch.set(
      adminDb.doc(`stores/${canonicalStoreId}/orders/${orderId}`),
      payload,
      { merge: true }
    );
  }
  await batch.commit();
};

const persistDeliveryProvider = async (
  tenantId: string,
  orderId: string,
  deliveryProvider: DeliveryProvider
): Promise<void> => {
  const updatedAt = new Date().toISOString();
  await persistOrderPayload(tenantId, orderId, {
    deliveryProvider,
    deliveryProviderChosenAt: updatedAt,
    updatedAt,
  });
};

const ensurePickupHandoff = async (
  tenantId: string,
  orderId: string
): Promise<void> => {
  const snapshot = await orderReference(tenantId, orderId).get();
  if (!snapshot.exists) throw new Error('Pedido não encontrado.');
  const data = snapshot.data() as Record<string, unknown>;
  if (data.fulfillmentType !== 'pickup' || data.status !== 'ready') return;

  const currentHandoff = data.handoff && typeof data.handoff === 'object' && !Array.isArray(data.handoff)
    ? data.handoff as Record<string, unknown>
    : {};
  if (clean(currentHandoff.codeHash)) return;

  const buyerId = clean(data.buyerId);
  if (!buyerId) throw new Error('Comprador do pedido não identificado.');
  const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
  const now = new Date().toISOString();
  const handoff = {
    status: 'awaiting_pickup',
    method: 'pickup_code',
    codeHash: pickupCodeHash(orderId, code),
    codeHint: code.slice(-2),
    attempts: 0,
    maxAttempts: PICKUP_MAX_ATTEMPTS,
    readyAt: now,
  };

  const canonicalStoreId = await canonicalStoreIdFor(tenantId);
  const batch = adminDb.batch();
  batch.set(orderReference(tenantId, orderId), { handoff, updatedAt: now }, { merge: true });
  if (canonicalStoreId) {
    batch.set(
      adminDb.doc(`stores/${canonicalStoreId}/orders/${orderId}`),
      { handoff, updatedAt: now },
      { merge: true }
    );
  }
  batch.set(pickupSecretReference(tenantId, orderId), {
    tenantId,
    orderId,
    buyerId,
    code,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  await batch.commit();
};

const verifyPickupHandoff = async (
  tenantId: string,
  orderId: string,
  suppliedCode: string,
  actorId: string
): Promise<void> => {
  const snapshot = await orderReference(tenantId, orderId).get();
  if (!snapshot.exists) throw new Error('Pedido não encontrado.');
  const data = snapshot.data() as Record<string, unknown>;
  if (data.fulfillmentType !== 'pickup') return;
  if (data.status !== 'ready') {
    throw new Error('O pedido precisa estar pronto antes da retirada.');
  }

  const handoff = data.handoff && typeof data.handoff === 'object' && !Array.isArray(data.handoff)
    ? data.handoff as Record<string, unknown>
    : {};
  const expectedHash = clean(handoff.codeHash);
  const attempts = typeof handoff.attempts === 'number' && Number.isFinite(handoff.attempts)
    ? Math.max(0, Math.trunc(handoff.attempts))
    : 0;

  if (!expectedHash) throw new Error('Código de retirada ainda não foi emitido. Marque o pedido como pronto novamente.');
  if (attempts >= PICKUP_MAX_ATTEMPTS || clean(handoff.lockedAt)) {
    const error = new Error('Código de retirada bloqueado após muitas tentativas.');
    Object.assign(error, { code: 'PICKUP_CODE_LOCKED' });
    throw error;
  }
  if (!/^\d{6}$/.test(suppliedCode)) {
    throw new Error('Informe o código de retirada de 6 dígitos.');
  }

  const valid = safeEqualHex(expectedHash, pickupCodeHash(orderId, suppliedCode));
  if (!valid) {
    const nextAttempts = attempts + 1;
    const now = new Date().toISOString();
    const payload: Record<string, unknown> = {
      'handoff.attempts': nextAttempts,
      'handoff.lastFailedAt': now,
      updatedAt: now,
    };
    if (nextAttempts >= PICKUP_MAX_ATTEMPTS) {
      payload['handoff.lockedAt'] = now;
    }
    await persistOrderPayload(tenantId, orderId, payload);
    const error = new Error(
      nextAttempts >= PICKUP_MAX_ATTEMPTS
        ? 'Código incorreto. A retirada foi bloqueada após 5 tentativas.'
        : `Código incorreto. Restam ${PICKUP_MAX_ATTEMPTS - nextAttempts} tentativas.`
    );
    Object.assign(error, { code: 'PICKUP_CODE_INVALID' });
    throw error;
  }

  const now = new Date().toISOString();
  await persistOrderPayload(tenantId, orderId, {
    'handoff.status': 'verified',
    'handoff.verifiedAt': now,
    'handoff.verifiedBy': actorId,
    'handoff.method': 'pickup_code',
    updatedAt: now,
  });
};

const finalizePickupHandoff = async (
  tenantId: string,
  orderId: string,
  actorId: string
): Promise<void> => {
  const snapshot = await orderReference(tenantId, orderId).get();
  const data = snapshot.data() as Record<string, unknown> | undefined;
  if (!snapshot.exists || data?.fulfillmentType !== 'pickup') return;
  const now = new Date().toISOString();
  const canonicalStoreId = await canonicalStoreIdFor(tenantId);
  const batch = adminDb.batch();
  const payload = {
    'handoff.status': 'handed_over',
    'handoff.handedOverAt': now,
    'handoff.handedOverBy': actorId,
    updatedAt: now,
  };
  batch.set(orderReference(tenantId, orderId), payload, { merge: true });
  if (canonicalStoreId) {
    batch.set(
      adminDb.doc(`stores/${canonicalStoreId}/orders/${orderId}`),
      payload,
      { merge: true }
    );
  }
  batch.delete(pickupSecretReference(tenantId, orderId));
  await batch.commit();
};

const markPartnerSyncError = async (
  tenantId: string,
  orderId: string,
  message: string
): Promise<void> => {
  await orderReference(tenantId, orderId).update({
    'integration.outboundStatus': 'attention',
    'integration.outboundError': message.slice(0, 500),
    'integration.outboundUpdatedAt': new Date().toISOString(),
  });
};

const markPartnerSyncSuccess = async (
  tenantId: string,
  orderId: string
): Promise<void> => {
  await orderReference(tenantId, orderId).update({
    'integration.outboundStatus': 'sent',
    'integration.outboundError': FieldValue.delete(),
    'integration.outboundUpdatedAt': new Date().toISOString(),
  });
};

export const mapOrderStatusExecutionError = (
  error: unknown
): OrderStatusExecutionHttpResult => {
  const message = error instanceof Error ? error.message : String(error);
  const code = error && typeof error === 'object' && 'code' in error
    ? clean((error as { code?: unknown }).code)
    : '';
  if (code === 'AUTH_REQUIRED' || /sessão|token|auth/i.test(message)) {
    return { status: 401, body: { error: 'Faça login novamente.' } };
  }
  if (code === 'PICKUP_CODE_LOCKED') {
    return { status: 423, body: { error: message, code } };
  }
  if (code === 'PICKUP_CODE_INVALID') {
    return { status: 403, body: { error: message, code } };
  }
  if (/não encontrado/i.test(message)) {
    return { status: 404, body: { error: message } };
  }
  if (/não permitida|inválid|não suportado|explique|identificado|Escolha como a entrega|código de retirada|pedido precisa estar pronto|Comprador/i.test(message)) {
    return { status: 400, body: { error: message } };
  }
  if (/Estoque insuficiente|componente removido/i.test(message)) {
    return { status: 409, body: { error: message, code: 'INVENTORY_BLOCKED' } };
  }
  console.error('[Order Status Execution]', error);
  return {
    status: 503,
    body: { error: message || 'Não foi possível atualizar o pedido e o estoque.' },
  };
};

export const executeAuthorizedPickupCodeRead = async (
  authorization: string,
  body: unknown
): Promise<OrderStatusExecutionHttpResult> => {
  try {
    const token = bearerToken(authorization);
    if (!token) throw new Error('AUTH_REQUIRED');
    const identity = await verifyFirebaseIdToken(token);
    const input = parsePickupCodeReadInput(body);
    const secretSnapshot = await pickupSecretReference(input.storeId, input.orderId).get();
    if (!secretSnapshot.exists) throw new Error('Código de retirada não encontrado.');
    const secret = secretSnapshot.data() as Record<string, unknown>;
    if (clean(secret.buyerId) !== identity.uid) {
      return { status: 403, body: { error: 'Este código pertence a outro comprador.' } };
    }
    const orderSnapshot = await orderReference(input.storeId, input.orderId).get();
    const order = orderSnapshot.data() as Record<string, unknown> | undefined;
    if (!orderSnapshot.exists || order?.status !== 'ready' || order?.fulfillmentType !== 'pickup') {
      throw new Error('Este pedido não está aguardando retirada.');
    }
    return {
      status: 200,
      body: {
        orderId: input.orderId,
        code: clean(secret.code),
        readyAt: clean((order?.handoff as Record<string, unknown> | undefined)?.readyAt),
      },
    };
  } catch (error) {
    return mapOrderStatusExecutionError(error);
  }
};

export const executeAuthorizedOrderStatusTransition = async (
  authorization: string,
  body: unknown
): Promise<OrderStatusExecutionHttpResult> => {
  try {
    const token = bearerToken(authorization);
    if (!token) throw new Error('AUTH_REQUIRED');
    const identity = await verifyFirebaseIdToken(token);
    const input = parseInput(body);

    const snapshot = await orderReference(identity.uid, input.orderId).get();
    const data = snapshot.data() as Record<string, unknown> | undefined;

    if (input.status === 'accepted') {
      if (
        snapshot.exists &&
        data?.fulfillmentType === 'delivery' &&
        !input.decision.deliveryProvider
      ) {
        throw new Error('Escolha como a entrega será realizada: Kyrub ou entregador próprio.');
      }
    }

    if (input.status === 'completed' && data?.fulfillmentType === 'pickup') {
      await verifyPickupHandoff(
        identity.uid,
        input.orderId,
        input.decision.handoffCode ?? '',
        identity.uid
      );
    }

    const result = await transitionOrderStatusWithInventory(
      identity.uid,
      input.orderId,
      input.status,
      {
        reason: input.decision.reason,
        alternative: input.decision.alternative,
      }
    );

    if (input.status === 'accepted' && input.decision.deliveryProvider) {
      await persistDeliveryProvider(
        identity.uid,
        result.orderId,
        input.decision.deliveryProvider
      );
    }

    if (input.status === 'ready') {
      await ensurePickupHandoff(identity.uid, result.orderId);
    }

    if (input.status === 'completed' && data?.fulfillmentType === 'pickup') {
      await finalizePickupHandoff(identity.uid, result.orderId, identity.uid);
    }

    let partnerSync: 'not-applicable' | 'sent' | 'attention' = 'not-applicable';
    let partnerWarning = '';
    if (result.provider === '99food' && result.externalOrderId) {
      try {
        const { sendNinetyNineFoodOrderStatus } = await import(
          '../integrations/ninetyNineFoodService.js'
        );
        await sendNinetyNineFoodOrderStatus(
          identity.uid,
          result.externalOrderId,
          result.status,
          input.decision.reason ?? ''
        );
        partnerSync = 'sent';
        await markPartnerSyncSuccess(identity.uid, result.orderId);
      } catch (error) {
        partnerSync = 'attention';
        partnerWarning = error instanceof Error ? error.message : String(error);
        await markPartnerSyncError(identity.uid, result.orderId, partnerWarning)
          .catch(markError => {
            console.error('[Order Status Execution] Partner sync marker failed.', markError);
          });
      }
    }

    return {
      status: 200,
      body: {
        ...result,
        partnerSync,
        partnerWarning,
      },
    };
  } catch (error) {
    return mapOrderStatusExecutionError(error);
  }
};
