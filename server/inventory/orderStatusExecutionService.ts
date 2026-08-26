import { FieldValue } from 'firebase-admin/firestore';
import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';
import { adminDb } from '../firebaseAdmin.js';
import { sendNinetyNineFoodOrderStatus } from '../integrations/ninetyNineFoodService.js';
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

type DeliveryProvider = 'kyrub' | 'merchant';

type OrderStatusExecutionInput = {
  orderId: string;
  status: InventoryOrderStatus;
  decision: OrderStatusDecisionInput & { deliveryProvider?: DeliveryProvider };
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

  if (!orderId || orderId.length > 240) throw new Error('Pedido não identificado.');
  if (!SUPPORTED_STATUSES.has(status)) throw new Error('Status do pedido não suportado.');

  return {
    orderId,
    status,
    decision: {
      reason: clean(rawDecision.reason),
      alternative: clean(rawDecision.alternative),
      ...(deliveryProvider ? { deliveryProvider } : {}),
    },
  };
};

const persistDeliveryProvider = async (
  tenantId: string,
  orderId: string,
  deliveryProvider: DeliveryProvider
): Promise<void> => {
  const tenantSnapshot = await adminDb.doc(`tenants/${tenantId}`).get();
  const canonicalStoreId = clean(tenantSnapshot.data()?.canonicalStoreId);
  const updatedAt = new Date().toISOString();
  const payload = {
    deliveryProvider,
    deliveryProviderChosenAt: updatedAt,
    updatedAt,
  };
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
  if (/não encontrado/i.test(message)) {
    return { status: 404, body: { error: message } };
  }
  if (/não permitida|inválid|não suportado|explique|identificado|Escolha como a entrega/i.test(message)) {
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

export const executeAuthorizedOrderStatusTransition = async (
  authorization: string,
  body: unknown
): Promise<OrderStatusExecutionHttpResult> => {
  try {
    const token = bearerToken(authorization);
    if (!token) throw new Error('AUTH_REQUIRED');
    const identity = await verifyFirebaseIdToken(token);
    const input = parseInput(body);

    if (input.status === 'accepted') {
      const snapshot = await orderReference(identity.uid, input.orderId).get();
      const data = snapshot.data() as Record<string, unknown> | undefined;
      if (
        snapshot.exists &&
        data?.fulfillmentType === 'delivery' &&
        !input.decision.deliveryProvider
      ) {
        throw new Error('Escolha como a entrega será realizada: Kyrub ou entregador próprio.');
      }
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

    let partnerSync: 'not-applicable' | 'sent' | 'attention' = 'not-applicable';
    let partnerWarning = '';
    if (result.provider === '99food' && result.externalOrderId) {
      try {
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
