import { Router, type Request, type Response } from 'express';
import { FieldValue } from 'firebase-admin/firestore';
import { adminAuth, adminDb } from '../firebaseAdmin';
import { sendNinetyNineFoodOrderStatus } from '../integrations/ninetyNineFoodService';
import { reviewAttendanceOrderAuthoritatively } from './attendanceReviewService';
import { reconcileOrderInventoryAfterMutation } from './orderInventoryAdjustment';
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

const bearerToken = (request: Request): string => {
  const authorization = request.get('authorization') ?? '';
  return /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim() ?? '';
};

const authenticatedTenantId = async (request: Request): Promise<string> => {
  const token = bearerToken(request);
  if (!token) throw new Error('AUTH_REQUIRED');
  return (await adminAuth.verifyIdToken(token, true)).uid;
};

const parseDecision = (value: unknown): OrderStatusDecisionInput => {
  const candidate = value && typeof value === 'object'
    ? value as Record<string, unknown>
    : {};
  return {
    reason: typeof candidate.reason === 'string' ? candidate.reason : '',
    alternative:
      typeof candidate.alternative === 'string' ? candidate.alternative : '',
  };
};

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
  if (/não permitida|inválid|explique|identificado|Revise os dados|Revise os itens|Revise as quantidades/i.test(message)) {
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

export const createOrderInventoryRouter = (): Router => {
  const router = Router();

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
      const status = typeof request.body?.status === 'string'
        ? request.body.status as InventoryOrderStatus
        : 'pending';
      if (!SUPPORTED_STATUSES.has(status)) {
        response.status(400).json({ error: 'Status do pedido não suportado.' });
        return;
      }

      const result = await transitionOrderStatusWithInventory(
        tenantId,
        request.params.orderId,
        status,
        parseDecision(request.body?.decision)
      );

      let partnerSync: 'not-applicable' | 'sent' | 'attention' = 'not-applicable';
      let partnerWarning = '';
      if (result.provider === '99food' && result.externalOrderId) {
        try {
          await sendNinetyNineFoodOrderStatus(
            tenantId,
            result.externalOrderId,
            result.status,
            typeof request.body?.decision?.reason === 'string'
              ? request.body.decision.reason
              : ''
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
