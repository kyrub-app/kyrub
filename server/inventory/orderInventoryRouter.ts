import { Router, type Request, type Response } from 'express';
import { FieldValue } from 'firebase-admin/firestore';
import { verifyFirebaseIdToken } from '../ai/consultantAuth';
import { authorizeInPersonOrderOperator } from '../attendance/inPersonOrderService.js';
import { canStoreRoleTransitionOrderStatus } from '../../src/utils/storeSecurity.js';
import { publishKyrubDeliveryOpportunity, withdrawUnclaimedKyrubDeliveryOpportunity } from '../delivery/deliveryOpportunityRouter';
import { ConsultantHttpError } from '../ai/types';
import { adminDb } from '../firebaseAdmin';
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
  try {
    return (await verifyFirebaseIdToken(token)).uid;
  } catch (error) {
    if (error instanceof ConsultantHttpError && error.status === 503) {
      throw new Error('AUTH_UNAVAILABLE');
    }
    throw new Error('AUTH_REQUIRED');
  }
};
type OrderActorAuthority = {
  tenantId: string;
  actorId: string;
  role: 'owner' | 'manager' | 'cashier' | 'seller' | 'production';
  isStaff: boolean;
};

// The store reference comes from a request target, never from a claimed client role.
// For staff, re-check active server-side canonical membership on EACH operation.
const authorizeOrderActor = async (
  request: Request,
  requestedStoreId: unknown
): Promise<OrderActorAuthority> => {
  const actorId = await authenticatedTenantId(request);
  const tenantId = clean(requestedStoreId) || actorId;
  if (!tenantId || tenantId.includes('/')) throw new Error('STORE_ORDER_ACCESS_FORBIDDEN');
  if (tenantId === actorId) return { tenantId, actorId, role: 'owner', isStaff: false };
  const membership = await authorizeInPersonOrderOperator({
    legacyStoreId: tenantId,
    authenticatedUserId: actorId,
    permission: 'orders.read',
  });
  return { tenantId, actorId, role: membership.role, isStaff: true };
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
  if (message === 'AUTH_UNAVAILABLE') {
    response.status(503).json({
      error: 'Não foi possível validar sua sessão agora. Tente novamente em instantes.',
    });
    return;
  }
  if (message === 'STORE_ORDER_ACCESS_FORBIDDEN' || message === 'IN_PERSON_ORDER_FORBIDDEN') {
    response.status(403).json({
      error: 'Sua função não autoriza esta operação sobre os pedidos da loja.',
      code: 'STORE_ORDER_ACCESS_FORBIDDEN',
    });
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
  if (message === 'PAYMENT_REQUIRED_FOR_PRODUCTION') {
    response.status(409).json({
      error: 'O pedido foi aceito, mas o Pix ainda não foi confirmado. Aguarde a confirmação antes de iniciar a produção.',
      code: message,
    });
    return;
  }
  if (message === 'STAFF_PAID_ORDER_REJECTION_REQUIRES_REFUND_REVIEW') {
    response.status(409).json({
      error: 'Este pedido possui pagamento. Solicite revisão gerencial antes de recusá-lo.',
      code: message,
    });
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

const resolveCanonicalOrderStoreId = async (tenantId: string): Promise<string> => {
  if (!tenantId || tenantId.includes('/')) {
    throw new Error('Identificação da loja inválida.');
  }
  const tenantSnapshot = await adminDb.doc(`tenants/${tenantId}`).get();
  const canonicalStoreId = clean(tenantSnapshot.data()?.canonicalStoreId);
  if (!canonicalStoreId || canonicalStoreId.includes('/')) {
    throw new Error('Loja sem identidade canônica configurada.');
  }
  return canonicalStoreId;
};

const orderReference = async (tenantId: string, orderId: string) => {
  if (!orderId || orderId.includes('/')) throw new Error('Identificação do pedido inválida.');
  return adminDb.doc(`stores/${await resolveCanonicalOrderStoreId(tenantId)}/orders/${orderId}`);
};

const orderCollection = async (tenantId: string) =>
  adminDb.collection(`stores/${await resolveCanonicalOrderStoreId(tenantId)}/orders`);

const persistDeliveryProvider = async (
  tenantId: string,
  orderId: string,
  deliveryProvider: DeliveryProvider
): Promise<void> => {
  const tenantSnapshot = await adminDb.doc(`tenants/${tenantId}`).get();
  const canonicalStoreId = clean(tenantSnapshot.data()?.canonicalStoreId);
  if (!canonicalStoreId || canonicalStoreId.includes('/') ||
      !orderId || orderId.includes('/')) {
    throw new Error('Loja ou pedido sem identidade canônica válida.');
  }
  const orderRef = adminDb.doc(`stores/${canonicalStoreId}/orders/${orderId}`);
  await adminDb.runTransaction(async transaction => {
    const orderSnapshot = await transaction.get(orderRef);
    if (!orderSnapshot.exists) throw new Error('Pedido canônico não encontrado.');
    transaction.update(orderRef, {
      deliveryProvider,
      deliveryProviderChosenAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  });
};

const finalizeManualPartnerSync = async (
  tenantId: string,
  orderId: string,
  executionId: string,
  outcome: 'sent' | 'reconciliation_required',
  status: InventoryOrderStatus,
  reason: string,
  message = ''
): Promise<boolean> => {
  const reference = await orderReference(tenantId, orderId);
  const executionReference = adminDb.collection('ninetyNineFoodStatusSyncExecutions').doc(executionId);
  return adminDb.runTransaction(async transaction => {
    const [orderSnapshot, executionSnapshot] = await Promise.all([
      transaction.get(reference),
      transaction.get(executionReference),
    ]);
    const integrationValue = orderSnapshot.data()?.integration;
    const integration = integrationValue && typeof integrationValue === 'object' && !Array.isArray(integrationValue)
      ? integrationValue as Record<string, unknown> : {};
    const execution = executionSnapshot.data();
    if (
      !orderSnapshot.exists || !executionSnapshot.exists ||
      clean(integration?.outboundExecutionId) !== executionId ||
      clean(integration?.outboundStatus) !== 'executing' ||
      clean(integration?.provider) !== '99food' ||
      clean(integration?.outboundTargetStatus) !== status ||
      clean(execution?.status) !== 'provider_write_started' ||
      clean(execution?.provider) !== '99food' ||
      clean(execution?.targetStatus) !== status ||
      clean(execution?.tenantId) !== tenantId ||
      clean(execution?.orderId) !== orderId ||
      clean(execution?.externalOrderId) !== clean(integration?.externalOrderId)
    ) return false;
    const now = new Date().toISOString();
    transaction.update(reference, {
      'integration.outboundStatus': outcome,
      'integration.outboundReconciliationReason': outcome === 'sent'
        ? FieldValue.delete() : 'provider_outcome_unknown',
      'integration.outboundTargetStatus': outcome === 'sent' ? FieldValue.delete() : status,
      'integration.outboundReason': outcome === 'sent' ? FieldValue.delete() : (reason || FieldValue.delete()),
      'integration.outboundError': outcome === 'sent' ? FieldValue.delete() : message.slice(0, 500),
      'integration.outboundUpdatedAt': now,
    });
    transaction.update(executionReference, {
      status: outcome === 'sent' ? 'completed' : 'provider_write_outcome_unknown',
      updatedAt: FieldValue.serverTimestamp(),
      ...(outcome === 'sent' ? { completedAt: now } : { providerWarning: message.slice(0, 500) }),
    });
    return true;
  });
};

// Legacy status endpoint markers. These do not claim ownership of a manual
// outbound execution; an uncertain provider response must remain reconcilable.
const markPartnerSyncSuccess = async (tenantId: string, orderId: string): Promise<void> => {
  await (await orderReference(tenantId, orderId)).update({
    'integration.outboundStatus': 'sent',
    'integration.outboundTargetStatus': FieldValue.delete(),
    'integration.outboundReason': FieldValue.delete(),
    'integration.outboundError': FieldValue.delete(),
    'integration.outboundUpdatedAt': new Date().toISOString(),
  });
};

const markPartnerSyncError = async (
  tenantId: string,
  orderId: string,
  status: InventoryOrderStatus,
  reason: string,
  warning: string
): Promise<void> => {
  await (await orderReference(tenantId, orderId)).update({
    'integration.outboundStatus': 'reconciliation_required',
    'integration.outboundTargetStatus': status,
    'integration.outboundReason': reason || FieldValue.delete(),
    'integration.outboundError': warning.slice(0, 500),
    'integration.outboundUpdatedAt': new Date().toISOString(),
  });
};

const markPartnerSyncAuthorizationRequired = async (
  tenantId: string,
  orderId: string,
  status: InventoryOrderStatus,
  reason: string
): Promise<void> => {
  await (await orderReference(tenantId, orderId)).update({
    'integration.outboundStatus': 'authorization_required',
    'integration.outboundTargetStatus': status,
    'integration.outboundReason': reason || FieldValue.delete(),
    'integration.outboundError': FieldValue.delete(),
    'integration.outboundUpdatedAt': new Date().toISOString(),
  });
};

const listNinetyNineFoodReconciliationCases = async (tenantId: string, cursor = '') => {
  const collection = await orderCollection(tenantId);
  if (cursor && (!/^[a-zA-Z0-9_-]{1,256}$/.test(cursor))) {
    throw new Error('Cursor de reconciliação inválido.');
  }
  const cursorDocument = cursor ? await collection.doc(cursor).get() : null;
  if (cursor) {
    const cursorIntegration = cursorDocument?.data()?.integration as Record<string, unknown> | undefined;
    if (
      !cursorDocument?.exists ||
      clean(cursorIntegration?.provider) !== '99food' ||
      !['executing', 'reconciliation_required'].includes(clean(cursorIntegration?.outboundStatus))
    ) {
      throw new Error('Cursor de reconciliação inválido ou não pertence à fila 99Food.');
    }
  }
  let query = collection
    .where('integration.outboundStatus', 'in', ['executing', 'reconciliation_required'])
    .orderBy('__name__')
    .limit(101);
  if (cursorDocument) query = query.startAfter(cursorDocument);
  const snapshot = await query.get();
  const truncated = snapshot.size > 100;
  const documents = snapshot.docs.slice(0, 100);
  const now = Date.now();
  const executionIds = [...new Set(documents.map(document => {
    const value = document.data().integration;
    const integration = value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown> : {};
    return clean(integration.outboundExecutionId);
  }).filter(Boolean))];
  // Malformed execution IDs must be reported as mismatches, not abort the entire queue.
  const validExecutionIds = executionIds.filter(id => /^[a-zA-Z0-9_-]{1,256}$/.test(id));
  const executionSnapshots = await Promise.all(validExecutionIds.map(id =>
    adminDb.collection('ninetyNineFoodStatusSyncExecutions').doc(id).get()
  ));
  const executionsById = new Map(executionSnapshots.map(snapshot => [
    snapshot.id, snapshot.exists ? snapshot.data() : undefined,
  ]));
  const items = documents.flatMap(document => {
    const data = document.data() as Record<string, unknown>;
    const integration = data.integration && typeof data.integration === 'object'
      ? data.integration as Record<string, unknown> : {};
    if (clean(integration.provider) !== '99food') return [];
    const outboundStatus = clean(integration.outboundStatus);
    const executionId = clean(integration.outboundExecutionId);
    const execution = executionsById.get(executionId);
    const executionStatus = clean(execution?.status);
    const missingExternalOrderId = !clean(integration.externalOrderId);
    const missingTargetStatus = !clean(integration.outboundTargetStatus);
    const executionAuthorityMismatch = !executionId || !execution ||
      clean(execution.tenantId) !== tenantId ||
      clean(execution.orderId) !== document.id ||
      clean(execution.provider) !== '99food' ||
      clean(execution.externalOrderId) !== clean(integration.externalOrderId) ||
      clean(execution.targetStatus) !== clean(integration.outboundTargetStatus) ||
      !(outboundStatus === 'executing'
        ? ['claimed', 'provider_write_started'].includes(executionStatus)
        : ['provider_write_outcome_unknown', 'reconciliation_uncertain', 'reconciliation_checking'].includes(executionStatus));
    const outboundUpdatedAt = clean(integration.outboundUpdatedAt);
    const updatedMs = Date.parse(outboundUpdatedAt);
    const possiblyInterrupted = outboundStatus === 'executing' &&
      Number.isFinite(updatedMs) && now - updatedMs > 10 * 60 * 1000;
    const missingTimestamp = outboundStatus === 'executing' && !Number.isFinite(updatedMs);
    const futureTimestamp = outboundStatus === 'executing' &&
      Number.isFinite(updatedMs) && updatedMs > now + 5 * 60 * 1000;
    return [{
      orderId: document.id,
      externalOrderId: clean(integration.externalOrderId),
      outboundStatus,
      executionId,
      executionStatus,
      executionAuthorityMismatch,
      missingExternalOrderId,
      missingTargetStatus,
      outboundTargetStatus: clean(integration.outboundTargetStatus),
      outboundUpdatedAt,
      reconciliationReason: clean(integration.outboundReconciliationReason),
      possiblyInterrupted,
      missingTimestamp,
      futureTimestamp,
      requiresOperatorReview: possiblyInterrupted || missingTimestamp || futureTimestamp || executionAuthorityMismatch || missingExternalOrderId || missingTargetStatus || outboundStatus === 'reconciliation_required',
      automaticRetryAllowed: false,
    }];
  });
  return {
    items,
    truncated,
    limit: 100,
    nextCursor: truncated && documents.length ? documents[documents.length - 1].id : null,
  };
};

const listPendingNinetyNineFoodStatusSyncs = async (tenantId: string) => {
  const snapshot = await (await orderCollection(tenantId))
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

  // Staff KDS reads the SAME operational order ledger through a scoped server
  // transport. Never broaden tenant Firestore client rules to expose orders.
  router.get('/kds', async (request, response) => {
    try {
      const storeId = clean(request.query.storeId);
      if (!storeId) throw new Error('STORE_ORDER_ACCESS_FORBIDDEN');
      const { tenantId } = await authorizeOrderActor(request, storeId);
      const tenantSnapshot = await adminDb.doc(`tenants/${tenantId}`).get();
      const canonicalStoreId = clean(tenantSnapshot.data()?.canonicalStoreId);
      if (!canonicalStoreId || canonicalStoreId.includes('/')) {
        throw new Error('Loja sem identidade canônica configurada.');
      }
      const snapshot = await adminDb.collection(`stores/${canonicalStoreId}/orders`)
        .orderBy('createdAt', 'desc')
        .limit(150)
        .get();
      const allowed = [
        'id', 'storeId', 'buyerId', 'buyerName', 'buyerEmail',
        'fulfillmentType', 'deliveryAddress', 'tableCode',
        'serviceLocation', 'customerNote', 'items',
        'subtotal', 'total', 'status', 'paymentStatus',
        'source', 'sourceChannel', 'operatorId', 'operatorName',
        'createdAt', 'updatedAt',
      ];
      const orders = snapshot.docs.map(document => {
        const data = document.data() as Record<string, unknown>;
        const projected = Object.fromEntries(allowed.map(key => [key, data[key]]));
        return { ...projected, id: document.id, storeId: canonicalStoreId };
      });
      response.setHeader('Cache-Control', 'no-store, max-age=0');
      response.status(200).json({ orders });
    } catch (error) {
      errorResponse(response, error);
    }
  });

  router.get('/provider-sync/99food/reconciliation', async (request, response) => {
    try {
      const tenantId = await authenticatedTenantId(request);
      response.setHeader('Cache-Control', 'no-store');
      response.json(await listNinetyNineFoodReconciliationCases(
        tenantId, clean(request.query.cursor)
      ));
    } catch (error) {
      errorResponse(response, error);
    }
  });

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

      const currentSnapshot = await (await orderReference(tenantId, orderId)).get();
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

      const syncReference = await orderReference(tenantId, orderId);
      const executionReference = adminDb.collection('ninetyNineFoodStatusSyncExecutions').doc();
      await adminDb.runTransaction(async transaction => {
        const latest = await transaction.get(syncReference);
        if (!latest.exists) throw new Error('Pedido não encontrado.');
        const latestData = latest.data() as Record<string, unknown>;
        const latestIntegration = latestData.integration && typeof latestData.integration === 'object'
          ? latestData.integration as Record<string, unknown> : {};
        const latestStatus = clean(latestData.status);
        const latestTarget = clean(latestIntegration.outboundTargetStatus) || latestStatus;
        if (
          clean(latestIntegration.provider) !== '99food' ||
          !PENDING_PARTNER_SYNC_STATUSES.has(clean(latestIntegration.outboundStatus)) ||
          latestStatus !== providerWriteAuthorization.status ||
          latestTarget !== providerWriteAuthorization.status ||
          clean(latestIntegration.externalOrderId) !== externalOrderId
        ) {
          throw new Error('O status do pedido mudou desde a autorização 99Food. Revise a fila e confirme novamente.');
        }
        transaction.create(executionReference, {
          tenantId,
          orderId,
          provider: '99food',
          externalOrderId,
          status: 'provider_write_started',
          targetStatus: providerWriteAuthorization.status,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
        transaction.update(syncReference, {
          'integration.outboundStatus': 'executing',
          'integration.outboundExecutionId': executionReference.id,
          'integration.outboundReconciliationReason': FieldValue.delete(),
          'integration.outboundTargetStatus': providerWriteAuthorization.status,
          'integration.outboundUpdatedAt': new Date().toISOString(),
        });
      });

      try {
        await sendNinetyNineFoodOrderStatus(
          tenantId,
          externalOrderId,
          providerWriteAuthorization.status,
          reason
        );
        const finalized = await finalizeManualPartnerSync(
          tenantId, orderId, executionReference.id, 'sent',
          providerWriteAuthorization.status, reason
        );
        response.status(finalized ? 200 : 202).json({
          orderId,
          externalOrderId,
          status: providerWriteAuthorization.status,
          partnerSync: finalized ? 'sent' : 'reconciliation_required',
          partnerWarning: finalized ? '' : 'A autoridade inbound alterou a execução; verifique a reconciliação.',
          localTransitionApplied: false,
        });
      } catch (error) {
        const partnerWarning = error instanceof Error ? error.message : String(error);
        await finalizeManualPartnerSync(
          tenantId, orderId, executionReference.id, 'reconciliation_required',
          providerWriteAuthorization.status, reason, partnerWarning
        ).catch(markError => {
          console.error('[Order Inventory] Partner sync marker failed.', markError);
        });
        response.status(202).json({
          orderId,
          externalOrderId,
          status: providerWriteAuthorization.status,
          partnerSync: 'reconciliation_required',
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
      const authority = await authorizeOrderActor(request, request.body?.storeId);
      const { tenantId } = authority;
      const orderId = request.params.orderId;
      const status = typeof request.body?.status === 'string'
        ? request.body.status as InventoryOrderStatus
        : 'pending';
      if (!SUPPORTED_STATUSES.has(status)) {
        response.status(400).json({ error: 'Status do pedido não suportado.' });
        return;
      }
      if (authority.isStaff && !canStoreRoleTransitionOrderStatus(authority.role, status)) {
        throw new Error('STORE_ORDER_ACCESS_FORBIDDEN');
      }
      if (authority.isStaff && request.body?.providerWriteAuthorization !== undefined) {
        // External marketplace provider writes remain owner-only.
        throw new Error('STORE_ORDER_ACCESS_FORBIDDEN');
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
      const tenantSnapshot = await adminDb.doc(`tenants/${tenantId}`).get();
      const canonicalStoreId = clean(tenantSnapshot.data()?.canonicalStoreId);
      if (!canonicalStoreId || canonicalStoreId.includes('/')) {
        throw new Error('Loja sem identidade canônica configurada.');
      }
      const currentSnapshot = await adminDb.doc(`stores/${canonicalStoreId}/orders/${orderId}`).get();
      const currentData = currentSnapshot.data() as Record<string, unknown> | undefined;
      const currentIntegration =
        currentData?.integration && typeof currentData.integration === 'object'
          ? currentData.integration as Record<string, unknown>
          : {};
      const currentProvider = clean(currentIntegration.provider);
      // The canonical payment gate also applies to Staff routes. Taking over
      // production never means the Pix/merchant-approved payment was captured.
      if (
        ['preparing', 'ready', 'out_for_delivery', 'completed'].includes(status) &&
        currentSnapshot.exists &&
        clean(currentData?.checkoutAuthority) === 'merchant_approval_required' &&
        clean(currentData?.paymentStatus) !== 'paid'
      ) {
        throw new Error('PAYMENT_REQUIRED_FOR_PRODUCTION');
      }
      if (
        authority.isStaff &&
        status === 'rejected' &&
        currentSnapshot.exists &&
        ['paid', 'partial'].includes(clean(currentData?.paymentStatus))
      ) {
        throw new Error('STAFF_PAID_ORDER_REJECTION_REQUIRES_REFUND_REVIEW');
      }
      if (authority.isStaff && currentProvider === '99food') {
        throw new Error('STORE_ORDER_ACCESS_FORBIDDEN');
      }

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

      // KDS/ERP transitions publish Kyrub deliveries from the canonical order.
      // Publishing is idempotent; failures must not roll back an already committed
      // order status transition or silently pretend the delivery was advertised.
      let deliveryPublication: 'not-applicable' | 'published' | 'attention' = 'not-applicable';
      let deliveryPublicationWarning = '';
      if (['preparing', 'ready', 'out_for_delivery'].includes(result.status)) {
        const updatedOrder = await (await orderReference(tenantId, result.orderId)).get();
        const updatedData = updatedOrder.data() as Record<string, unknown> | undefined;
        if (updatedData?.fulfillmentType === 'delivery' && clean(updatedData.deliveryProvider) === 'kyrub') {
          try {
            await publishKyrubDeliveryOpportunity(tenantId, result.orderId);
            deliveryPublication = 'published';
          } catch (error) {
            deliveryPublication = 'attention';
            deliveryPublicationWarning = error instanceof Error ? error.message : String(error);
            console.error('[Order Inventory] Kyrub delivery publication needs attention.', error);
          }
        }
      }

      let deliveryWithdrawal: 'not-applicable' | 'withdrawn' | 'claimed' | 'missing' | 'attention' = 'not-applicable';
      if (['cancelled', 'rejected'].includes(result.status)) {
        try {
          deliveryWithdrawal = await withdrawUnclaimedKyrubDeliveryOpportunity(tenantId, result.orderId);
        } catch (error) {
          deliveryWithdrawal = 'attention';
          console.error('[Order Inventory] Kyrub delivery withdrawal needs attention.', error);
        }
      }

      response.json({
        ...result,
        partnerSync,
        partnerWarning,
        deliveryPublication,
        deliveryPublicationWarning,
        deliveryWithdrawal,
      });
    } catch (error) {
      errorResponse(response, error);
    }
  });

  return router;
};
