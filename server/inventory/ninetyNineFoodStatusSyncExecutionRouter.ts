import { Router, type NextFunction, type Request, type Response } from 'express';
import { adminAuth, adminDb } from '../firebaseAdmin.js';
import { inspectNinetyNineFoodProviderStatusForReconciliation } from '../integrations/ninetyNineFoodProviderStatusReader.js';
import { writeNinetyNineFoodOrderStatusToProvider } from '../integrations/ninetyNineFoodProviderStatusWriter.js';
import {
  claimNinetyNineFoodStatusSyncExecution,
  claimOrderStatusMutation,
  finalizeNinetyNineFoodStatusSyncExecution,
  orderDocumentRevision,
  releaseOrderStatusMutation,
  type OrderStatusMutationClaim,
} from './ninetyNineFoodStatusSyncExecutionService.js';
import {
  claimNinetyNineFoodStatusSyncReconciliation,
  finalizeNinetyNineFoodStatusSyncReconciliation,
  isNinetyNineFoodProviderWriteOutcomeUnknown,
  listNinetyNineFoodStatusSyncReconciliationItems,
  markNinetyNineFoodProviderWriteOutcomeUnknown,
  markNinetyNineFoodProviderWriteStarted,
} from './ninetyNineFoodStatusSyncReconciliationService.js';
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

const PENDING_STATUSES = new Set([
  'authorization_required',
  'attention',
]);

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const bearerToken = (request: Request): string => {
  const authorization = request.get('authorization') ?? '';
  return /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim() ?? '';
};

const authenticatedTenantId = async (request: Request): Promise<string> => {
  const token = bearerToken(request);
  if (!token) throw new Error('AUTH_REQUIRED');
  return (await adminAuth.verifyIdToken(token, true)).uid;
};

const orderReference = (tenantId: string, orderId: string) =>
  adminDb.doc(`artifacts/${tenantId}/public/data/customerOrders/${orderId}`);

const orderCollection = (tenantId: string) =>
  adminDb.collection(`artifacts/${tenantId}/public/data/customerOrders`);

const integrationData = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const order = value as Record<string, unknown>;
  return order.integration && typeof order.integration === 'object' && !Array.isArray(order.integration)
    ? order.integration as Record<string, unknown>
    : {};
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
  if (
    /mudou desde a leitura da fila|mudou desde a autorização|não está pendente|está em execução|outra mudança de status|reconciliação|perdeu a autoridade/i.test(message)
  ) {
    response.status(409).json({
      error: message,
      code: 'NINETY_NINE_FOOD_STATUS_SYNC_REVISION_CONFLICT',
    });
    return;
  }
  if (/Autorização 99Food|identificador externo|identidade externa|não corresponde ao provedor/i.test(message)) {
    response.status(400).json({ error: message });
    return;
  }
  console.error('[99Food Status Sync Execution]', error);
  response.status(503).json({
    error: message || 'Não foi possível executar a sincronização 99Food.',
  });
};

const parseAuthorization = (value: unknown): {
  status: InventoryOrderStatus;
  orderRevision: string;
} | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const status = clean(candidate.status) as InventoryOrderStatus;
  const orderRevision = clean(candidate.orderRevision);
  if (
    candidate.provider !== '99food' ||
    candidate.confirmed !== true ||
    !SUPPORTED_STATUSES.has(status) ||
    !orderRevision
  ) {
    return null;
  }
  return { status, orderRevision };
};

const listPending = async (tenantId: string) => {
  const snapshot = await orderCollection(tenantId)
    .where('integration.outboundStatus', 'in', Array.from(PENDING_STATUSES))
    .limit(100)
    .get();

  const items = snapshot.docs.flatMap(document => {
    const data = document.data() as Record<string, unknown>;
    const integration = integrationData(data);
    const provider = clean(integration.provider);
    const outboundStatus = clean(integration.outboundStatus);
    const currentStatus = clean(data.status) as InventoryOrderStatus;
    const frozenTargetStatus = clean(integration.outboundTargetStatus) as InventoryOrderStatus;
    const status = SUPPORTED_STATUSES.has(frozenTargetStatus)
      ? frozenTargetStatus
      : currentStatus;
    const externalOrderId = clean(integration.externalOrderId);
    const orderRevision = orderDocumentRevision(document);
    if (
      provider !== '99food' ||
      !PENDING_STATUSES.has(outboundStatus) ||
      !SUPPORTED_STATUSES.has(status) ||
      !externalOrderId ||
      !orderRevision
    ) {
      return [];
    }
    return [{
      orderId: document.id,
      orderRevision,
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

const releaseAfterResponse = (
  response: Response,
  claim: OrderStatusMutationClaim
): void => {
  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    void releaseOrderStatusMutation(claim).catch(error => {
      console.error('[99Food Status Sync Execution] Status mutation lock release failed.', error);
    });
  };
  response.once('finish', release);
  response.once('close', release);
};

const serializeNinetyNineFoodStatusMutation = async (
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const tenantId = await authenticatedTenantId(request);
    const orderId = clean(request.params.orderId);
    if (!orderId) {
      response.status(400).json({ error: 'Pedido não identificado.' });
      return;
    }
    const snapshot = await orderReference(tenantId, orderId).get();
    if (!snapshot.exists) {
      next();
      return;
    }
    const integration = integrationData(snapshot.data());
    if (clean(integration.provider) !== '99food') {
      next();
      return;
    }
    if (clean(integration.outboundStatus) === 'reconciliation_required') {
      throw new Error(
        'Este pedido possui uma execução 99Food com resultado externo desconhecido. Conclua a reconciliação antes de alterar novamente o status.'
      );
    }

    const claim = await claimOrderStatusMutation({ tenantId, orderId });
    releaseAfterResponse(response, claim);
    next();
  } catch (error) {
    errorResponse(response, error);
  }
};

export const createNinetyNineFoodStatusSyncExecutionRouter = (): Router => {
  const router = Router();

  router.get('/provider-sync/99food/pending', async (request, response) => {
    try {
      const tenantId = await authenticatedTenantId(request);
      response.json(await listPending(tenantId));
    } catch (error) {
      errorResponse(response, error);
    }
  });

  router.get('/provider-sync/99food/reconciliation', async (request, response) => {
    try {
      const tenantId = await authenticatedTenantId(request);
      response.json({
        items: await listNinetyNineFoodStatusSyncReconciliationItems(tenantId),
      });
    } catch (error) {
      errorResponse(response, error);
    }
  });

  router.post(
    '/:orderId/provider-sync/99food/reconciliation/:executionId',
    async (request, response) => {
      try {
        const tenantId = await authenticatedTenantId(request);
        const orderId = clean(request.params.orderId);
        const executionId = clean(request.params.executionId);
        const claim = await claimNinetyNineFoodStatusSyncReconciliation({
          tenantId,
          orderId,
          executionId,
        });

        let observation: Awaited<ReturnType<typeof inspectNinetyNineFoodProviderStatusForReconciliation>>;
        try {
          observation = await inspectNinetyNineFoodProviderStatusForReconciliation({
            tenantId,
            executionId: claim.executionId,
            externalOrderId: claim.externalOrderId,
            targetStatus: claim.targetStatus,
          });
        } catch (error) {
          observation = {
            outcome: 'uncertain',
            providerLastEvent: '',
            providerStatus: '',
            warning: error instanceof Error
              ? `A leitura da 99Food não pôde confirmar o resultado: ${error.message}`.slice(0, 500)
              : 'A leitura da 99Food não pôde confirmar o resultado. A execução continua bloqueada para nova conferência manual.',
          };
        }

        const finalized = await finalizeNinetyNineFoodStatusSyncReconciliation({
          tenantId,
          claim,
          outcome: observation.outcome,
          providerLastEvent: observation.providerLastEvent,
          providerStatus: observation.providerStatus,
          warning: observation.warning,
        });
        response.status(finalized.outcome === 'confirmed' ? 200 : 202).json({
          executionId: claim.executionId,
          orderId: claim.orderId,
          externalOrderId: claim.externalOrderId,
          targetStatus: claim.targetStatus,
          reconciliation: finalized.outcome,
          providerLastEvent: observation.providerLastEvent,
          providerStatus: observation.providerStatus,
          warning: observation.warning,
          orderMarkerFinalized: finalized.orderMarkerFinalized,
          localStatusChanged: finalized.localStatusChanged,
          providerWriteAttempted: false,
          localTransitionApplied: false,
        });
      } catch (error) {
        errorResponse(response, error);
      }
    }
  );

  router.post('/:orderId/provider-sync/99food', async (request, response) => {
    try {
      const tenantId = await authenticatedTenantId(request);
      const orderId = clean(request.params.orderId);
      const authorization = parseAuthorization(request.body?.providerWriteAuthorization);
      if (!authorization) {
        throw new Error('Autorização 99Food vinculada à revisão do pedido é inválida.');
      }

      const claim = await claimNinetyNineFoodStatusSyncExecution({
        tenantId,
        orderId,
        status: authorization.status,
        expectedOrderRevision: authorization.orderRevision,
        authorizedByUserId: tenantId,
      });
      await markNinetyNineFoodProviderWriteStarted({
        tenantId,
        executionId: claim.executionId,
        orderId: claim.orderId,
      });

      try {
        await writeNinetyNineFoodOrderStatusToProvider({
          tenantId,
          orderId: claim.orderId,
          externalOrderId: claim.externalOrderId,
          status: claim.status,
          reason: claim.reason,
        });
        const finalized = await finalizeNinetyNineFoodStatusSyncExecution({
          tenantId,
          claim,
          outcome: 'sent',
        });
        if (finalized.concurrentStatusChange || !finalized.orderMarkerFinalized) {
          response.status(202).json({
            orderId: claim.orderId,
            externalOrderId: claim.externalOrderId,
            status: claim.status,
            executionId: claim.executionId,
            partnerSync: 'attention',
            partnerWarning: 'A 99Food recebeu o provider write, mas a revisão local não permaneceu estável até a finalização. Revise o pedido antes de qualquer novo envio.',
            localTransitionApplied: false,
            orderRevision: claim.expectedOrderRevision,
          });
          return;
        }
        response.json({
          orderId: claim.orderId,
          externalOrderId: claim.externalOrderId,
          status: claim.status,
          executionId: claim.executionId,
          partnerSync: 'sent',
          partnerWarning: '',
          localTransitionApplied: false,
          orderRevision: claim.expectedOrderRevision,
        });
      } catch (error) {
        const partnerWarning = error instanceof Error ? error.message : String(error);
        if (isNinetyNineFoodProviderWriteOutcomeUnknown(error)) {
          await markNinetyNineFoodProviderWriteOutcomeUnknown({
            tenantId,
            executionId: claim.executionId,
            orderId: claim.orderId,
            warning: partnerWarning,
          }).catch(markError => {
            console.error('[99Food Status Sync Execution] Ambiguous provider outcome marker failed.', markError);
          });
          response.status(202).json({
            orderId: claim.orderId,
            externalOrderId: claim.externalOrderId,
            status: claim.status,
            executionId: claim.executionId,
            partnerSync: 'reconciliation_required',
            partnerWarning: partnerWarning || 'A resposta externa ficou ambígua. Confira o estado na 99Food antes de qualquer novo envio.',
            localTransitionApplied: false,
            orderRevision: claim.expectedOrderRevision,
          });
          return;
        }
        await finalizeNinetyNineFoodStatusSyncExecution({
          tenantId,
          claim,
          outcome: 'attention',
          providerWarning: partnerWarning,
        }).catch(finalizeError => {
          console.error('[99Food Status Sync Execution] Provider failure finalization failed.', finalizeError);
        });
        response.status(202).json({
          orderId: claim.orderId,
          externalOrderId: claim.externalOrderId,
          status: claim.status,
          executionId: claim.executionId,
          partnerSync: 'attention',
          partnerWarning,
          localTransitionApplied: false,
          orderRevision: claim.expectedOrderRevision,
        });
      }
    } catch (error) {
      errorResponse(response, error);
    }
  });

  router.post('/:orderId/status', (request, response, next) => {
    void serializeNinetyNineFoodStatusMutation(request, response, next);
  });

  return router;
};
