import { FieldValue, type DocumentSnapshot } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
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

const integrationData = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const order = value as Record<string, unknown>;
  return order.integration && typeof order.integration === 'object' && !Array.isArray(order.integration)
    ? order.integration as Record<string, unknown>
    : {};
};

export const orderDocumentRevision = (
  snapshot: Pick<DocumentSnapshot, 'updateTime'>
): string => {
  const updateTime = snapshot.updateTime;
  if (!updateTime) return '';
  return `${updateTime.seconds}:${updateTime.nanoseconds}`;
};

export const assertNoNinetyNineFoodStatusSyncExecution = (
  orderValue: unknown
): void => {
  const integration = integrationData(orderValue);
  if (
    clean(integration.provider) === '99food' &&
    clean(integration.outboundStatus) === 'executing'
  ) {
    throw new Error(
      'A sincronização externa 99Food deste pedido está em execução. Aguarde a conclusão antes de alterar o status.'
    );
  }
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
}): Promise<{ orderMarkerFinalized: boolean }> => {
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
    const completedAt = new Date().toISOString();
    const warning = clean(input.providerWarning).slice(0, 500);

    transaction.update(executionReference, {
      status: input.outcome === 'sent' ? 'provider_write_succeeded' : 'provider_write_failed',
      providerWarning: warning || FieldValue.delete(),
      completedAt,
      orderMarkerFinalized: ownsOrderMarker,
      updatedAt: FieldValue.serverTimestamp(),
    });

    if (ownsOrderMarker) {
      transaction.update(orderReference, {
        'integration.outboundStatus': input.outcome === 'sent' ? 'sent' : 'attention',
        'integration.outboundTargetStatus': input.outcome === 'sent'
          ? FieldValue.delete()
          : input.claim.status,
        'integration.outboundError': input.outcome === 'sent' || !warning
          ? FieldValue.delete()
          : warning,
        'integration.outboundExecutionId': FieldValue.delete(),
        'integration.outboundExecutionRevision': FieldValue.delete(),
        'integration.outboundExecutionStartedAt': FieldValue.delete(),
        'integration.outboundUpdatedAt': completedAt,
      });
    }

    return { orderMarkerFinalized: ownsOrderMarker };
  });
};
