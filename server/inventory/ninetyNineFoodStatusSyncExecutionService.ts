import { FieldValue, type DocumentSnapshot } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import type { InventoryOrderStatus } from '../../shared/inventoryConsumption.js';

const STATUS_MUTATION_LEASE_MS = 2 * 60 * 1000;

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

const integrationData = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const order = value as Record<string, unknown>;
  return order.integration && typeof order.integration === 'object' && !Array.isArray(order.integration)
    ? order.integration as Record<string, unknown>
    : {};
};

const activeStatusMutationId = (integration: Record<string, unknown>): string => {
  const mutationId = clean(integration.statusMutationExecutionId);
  const leaseExpiresAt = Date.parse(clean(integration.statusMutationLeaseExpiresAt));
  return mutationId && Number.isFinite(leaseExpiresAt) && leaseExpiresAt > Date.now()
    ? mutationId
    : '';
};

export const orderDocumentRevision = (
  snapshot: Pick<DocumentSnapshot, 'updateTime'>
): string => {
  const updateTime = snapshot.updateTime;
  if (!updateTime) return '';
  return `${updateTime.seconds}:${updateTime.nanoseconds}`;
};

export interface OrderStatusMutationClaim {
  mutationId: string;
  tenantId: string;
  orderId: string;
}

export const claimOrderStatusMutation = async (input: {
  tenantId: string;
  orderId: string;
}): Promise<OrderStatusMutationClaim> => {
  const tenantId = clean(input.tenantId);
  const orderId = clean(input.orderId);
  if (!tenantId || !orderId) throw new Error('Pedido não identificado.');

  const orderReference = adminDb.doc(
    `artifacts/${tenantId}/public/data/customerOrders/${orderId}`
  );
  const mutationId = orderReference.collection('statusMutationClaims').doc().id;

  return adminDb.runTransaction(async transaction => {
    const snapshot = await transaction.get(orderReference);
    if (!snapshot.exists) throw new Error('Pedido não encontrado.');
    const integration = integrationData(snapshot.data());
    if (
      clean(integration.provider) === '99food' &&
      clean(integration.outboundStatus) === 'executing'
    ) {
      throw new Error(
        'A sincronização externa 99Food deste pedido está em execução. Aguarde a conclusão antes de alterar o status.'
      );
    }
    if (activeStatusMutationId(integration)) {
      throw new Error(
        'Outra mudança de status deste pedido já está em execução. Atualize o pedido e tente novamente.'
      );
    }

    const claimedAt = new Date().toISOString();
    const leaseExpiresAt = new Date(Date.now() + STATUS_MUTATION_LEASE_MS).toISOString();
    transaction.update(orderReference, {
      'integration.statusMutationExecutionId': mutationId,
      'integration.statusMutationClaimedAt': claimedAt,
      'integration.statusMutationLeaseExpiresAt': leaseExpiresAt,
    });
    return { mutationId, tenantId, orderId };
  });
};

export const releaseOrderStatusMutation = async (
  claim: OrderStatusMutationClaim
): Promise<void> => {
  const orderReference = adminDb.doc(
    `artifacts/${claim.tenantId}/public/data/customerOrders/${claim.orderId}`
  );
  await adminDb.runTransaction(async transaction => {
    const snapshot = await transaction.get(orderReference);
    if (!snapshot.exists) return;
    const integration = integrationData(snapshot.data());
    if (clean(integration.statusMutationExecutionId) !== claim.mutationId) return;
    transaction.update(orderReference, {
      'integration.statusMutationExecutionId': FieldValue.delete(),
      'integration.statusMutationClaimedAt': FieldValue.delete(),
      'integration.statusMutationLeaseExpiresAt': FieldValue.delete(),
    });
  });
};

export interface NinetyNineFoodStatusSyncExecutionClaim {
  executionId: string;
  orderId: string;
  externalOrderId: string;
  status: InventoryOrderStatus;
  reason: string;
  expectedOrderRevision: string;
}

export const claimNinetyNineFoodStatusSyncExecution = async (input: {
  tenantId: string;
  orderId: string;
  status: InventoryOrderStatus;
  expectedOrderRevision: string;
  authorizedByUserId: string;
}): Promise<NinetyNineFoodStatusSyncExecutionClaim> => {
  const tenantId = clean(input.tenantId);
  const orderId = clean(input.orderId);
  const expectedOrderRevision = clean(input.expectedOrderRevision);
  const authorizedByUserId = clean(input.authorizedByUserId);
  if (
    !tenantId ||
    !orderId ||
    !expectedOrderRevision ||
    !authorizedByUserId ||
    !SUPPORTED_STATUSES.has(input.status)
  ) {
    throw new Error('Autorização 99Food vinculada à revisão do pedido é inválida.');
  }

  const orderReference = adminDb.doc(
    `artifacts/${tenantId}/public/data/customerOrders/${orderId}`
  );
  const executionReference = orderReference
    .collection('providerStatusExecutions')
    .doc();
  const executionId = executionReference.id;

  return adminDb.runTransaction(async transaction => {
    const snapshot = await transaction.get(orderReference);
    if (!snapshot.exists) throw new Error('Pedido não encontrado.');
    const actualRevision = orderDocumentRevision(snapshot);
    if (!actualRevision || actualRevision !== expectedOrderRevision) {
      throw new Error(
        'O pedido mudou desde a leitura da fila 99Food. Atualize a fila e confirme novamente.'
      );
    }

    const order = snapshot.data() as Record<string, unknown>;
    const integration = integrationData(order);
    const provider = clean(integration.provider);
    const outboundStatus = clean(integration.outboundStatus);
    const currentStatus = clean(order.status) as InventoryOrderStatus;
    const frozenTargetStatus = clean(integration.outboundTargetStatus) as InventoryOrderStatus;
    const expectedStatus = SUPPORTED_STATUSES.has(frozenTargetStatus)
      ? frozenTargetStatus
      : currentStatus;
    const externalOrderId = clean(integration.externalOrderId);
    const reason = clean(integration.outboundReason);

    if (provider !== '99food') {
      throw new Error('Autorização 99Food não corresponde ao provedor deste pedido.');
    }
    if (activeStatusMutationId(integration)) {
      throw new Error(
        'O pedido está executando outra mudança de status. Atualize a fila 99Food e confirme novamente depois.'
      );
    }
    if (!PENDING_STATUSES.has(outboundStatus)) {
      throw new Error('Sincronização 99Food deste pedido não está pendente para envio manual.');
    }
    if (
      !SUPPORTED_STATUSES.has(currentStatus) ||
      currentStatus !== input.status ||
      expectedStatus !== input.status
    ) {
      throw new Error(
        'O status do pedido mudou desde a autorização 99Food. Revise a fila e confirme novamente.'
      );
    }
    if (!externalOrderId) {
      throw new Error('Pedido 99Food sem identificador externo válido.');
    }

    const startedAt = new Date().toISOString();
    transaction.create(executionReference, {
      executionId,
      tenantId,
      orderId,
      provider: '99food',
      externalOrderId,
      targetStatus: input.status,
      reason,
      expectedOrderRevision,
      authorizedByUserId,
      authority: 'explicit_status_scoped_order_revision',
      status: 'claimed',
      createdAt: FieldValue.serverTimestamp(),
      claimedAt: startedAt,
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.update(orderReference, {
      'integration.outboundStatus': 'executing',
      'integration.outboundExecutionId': executionId,
      'integration.outboundExecutionRevision': expectedOrderRevision,
      'integration.outboundExecutionStartedAt': startedAt,
      'integration.outboundUpdatedAt': startedAt,
      'integration.statusMutationExecutionId': FieldValue.delete(),
      'integration.statusMutationClaimedAt': FieldValue.delete(),
      'integration.statusMutationLeaseExpiresAt': FieldValue.delete(),
    });

    return {
      executionId,
      orderId,
      externalOrderId,
      status: input.status,
      reason,
      expectedOrderRevision,
    };
  });
};

export const finalizeNinetyNineFoodStatusSyncExecution = async (input: {
  tenantId: string;
  claim: NinetyNineFoodStatusSyncExecutionClaim;
  outcome: 'sent' | 'attention';
  providerWarning?: string;
}): Promise<{
  orderMarkerFinalized: boolean;
  concurrentStatusChange: boolean;
}> => {
  const tenantId = clean(input.tenantId);
  const executionId = clean(input.claim.executionId);
  const orderId = clean(input.claim.orderId);
  if (!tenantId || !executionId || !orderId) {
    throw new Error('Execução 99Food não identificada para finalização.');
  }

  const orderReference = adminDb.doc(
    `artifacts/${tenantId}/public/data/customerOrders/${orderId}`
  );
  const executionReference = orderReference
    .collection('providerStatusExecutions')
    .doc(executionId);

  return adminDb.runTransaction(async transaction => {
    const [orderSnapshot, executionSnapshot] = await Promise.all([
      transaction.get(orderReference),
      transaction.get(executionReference),
    ]);
    if (!executionSnapshot.exists) {
      throw new Error('Execução 99Food não encontrada para finalização.');
    }

    const order = orderSnapshot.data() as Record<string, unknown> | undefined;
    const integration = integrationData(order);
    const ownsOrderMarker =
      orderSnapshot.exists &&
      clean(integration.provider) === '99food' &&
      clean(integration.outboundStatus) === 'executing' &&
      clean(integration.outboundExecutionId) === executionId;
    const concurrentStatusChange =
      orderSnapshot.exists && clean(order?.status) !== input.claim.status;
    const completedAt = new Date().toISOString();
    const explicitWarning = clean(input.providerWarning).slice(0, 500);
    const warning = concurrentStatusChange
      ? 'O status local mudou durante o provider write 99Food. A execução exige conciliação manual antes de novo envio.'
      : explicitWarning;
    const effectiveOutcome =
      input.outcome === 'sent' && concurrentStatusChange ? 'attention' : input.outcome;

    transaction.update(executionReference, {
      status: effectiveOutcome === 'sent'
        ? 'provider_write_succeeded'
        : concurrentStatusChange
          ? 'provider_write_requires_reconciliation'
          : 'provider_write_failed',
      providerWarning: warning || FieldValue.delete(),
      completedAt,
      orderMarkerFinalized: ownsOrderMarker,
      concurrentStatusChange,
      updatedAt: FieldValue.serverTimestamp(),
    });

    if (ownsOrderMarker) {
      transaction.update(orderReference, {
        'integration.outboundStatus': effectiveOutcome === 'sent' ? 'sent' : 'attention',
        'integration.outboundTargetStatus': effectiveOutcome === 'sent'
          ? FieldValue.delete()
          : input.claim.status,
        'integration.outboundError': effectiveOutcome === 'sent' || !warning
          ? FieldValue.delete()
          : warning,
        'integration.outboundExecutionId': FieldValue.delete(),
        'integration.outboundExecutionRevision': FieldValue.delete(),
        'integration.outboundExecutionStartedAt': FieldValue.delete(),
        'integration.outboundUpdatedAt': completedAt,
      });
    }

    return { orderMarkerFinalized: ownsOrderMarker, concurrentStatusChange };
  });
};
