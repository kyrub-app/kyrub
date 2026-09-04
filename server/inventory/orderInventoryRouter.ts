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

const PENDING_PARTNER_SYNC_STATUSES = new Set([
  'authorization_required',
  'attention',
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
  if (/Sincronização 99Food.*não está pendente|status do pedido mudou desde a autorização 99Food/i.test(message)) {
    response.status(409).json({ error: message, code: 'NINETY_NINE_FOOD_STATUS_SYNC_STALE' });
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

const orderCollection = (tenantId: string) =>
  adminDb.collection(`artifacts/${tenantId}/public/data/customerOrders`);

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
  status: InventoryOrderStatus,
  reason: string,
  message: string
): Promise<void> => {
  await orderReference(tenantId, orderId).update({
    'integration.outboundStatus': 'attention',
    'integration.outboundTargetStatus': status,
    'integration.outboundReason': reason || FieldValue.delete(),
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
    'integration.outboundTargetStatus': FieldValue.delete(),
    'integration.outboundReason': FieldValue.delete(),
    'integration.outboundError': FieldValue.delete(),
    'integration.outboundUpdatedAt': new Date().toISOString(),
  });
};

const markPartnerSyncAuthorizationRequired = async (
  tenantId: string,
  orderId: string,
  status: InventoryOrderStatus,
  reason: string
): Promise<void> => {
  await orderReference(tenantId, orderId).update({
    'integration.outboundStatus': 'authorization_required',
    'integration.outboundTargetStatus': status,
    'integration.outboundReason': reason || FieldValue.delete(),
    'integration.outboundError': FieldValue.delete(),
    'integration.outboundUpdatedAt': new Date().toISOString(),
  });
};

const listPendingNinetyNineFoodStatusSyncs = async (tenantId: string) => {
  const snapshot = await orderCollection(tenantId)
    .where(
      'integration.outboundStatus',
      'in',
      Array.from(PENDING_PARTNER_SYNC_STATUSES)
    )
    .limit(100)
    .get();

  const items = snapshot.docs.flatMap(document => {
    const data = document.data() as Record<string, unknown>;
    const integration =
      data.integration && typeof data.integration === 'object' && !Array.isArray(data.integration)
        ? data.integration as Record<string, unknown>
        : {};
    const provider = clean(integration.provider);
    const outboundStatus = clean(integration.outboundStatus);
    const currentStatus = clean(data.status) as InventoryOrderStatus;
    const frozenTargetStatus = clean(integration.outboundTargetStatus) as InventoryOrderStatus;
    const status = SUPPORTED_STATUSES.has(frozenTargetStatus)
      ? frozenTargetStatus
      : currentStatus;
    const externalOrderId = clean(integration.externalOrderId);
    if (
      provider !== '99food' ||
      !PENDING_PARTNER_SYNC_STATUSES.has(outboundStatus) ||
      !SUPPORTED_STATUSES.has(status) ||
      !externalOrderId
    ) {
      return [];
    }
    return [{
      orderId: document.id,
      externalOrderId,
      displayId: clean(data.displayId) || clean(data.orderNumber) || externalOrderId,
      customerName: clean(data.customerName),
      status,
      outboundStatus,
      outboundError: clean(integration.outboundError),
      outboundUpdatedAt: clean(integration.outboundUpdatedAt) || clean(data.updatedAt),
    }];
  });

  items.sort((left, right) =>
    right.outboundUpdatedAt.localeCompare(left.outboundUpdatedAt)
  );
  return { items };
};

export const createOrderInventoryRouter = (): Router => {
  const router = Router();

  router.use('/availability', createChannelAvailabilityPolicyRouter());

  router.get('/provider-sync/99food/pending', async (request, response) => {
    try {
      const tenantId = await authenticatedTenantId(request);
      response.json(await listPendingNinetyNineFoodStatusSyncs(tenantId));
    } catch (error) {
      errorResponse(response, error);
    }
  });

  router.post('/:orderId/provider-sync/99food', async (request, response) => {
    try {
      const tenantId = await authenticatedTenantId(request);
      const orderId = clean(request.params.orderId);
      const authorizationValue = request.body?.providerWriteAuthorization;
      const authorizationCandidate =
        authorizationValue && typeof authorizationValue === 'object'
          ? authorizationValue as Record<string, unknown>
          : {};
      const requestedStatus = clean(authorizationCandidate.status) as InventoryOrderStatus;
      if (!SUPPORTED_STATUSES.has(requestedStatus)) {
        throw new Error('Autorização 99Food inválida para este status do pedido.');
      }
      const providerWriteAuthorization = parseProviderWriteAuthorization(
        authorizationValue,
        requestedStatus
      );
      if (!providerWriteAuthorization) {
        throw new Error('Autorização 99Food inválida para este status do pedido.');
      }

      const currentSnapshot = await orderReference(tenantId, orderId).get();
      if (!currentSnapshot.exists) throw new Error('Pedido não encontrado.');
      const currentData = currentSnapshot.data() as Record<string, unknown>;
      const currentIntegration =
        currentData.integration && typeof currentData.integration === 'object' && !Array.isArray(currentData.integration)
          ? currentData.integration as Record<string, unknown>
          : {};
      const currentProvider = clean(currentIntegration.provider);
      const currentStatus = clean(currentData.status) as InventoryOrderStatus;
      const outboundTargetStatus = clean(currentIntegration.outboundTargetStatus) as InventoryOrderStatus;
      const expectedStatus = SUPPORTED_STATUSES.has(outboundTargetStatus)
        ? outboundTargetStatus
        : currentStatus;
      const outboundStatus = clean(currentIntegration.outboundStatus);
      const externalOrderId = clean(currentIntegration.externalOrderId);
      const reason = clean(currentIntegration.outboundReason);

      if (currentProvider !== '99food') {
        throw new Error('Autorização 99Food não corresponde ao provedor deste pedido.');
      }
      if (!PENDING_PARTNER_SYNC_STATUSES.has(outboundStatus)) {
        throw new Error('Sincronização 99Food deste pedido não está pendente para envio manual.');
      }
      if (
        !SUPPORTED_STATUSES.has(currentStatus) ||
        currentStatus !== providerWriteAuthorization.status ||
        expectedStatus !== providerWriteAuthorization.status
      ) {
        throw new Error('O status do pedido mudou desde a autorização 99Food. Revise a fila e confirme novamente.');
      }
      if (!externalOrderId) {
        throw new Error('Pedido 99Food sem identificador externo válido.');
      }

      try {
        await sendNinetyNineFoodOrderStatus(
          tenantId,
          externalOrderId,
          providerWriteAuthorization.status,
          reason
        );
        await markPartnerSyncSuccess(tenantId, orderId);
        response.json({
          orderId,
          externalOrderId,
          status: providerWriteAuthorization.status,
          partnerSync: 'sent',
          partnerWarning: '',
          localTransitionApplied: false,
        });
      } catch (error) {
        const partnerWarning = error instanceof Error ? error.message : String(error);
        await markPartnerSyncError(
          tenantId,
          orderId,
          providerWriteAuthorization.status,
          reason,
          partnerWarning
        ).catch(markError => {
          console.error('[Order Inventory] Partner sync marker failed.', markError);
        });
        response.status(202).json({
          orderId,
          externalOrderId,
          status: providerWriteAuthorization.status,
          partnerSync: 'attention',
          partnerWarning,
          localTransitionApplied: false,
        });
      }
    } catch (error) {
      errorResponse(response, error);
    }
  });

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
          await markPartnerSyncAuthorizationRequired(
            tenantId,
            result.orderId,
            result.status,
            decision.reason
          ).catch(markError => {
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
            await markPartnerSyncError(
              tenantId,
              result.orderId,
              result.status,
              decision.reason,
              partnerWarning
            ).catch(markError => {
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
