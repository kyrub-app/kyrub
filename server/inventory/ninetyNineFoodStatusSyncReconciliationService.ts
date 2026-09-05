import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import type { InventoryOrderStatus } from '../../shared/inventoryConsumption.js';

const STATUS_SYNC_EXECUTION_COLLECTION = 'ninetyNineFoodStatusSyncExecutions';
const ORPHAN_AFTER_MS = 2 * 60 * 1000;
const RECONCILIATION_LEASE_MS = 60 * 1000;

const RECOVERABLE_EXECUTION_STATUSES = new Set([
  'claimed',
  'provider_write_started',
  'provider_write_outcome_unknown',
  'reconciliation_uncertain',
  'reconciliation_checking',
]);

const SUPPORTED_STATUSES = new Set<InventoryOrderStatus>([
  'accepted',
  'preparing',
  'ready',
  'out_for_delivery',
  'completed',
  'rejected',
  'cancelled',
]);

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const integrationData = (value: unknown): Record<string, unknown> => {
  const order = record(value);
  return record(order.integration);
};

const orderReference = (tenantId: string, orderId: string) =>
  adminDb.doc(`artifacts/${tenantId}/public/data/customerOrders/${orderId}`);

const executionReference = (executionId: string) =>
  adminDb.doc(`${STATUS_SYNC_EXECUTION_COLLECTION}/${executionId}`);

const parseTime = (value: unknown): number => {
  const parsed = Date.parse(clean(value));
  return Number.isFinite(parsed) ? parsed : 0;
};

const executionReadyForReconciliation = (
  execution: Record<string, unknown>,
  now = Date.now()
): boolean => {
  const status = clean(execution.status);
  if (!RECOVERABLE_EXECUTION_STATUSES.has(status)) return false;
  if (status === 'provider_write_outcome_unknown' || status === 'reconciliation_uncertain') {
    return true;
  }
  if (status === 'reconciliation_checking') {
    const leaseExpiresAt = parseTime(execution.reconciliationLeaseExpiresAt);
    return leaseExpiresAt > 0 && leaseExpiresAt <= now;
  }
  const referenceTime = status === 'provider_write_started'
    ? parseTime(execution.providerWriteStartedAt) || parseTime(execution.claimedAt)
    : parseTime(execution.claimedAt);
  return referenceTime > 0 && now - referenceTime >= ORPHAN_AFTER_MS;
};

const executionAgeMs = (
  execution: Record<string, unknown>,
  now = Date.now()
): number => {
  const referenceTime =
    parseTime(execution.providerWriteStartedAt) ||
    parseTime(execution.claimedAt) ||
    parseTime(execution.reconciliationStartedAt);
  return referenceTime > 0 ? Math.max(0, now - referenceTime) : 0;
};

export const isNinetyNineFoodProviderWriteOutcomeUnknown = (error: unknown): boolean => {
  if (!(error instanceof Error)) return true;
  const message = error.message.trim();
  const httpStatus = /^Open Delivery respondeu (\d{3})/i.exec(message)?.[1];
  if (httpStatus) {
    const status = Number(httpStatus);
    if (status >= 400 && status < 500) return false;
    return true;
  }
  if (
    /não está configurada|não encontrado no Kyrub|identidade externa 99Food|status local do pedido mudou antes do provider write|sem identificador externo|não retornou access_token/i.test(message)
  ) {
    return false;
  }
  if (
    error.name === 'AbortError' ||
    error.name === 'TimeoutError' ||
    error instanceof TypeError ||
    /fetch failed|network|socket|ECONN|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|aborted|timeout/i.test(message)
  ) {
    return true;
  }
  return true;
};

export const markNinetyNineFoodProviderWriteStarted = async (input: {
  tenantId: string;
  executionId: string;
  orderId: string;
}): Promise<void> => {
  const tenantId = clean(input.tenantId);
  const executionId = clean(input.executionId);
  const orderId = clean(input.orderId);
  if (!tenantId || !executionId || !orderId) {
    throw new Error('Execução 99Food não identificada antes do provider write.');
  }
  const orderRef = orderReference(tenantId, orderId);
  const executionRef = executionReference(executionId);
  await adminDb.runTransaction(async transaction => {
    const [orderSnapshot, executionSnapshot] = await Promise.all([
      transaction.get(orderRef),
      transaction.get(executionRef),
    ]);
    const execution = record(executionSnapshot.data());
    const integration = integrationData(orderSnapshot.data());
    if (
      !executionSnapshot.exists ||
      clean(execution.tenantId) !== tenantId ||
      clean(execution.orderId) !== orderId ||
      clean(execution.status) !== 'claimed' ||
      !orderSnapshot.exists ||
      clean(integration.provider) !== '99food' ||
      clean(integration.outboundStatus) !== 'executing' ||
      clean(integration.outboundExecutionId) !== executionId
    ) {
      throw new Error('A execução 99Food perdeu a autoridade antes do provider write.');
    }
    const providerWriteStartedAt = new Date().toISOString();
    transaction.update(executionRef, {
      status: 'provider_write_started',
      providerWriteStartedAt,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
};

export const markNinetyNineFoodProviderWriteOutcomeUnknown = async (input: {
  tenantId: string;
  executionId: string;
  orderId: string;
  warning: string;
}): Promise<void> => {
  const tenantId = clean(input.tenantId);
  const executionId = clean(input.executionId);
  const orderId = clean(input.orderId);
  const warning = clean(input.warning).slice(0, 500) ||
    'A resposta da 99Food não chegou ao Kyrub. O resultado externo precisa ser reconciliado antes de qualquer novo envio.';
  const orderRef = orderReference(tenantId, orderId);
  const executionRef = executionReference(executionId);
  await adminDb.runTransaction(async transaction => {
    const [orderSnapshot, executionSnapshot] = await Promise.all([
      transaction.get(orderRef),
      transaction.get(executionRef),
    ]);
    if (!executionSnapshot.exists) return;
    const execution = record(executionSnapshot.data());
    if (clean(execution.tenantId) !== tenantId || clean(execution.orderId) !== orderId) {
      throw new Error('Execução 99Food inconsistente ao registrar resultado desconhecido.');
    }
    const integration = integrationData(orderSnapshot.data());
    const ownsOrderMarker =
      orderSnapshot.exists &&
      clean(integration.provider) === '99food' &&
      clean(integration.outboundExecutionId) === executionId &&
      clean(integration.outboundStatus) === 'executing';
    transaction.update(executionRef, {
      status: 'provider_write_outcome_unknown',
      providerWarning: warning,
      providerWriteOutcomeUnknownAt: new Date().toISOString(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    if (ownsOrderMarker) {
      transaction.update(orderRef, {
        'integration.outboundStatus': 'reconciliation_required',
        'integration.outboundError': warning,
        'integration.outboundUpdatedAt': new Date().toISOString(),
      });
    }
  });
};

export interface NinetyNineFoodStatusSyncReconciliationItem {
  executionId: string;
  orderId: string;
  externalOrderId: string;
  displayId: string;
  customerName: string;
  targetStatus: InventoryOrderStatus;
  executionStatus: string;
  outboundStatus: string;
  warning: string;
  claimedAt: string;
  providerWriteStartedAt: string;
  ageMs: number;
}

export const listNinetyNineFoodStatusSyncReconciliationItems = async (
  tenantIdValue: string
): Promise<NinetyNineFoodStatusSyncReconciliationItem[]> => {
  const tenantId = clean(tenantIdValue);
  if (!tenantId) return [];
  const snapshot = await adminDb
    .collection(STATUS_SYNC_EXECUTION_COLLECTION)
    .where('tenantId', '==', tenantId)
    .limit(100)
    .get();
  const now = Date.now();
  const eligible = snapshot.docs.filter(document =>
    executionReadyForReconciliation(record(document.data()), now)
  );
  const items = await Promise.all(eligible.map(async document => {
    const execution = record(document.data());
    const orderId = clean(execution.orderId);
    const targetStatus = clean(execution.targetStatus) as InventoryOrderStatus;
    const orderSnapshot = orderId
      ? await orderReference(tenantId, orderId).get()
      : null;
    const order = record(orderSnapshot?.data());
    const integration = integrationData(order);
    const executionId = document.id;
    if (
      !orderSnapshot?.exists ||
      clean(execution.provider) !== '99food' ||
      clean(integration.provider) !== '99food' ||
      clean(integration.outboundExecutionId) !== executionId ||
      !['executing', 'reconciliation_required'].includes(clean(integration.outboundStatus)) ||
      !SUPPORTED_STATUSES.has(targetStatus)
    ) {
      return null;
    }
    return {
      executionId,
      orderId,
      externalOrderId: clean(execution.externalOrderId),
      displayId: clean(order.displayId) || clean(order.orderNumber) || clean(execution.externalOrderId),
      customerName: clean(order.customerName) || clean(order.buyerName),
      targetStatus,
      executionStatus: clean(execution.status),
      outboundStatus: clean(integration.outboundStatus),
      warning: clean(execution.providerWarning) || clean(integration.outboundError),
      claimedAt: clean(execution.claimedAt),
      providerWriteStartedAt: clean(execution.providerWriteStartedAt),
      ageMs: executionAgeMs(execution, now),
    } satisfies NinetyNineFoodStatusSyncReconciliationItem;
  }));
  return items
    .filter((item): item is NinetyNineFoodStatusSyncReconciliationItem => Boolean(item))
    .sort((left, right) => right.ageMs - left.ageMs);
};

export interface NinetyNineFoodStatusSyncReconciliationClaim {
  reconciliationId: string;
  executionId: string;
  orderId: string;
  externalOrderId: string;
  targetStatus: InventoryOrderStatus;
}

export const claimNinetyNineFoodStatusSyncReconciliation = async (input: {
  tenantId: string;
  orderId: string;
  executionId: string;
}): Promise<NinetyNineFoodStatusSyncReconciliationClaim> => {
  const tenantId = clean(input.tenantId);
  const orderId = clean(input.orderId);
  const executionId = clean(input.executionId);
  if (!tenantId || !orderId || !executionId) {
    throw new Error('Reconciliação 99Food não identificada.');
  }
  const orderRef = orderReference(tenantId, orderId);
  const executionRef = executionReference(executionId);
  const reconciliationId = adminDb.collection(STATUS_SYNC_EXECUTION_COLLECTION).doc().id;
  return adminDb.runTransaction(async transaction => {
    const [orderSnapshot, executionSnapshot] = await Promise.all([
      transaction.get(orderRef),
      transaction.get(executionRef),
    ]);
    if (!orderSnapshot.exists || !executionSnapshot.exists) {
      throw new Error('Execução órfã 99Food não encontrada.');
    }
    const order = record(orderSnapshot.data());
    const integration = integrationData(order);
    const execution = record(executionSnapshot.data());
    const targetStatus = clean(execution.targetStatus) as InventoryOrderStatus;
    if (
      clean(execution.tenantId) !== tenantId ||
      clean(execution.orderId) !== orderId ||
      clean(execution.provider) !== '99food' ||
      !SUPPORTED_STATUSES.has(targetStatus) ||
      !executionReadyForReconciliation(execution) ||
      clean(integration.provider) !== '99food' ||
      clean(integration.outboundExecutionId) !== executionId ||
      !['executing', 'reconciliation_required'].includes(clean(integration.outboundStatus))
    ) {
      throw new Error('Esta execução 99Food não está pronta para reconciliação manual.');
    }
    const reconciliationStartedAt = new Date().toISOString();
    transaction.update(executionRef, {
      reconciliationPreviousStatus: clean(execution.status),
      status: 'reconciliation_checking',
      reconciliationId,
      reconciliationStartedAt,
      reconciliationLeaseExpiresAt: new Date(Date.now() + RECONCILIATION_LEASE_MS).toISOString(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.update(orderRef, {
      'integration.outboundStatus': 'reconciliation_required',
      'integration.outboundError': 'Conferindo o estado externo na 99Food. Nenhum novo status será enviado durante esta verificação.',
      'integration.outboundUpdatedAt': reconciliationStartedAt,
    });
    return {
      reconciliationId,
      executionId,
      orderId,
      externalOrderId: clean(execution.externalOrderId),
      targetStatus,
    };
  });
};

export type NinetyNineFoodReconciliationOutcome =
  | 'confirmed'
  | 'not_observed'
  | 'conflict'
  | 'uncertain';

export const finalizeNinetyNineFoodStatusSyncReconciliation = async (input: {
  tenantId: string;
  claim: NinetyNineFoodStatusSyncReconciliationClaim;
  outcome: NinetyNineFoodReconciliationOutcome;
  providerLastEvent?: string;
  providerStatus?: string;
  warning?: string;
}): Promise<{
  outcome: NinetyNineFoodReconciliationOutcome;
  orderMarkerFinalized: boolean;
  localStatusChanged: boolean;
}> => {
  const tenantId = clean(input.tenantId);
  const orderRef = orderReference(tenantId, input.claim.orderId);
  const executionRef = executionReference(input.claim.executionId);
  return adminDb.runTransaction(async transaction => {
    const [orderSnapshot, executionSnapshot] = await Promise.all([
      transaction.get(orderRef),
      transaction.get(executionRef),
    ]);
    if (!orderSnapshot.exists || !executionSnapshot.exists) {
      throw new Error('Reconciliação 99Food perdeu sua evidência autoritativa.');
    }
    const order = record(orderSnapshot.data());
    const integration = integrationData(order);
    const execution = record(executionSnapshot.data());
    if (
      clean(execution.status) !== 'reconciliation_checking' ||
      clean(execution.reconciliationId) !== input.claim.reconciliationId
    ) {
      throw new Error('Outra reconciliação 99Food já assumiu esta execução.');
    }
    const ownsOrderMarker =
      clean(integration.provider) === '99food' &&
      clean(integration.outboundExecutionId) === input.claim.executionId &&
      clean(integration.outboundStatus) === 'reconciliation_required';
    const localStatusChanged = clean(order.status) !== input.claim.targetStatus;
    const requestedOutcome: NinetyNineFoodReconciliationOutcome = ownsOrderMarker
      ? input.outcome
      : 'uncertain';
    const effectiveOutcome =
      requestedOutcome !== 'uncertain' && localStatusChanged
        ? 'conflict'
        : requestedOutcome;
    const explicitWarning = clean(input.warning).slice(0, 500);
    const warning = !ownsOrderMarker
      ? 'A execução perdeu o marcador autoritativo do pedido durante a reconciliação. Nenhum novo envio foi feito.'
      : localStatusChanged && requestedOutcome !== 'uncertain'
        ? 'O status local mudou durante a reconciliação. Nenhum novo envio foi feito; revise o pedido antes de continuar.'
        : explicitWarning;
    const completedAt = new Date().toISOString();
    const terminalExecutionStatus = effectiveOutcome === 'confirmed'
      ? 'reconciliation_confirmed'
      : effectiveOutcome === 'not_observed'
        ? 'reconciliation_not_observed'
        : effectiveOutcome === 'conflict'
          ? 'reconciliation_conflict'
          : 'reconciliation_uncertain';
    transaction.update(executionRef, {
      status: terminalExecutionStatus,
      providerLastEvent: clean(input.providerLastEvent) || FieldValue.delete(),
      providerObservedStatus: clean(input.providerStatus) || FieldValue.delete(),
      providerWarning: warning || FieldValue.delete(),
      reconciliationCompletedAt: completedAt,
      reconciliationLeaseExpiresAt: FieldValue.delete(),
      reconciliationOutcome: effectiveOutcome,
      orderMarkerFinalized: ownsOrderMarker && effectiveOutcome !== 'uncertain',
      localStatusChanged,
      updatedAt: FieldValue.serverTimestamp(),
    });
    if (ownsOrderMarker) {
      if (effectiveOutcome === 'uncertain') {
        transaction.update(orderRef, {
          'integration.outboundStatus': 'reconciliation_required',
          'integration.outboundError': warning || 'A 99Food não forneceu evidência suficiente. A execução continua bloqueada para nova conferência manual.',
          'integration.outboundUpdatedAt': completedAt,
        });
      } else {
        transaction.update(orderRef, {
          'integration.outboundStatus': effectiveOutcome === 'confirmed' ? 'sent' : 'attention',
          'integration.outboundTargetStatus': effectiveOutcome === 'confirmed'
            ? FieldValue.delete()
            : input.claim.targetStatus,
          'integration.outboundError': effectiveOutcome === 'confirmed'
            ? FieldValue.delete()
            : warning || 'A leitura atual da 99Food não confirmou o efeito esperado. Qualquer novo envio continua exigindo nova autorização explícita.',
          'integration.outboundExecutionId': FieldValue.delete(),
          'integration.outboundExecutionRevision': FieldValue.delete(),
          'integration.outboundExecutionStartedAt': FieldValue.delete(),
          'integration.outboundUpdatedAt': completedAt,
        });
      }
    }
    return {
      outcome: effectiveOutcome,
      orderMarkerFinalized: ownsOrderMarker && effectiveOutcome !== 'uncertain',
      localStatusChanged,
    };
  });
};
