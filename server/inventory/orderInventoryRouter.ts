import { Router, type Request, type Response } from 'express';
import { FieldValue } from 'firebase-admin/firestore';
import { adminAuth, adminDb } from '../firebaseAdmin';
import { sendNinetyNineFoodOrderStatus } from '../integrations/ninetyNineFoodService';
import { reviewAttendanceOrderAuthoritatively } from './attendanceReviewService';
import { reconcileOrderInventoryAfterMutation } from './orderInventoryAdjustment';
import { createChannelAvailabilityPolicyRouter } from './channelAvailabilityPolicyRouter';
import {
  transitionOrderStatusWithInventory,
  type OrderStatusDecisionInput,
} from './orderInventoryService';
import type { InventoryOrderStatus } from '../../shared/inventoryConsumption';

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
type ParsedOrderDecision = OrderStatusDecisionInput & {
  deliveryProvider?: DeliveryProvider;
};

type ProviderWriteAuthorization = {
  provider: '99food';
  status: InventoryOrderStatus;
  confirmed: true;
};

const bearerToken = (request: Request): string => {
  const authorization = request.get('authorization') ?? '';
  return /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim() ?? '';
};

const authenticatedTenantId = async (request: Request): Promise<string> => {
  const token = bearerToken(request);
  if (!token) throw new Error('AUTH_REQUIRED');
  return (await adminAuth.verifyIdToken(token, true)).uid;
};

const parseDecision = (value: unknown): ParsedOrderDecision => {
  const candidate = value && typeof value === 'object'
    ? value as Record<string, unknown>
    : {};
  const deliveryProvider =
    candidate.deliveryProvider === 'kyrub' || candidate.deliveryProvider === 'merchant'
      ? candidate.deliveryProvider
      : undefined;
  return {
    reason: typeof candidate.reason === 'string' ? candidate.reason : '',
    alternative:
      typeof candidate.alternative === 'string' ? candidate.alternative : '',
    ...(deliveryProvider ? { deliveryProvider } : {}),
  };
};

const parseProviderWriteAuthorization = (
  value: unknown,
  expectedStatus: InventoryOrderStatus
): ProviderWriteAuthorization | null => {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  if (
    candidate.provider !== '99food' ||
    candidate.confirmed !== true ||
    candidate.status !== expectedStatus
  ) {
    return null;
  }
  return {
    provider: '99food',
    status: expectedStatus,
    confirmed: true,
  };
};

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const errorResponse = (response: Response, error: unknown): void => {
  const message = error instanceof Error ? error.message : String(error);
  if (message === 'AUTH_REQUIRED' || /id-token|expired|revoked/i.test(message)) {
    response.status(401).json({ error: 'Faça login novamente.' });
    return;
  }
  if (/não encontrado/i.test(message)) {
    response.status(404).json({ error: message });
    return;
  }
  if (/não permitida|inválid|explique|identificado|Revise os dados|Revise os itens|Revise as quantidades|Escolha como a entrega|Autorização 99Food/i.test(message)) {
    response.status(400).json({ error: message });
    return;
  }
  if (/Estoque insuficiente|componente removido/i.test(message)) {
    response.status(409).json({ error: message, code: 'INVENTORY_BLOCKED' });
    return;
  }
  if (/não está mais aguardando revisão|mudou desde que foi aberta|Mantenha ao menos um item/i.test(message)) {
    response.status(409).json({ error: message, code: 'ATTENDANCE_REVIEW_STALE' });
    return;
  }
  console.error('[Order Inventory]', error);
  response.status(503).json({
    error: message || 'Não foi possível atualizar o pedido e o estoque.',
  });
};

const orderReference = (tenantId: string, orderId: string) =>
  adminDb.doc(`artifacts/${tenantId}/public/data/customerOrders/${orderId}`);

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

const markPartnerSyncAuthorizationRequired = async (
  tenantId: string,
  orderId: string
): Promise<void> => {
  await orderReference(tenantId, orderId).update({
    'integration.outboundStatus': 'authorization_required',
    'integration.outboundError': FieldValue.delete(),
    'integration.outboundUpdatedAt': new Date().toISOString(),
  });
};

export const createOrderInventoryRouter = (): Router => {
  const router = Router();

  router.use('/availability', createChannelAvailabilityPolicyRouter());

  router.post('/:orderId/reconcile-inventory', async (request, response) => {
    try {
      const tenantId = await authenticatedTenantId(request);
      response.json(
        await reconcileOrderInventoryAfterMutation(
          tenantId,
          request.params.orderId
        )
      );
    } catch (error) {
      errorResponse(response, error);
    }
  });

  router.post('/:orderId/attendance-review', async (request, response) => {
    try {
      const tenantId = await authenticatedTenantId(request);
      response.json(
        await reviewAttendanceOrderAuthoritatively(
          tenantId,
          request.params.orderId,
          request.body
        )
      );
    } catch (error) {
      errorResponse(response, error);
    }
  });

  router.post('/:orderId/status', async (request, response) => {
    try {
      const tenantId = await authenticatedTenantId(request);
      const orderId = request.params.orderId;
      const status = typeof request.body?.status === 'string'
        ? request.body.status as InventoryOrderStatus
        : 'pending';
      if (!SUPPORTED_STATUSES.has(status)) {
        response.status(400).json({ error: 'Status do pedido não suportado.' });
        return;
      }

      const providerAuthorizationSupplied =
        request.body?.providerWriteAuthorization !== undefined;
      const providerWriteAuthorization = parseProviderWriteAuthorization(
        request.body?.providerWriteAuthorization,
        status
      );
      if (providerAuthorizationSupplied && !providerWriteAuthorization) {
        throw new Error('Autorização 99Food inválida para este status do pedido.');
      }

      const decision = parseDecision(request.body?.decision);
      const currentSnapshot = await orderReference(tenantId, orderId).get();
      const currentData = currentSnapshot.data() as Record<string, unknown> | undefined;
      const currentIntegration =
        currentData?.integration && typeof currentData.integration === 'object'
          ? currentData.integration as Record<string, unknown>
          : {};
      const currentProvider = clean(currentIntegration.provider);

      if (providerWriteAuthorization && currentProvider !== '99food') {
        throw new Error('Autorização 99Food não corresponde ao provedor deste pedido.');
      }

      if (
        status === 'accepted' &&
        currentSnapshot.exists &&
        currentData?.fulfillmentType === 'delivery' &&
        !decision.deliveryProvider
      ) {
        throw new Error('Escolha como a entrega será realizada: Kyrub ou entregador próprio.');
      }

      const result = await transitionOrderStatusWithInventory(
        tenantId,
        orderId,
        status,
        {
          reason: decision.reason,
          alternative: decision.alternative,
        }
      );

      if (status === 'accepted' && decision.deliveryProvider) {
        await persistDeliveryProvider(
          tenantId,
          result.orderId,
          decision.deliveryProvider
        );
      }

      let partnerSync:
        | 'not-applicable'
        | 'authorization-required'
        | 'sent'
        | 'attention' = 'not-applicable';
      let partnerWarning = '';
      if (result.provider === '99food' && result.externalOrderId) {
        if (!providerWriteAuthorization) {
          partnerSync = 'authorization-required';
          await markPartnerSyncAuthorizationRequired(tenantId, result.orderId)
            .catch(markError => {
              console.error('[Order Inventory] Partner authorization marker failed.', markError);
            });
        } else {
          try {
            await sendNinetyNineFoodOrderStatus(
              tenantId,
              result.externalOrderId,
              result.status,
              decision.reason
            );
            partnerSync = 'sent';
            await markPartnerSyncSuccess(tenantId, result.orderId);
          } catch (error) {
            partnerSync = 'attention';
            partnerWarning =
              error instanceof Error ? error.message : String(error);
            await markPartnerSyncError(tenantId, result.orderId, partnerWarning)
              .catch(markError => {
                console.error('[Order Inventory] Partner sync marker failed.', markError);
              });
          }
        }
      }

      response.json({
        ...result,
        partnerSync,
        partnerWarning,
      });
    } catch (error) {
      errorResponse(response, error);
    }
  });

  return router;
};
