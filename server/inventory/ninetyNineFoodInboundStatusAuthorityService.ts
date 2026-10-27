import { createHash } from 'node:crypto';
import { FieldValue, type DocumentSnapshot } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import type { InventoryOrderStatus } from '../../shared/inventoryConsumption.js';

const STATUS_SYNC_EXECUTION_COLLECTION = 'ninetyNineFoodStatusSyncExecutions';
const STATUS_MUTATION_LOCK_COLLECTION = 'orderStatusMutationLocks';
const ACTIVE_OUTBOUND_STATUSES = new Set(['executing', 'reconciliation_required']);
const EXECUTING_PHASES = new Set(['claimed', 'provider_write_started']);
const RECONCILIATION_PHASES = new Set([
  'provider_write_outcome_unknown',
  'reconciliation_uncertain',
  'reconciliation_checking',
]);

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const integrationData = (value: unknown): Record<string, unknown> =>
  record(record(value).integration);

const internalOrderId = (externalOrderId: string): string =>
  `99food-${externalOrderId.replace(/[^a-zA-Z0-9_-]/g, '-')}`;

const authorityDocumentId = (tenantId: string, orderId: string): string =>
  createHash('sha256').update(`${tenantId}:${orderId}`).digest('hex');

const mutationLockReference = (tenantId: string, orderId: string) =>
  adminDb.doc(
    `${STATUS_MUTATION_LOCK_COLLECTION}/${authorityDocumentId(tenantId, orderId)}`
  );

const activeStatusMutationId = (value: unknown): string => {
  const lock = record(value);
  const mutationId = clean(lock.mutationId);
  const leaseExpiresAt = Date.parse(clean(lock.leaseExpiresAt));
  return mutationId && Number.isFinite(leaseExpiresAt) && leaseExpiresAt > Date.now()
    ? mutationId
    : '';
};

/** Provider status is evidence, not permission to start unpaid KDS work. */
export const mayApplyNinetyNineFoodInboundStatus = (
  mappedStatus: InventoryOrderStatus | null,
  paymentStatus: unknown,
  payOnDelivery = false
): boolean => {
  if (!mappedStatus) return false;
  if (['preparing', 'ready', 'out_for_delivery', 'completed'].includes(mappedStatus)) {
    return paymentStatus === 'paid' || payOnDelivery;
  }
  return true;
};

/** Terminal canonical states cannot be reopened by delayed provider events. */
export const mayTransitionNinetyNineFoodTerminalOrder = (
  currentStatus: unknown,
  incomingStatus: InventoryOrderStatus | null
): boolean => {
  const current = clean(currentStatus);
  return !['cancelled', 'rejected', 'completed'].includes(current) ||
    incomingStatus === current;
};

/** A delayed acceptance must not roll back an order already in fulfillment. */
export const mayApplyNinetyNineFoodAcceptance = (
  currentStatus: unknown,
  incomingStatus: InventoryOrderStatus | null
): boolean => incomingStatus !== 'accepted' ||
  !['preparing', 'ready', 'out_for_delivery'].includes(clean(currentStatus));

/** Provider event replay cannot move fulfillment backwards. */
export const mayAdvanceNinetyNineFoodFulfillment = (
  currentStatus: unknown,
  incomingStatus: InventoryOrderStatus | null
): boolean => {
  const stages = ['accepted', 'preparing', 'ready', 'out_for_delivery', 'completed'];
  const currentIndex = stages.indexOf(clean(currentStatus));
  const incomingIndex = stages.indexOf(clean(incomingStatus));
  return currentIndex < 0 || incomingIndex < 0 || incomingIndex >= currentIndex;
};

export interface NinetyNineFoodInboundStatusAuthorityResult {
  reconciliationRequired: boolean;
  executionId: string;
  localStatusApplied: boolean;
}

export const applyNinetyNineFoodInboundStatusWithAuthority = async (input: {
  tenantId: string;
  externalOrderId: string;
  eventId: string;
  eventType: string;
  eventReferencePath: string;
  mappedStatus: InventoryOrderStatus | null;
  providerPayment?: {
    paymentStatus: 'unpaid' | 'partial' | 'paid';
    payOnDelivery: boolean;
    externalOrderId: string;
  };
}): Promise<NinetyNineFoodInboundStatusAuthorityResult> => {
  const tenantId = clean(input.tenantId);
  const externalOrderId = clean(input.externalOrderId);
  const eventId = clean(input.eventId);
  const eventType = clean(input.eventType);
  const eventReferencePath = clean(input.eventReferencePath);
  if (!tenantId || !externalOrderId || !eventId || !eventType || !eventReferencePath) {
    throw new Error('Evento inbound 99Food não possui identidade suficiente para autoridade de status.');
  }

  const orderId = internalOrderId(externalOrderId);
  const tenantReference = adminDb.doc(`tenants/${tenantId}`);
  const lockReference = mutationLockReference(tenantId, orderId);

  return adminDb.runTransaction(async transaction => {
    const [tenantSnapshot, lockSnapshot] = await Promise.all([
      transaction.get(tenantReference),
      transaction.get(lockReference),
    ]);
    const canonicalStoreId = clean(tenantSnapshot.data()?.canonicalStoreId);
    if (!canonicalStoreId || canonicalStoreId.includes('/')) {
      throw new Error('NINETY_NINE_FOOD_CANONICAL_STORE_MISSING: loja sem identidade canônica válida.');
    }
    const orderReference = adminDb.doc(`stores/${canonicalStoreId}/orders/${orderId}`);
    const orderSnapshot = await transaction.get(orderReference);
    if (!orderSnapshot.exists) {
      throw new Error(
        'NINETY_NINE_FOOD_INBOUND_ORDER_DISAPPEARED: o pedido deixou de existir antes da aplicação autoritativa do evento inbound.'
      );
    }
    if (activeStatusMutationId(lockSnapshot.data())) {
      throw new Error(
        'NINETY_NINE_FOOD_INBOUND_STATUS_MUTATION_BUSY: uma mudança local de status ainda possui autoridade sobre este pedido; o evento inbound deve ser reprocessado depois.'
      );
    }

    const order = record(orderSnapshot.data());
    const integration = integrationData(order);
    const provider = clean(integration.provider);
    const outboundStatus = clean(integration.outboundStatus);
    const executionId = clean(integration.outboundExecutionId);
    if (provider !== '99food') {
      throw new Error(
        'NINETY_NINE_FOOD_INBOUND_ORDER_SOURCE_MISMATCH: o pedido existente não pertence à autoridade 99Food.'
      );
    }
    const hasActiveOutboundState = ACTIVE_OUTBOUND_STATUSES.has(outboundStatus);
    if (hasActiveOutboundState && !/^[a-zA-Z0-9_-]{1,256}$/.test(executionId)) {
      throw new Error(
        'NINETY_NINE_FOOD_INBOUND_EXECUTION_AUTHORITY_CONFLICT: o pedido possui estado outbound ativo sem executionId server-only válido.'
      );
    }
    const hasActiveAuthority = hasActiveOutboundState && Boolean(executionId);

    let executionSnapshot: DocumentSnapshot | null = null;
    if (hasActiveAuthority) {
      executionSnapshot = await transaction.get(
        adminDb.doc(`${STATUS_SYNC_EXECUTION_COLLECTION}/${executionId}`)
      );
      const execution = record(executionSnapshot.data());
      const executionPhase = clean(execution.status);
      const expectedPhase = outboundStatus === 'executing'
        ? EXECUTING_PHASES.has(executionPhase)
        : RECONCILIATION_PHASES.has(executionPhase);
      if (
        !executionSnapshot.exists ||
        clean(execution.tenantId) !== tenantId ||
        clean(execution.orderId) !== orderId ||
        clean(execution.provider) !== '99food' ||
        clean(execution.externalOrderId) !== externalOrderId ||
        clean(execution.targetStatus) !== clean(integration.outboundTargetStatus) ||
        !expectedPhase
      ) {
        throw new Error(
          'NINETY_NINE_FOOD_INBOUND_EXECUTION_AUTHORITY_CONFLICT: o evento inbound não pode alterar um pedido cujo executionId não possui evidência server-only compatível.'
        );
      }
    }

    const observedAt = new Date().toISOString();
    const warning = hasActiveAuthority
      ? 'A 99Food enviou um evento inbound enquanto havia uma execução externa ativa. O evento foi aplicado ao pedido, mas a execução foi transferida para reconciliação e não poderá ser finalizada pelo worker original.'
      : '';
    const integrationPatch: Record<string, unknown> = {
      lastEvent: eventType,
      lastInboundEventId: eventId,
      lastInboundEventAt: observedAt,
    };
    if (hasActiveAuthority) {
      integrationPatch.outboundStatus = 'reconciliation_required';
      integrationPatch.outboundError = warning;
      integrationPatch.outboundUpdatedAt = observedAt;
    }
    const orderPatch: Record<string, unknown> = {
      updatedAt: observedAt,
      integration: integrationPatch,
    };
    // Preserve provider event evidence without starting unpaid online production.
    // Cancellation and rejection remain actionable regardless of payment state.
    const providerPayment = input.providerPayment;
    if (providerPayment && providerPayment.externalOrderId !== externalOrderId) {
      throw new Error('NINETY_NINE_FOOD_PAYMENT_ORDER_MISMATCH');
    }
    // Never downgrade a confirmed payment from a later incomplete provider response.
    const paymentStatus = clean(order.paymentStatus) === 'paid'
      ? 'paid'
      : providerPayment?.paymentStatus === 'paid' ? 'paid' : order.paymentStatus;
    const payOnDelivery = providerPayment?.payOnDelivery === true ||
      record(integration.paymentEvidence).payOnDelivery === true ||
      integration.payOnDelivery === true;
    if (paymentStatus === 'paid' && clean(order.paymentStatus) !== 'paid') {
      orderPatch.paymentStatus = 'paid';
    }
    if (providerPayment) {
      integrationPatch.lastPaymentReconciledAt = observedAt;
      integrationPatch.payOnDelivery = payOnDelivery;
    }
    // A previously blocked production stage can be resumed only while the
    // canonical order is still pending/accepted. Never revive cancelled orders.
    const blockedStatus = clean(integration.paymentGateBlockedStatus) as InventoryOrderStatus;
    const canResumeBlocked = ['pending', 'accepted'].includes(clean(order.status)) &&
      ['preparing', 'ready', 'out_for_delivery', 'completed'].includes(blockedStatus) &&
      mayApplyNinetyNineFoodInboundStatus(blockedStatus, paymentStatus, payOnDelivery);
    const incomingAllowed = mayTransitionNinetyNineFoodTerminalOrder(
      order.status, input.mappedStatus
    ) && mayAdvanceNinetyNineFoodFulfillment(
      order.status, input.mappedStatus
    ) && mayApplyNinetyNineFoodInboundStatus(
      input.mappedStatus,
      paymentStatus,
      payOnDelivery
    );
    const mayApplyStatus = incomingAllowed ||
      (canResumeBlocked && (input.mappedStatus === null || input.mappedStatus === 'accepted'));
    if (input.mappedStatus && !incomingAllowed &&
        mayTransitionNinetyNineFoodTerminalOrder(order.status, input.mappedStatus) &&
        mayAdvanceNinetyNineFoodFulfillment(order.status, input.mappedStatus) &&
        !mayApplyNinetyNineFoodInboundStatus(input.mappedStatus, paymentStatus, payOnDelivery)) {
      integrationPatch.paymentGateBlockedStatus = input.mappedStatus;
      integrationPatch.paymentGateBlockedAt = observedAt;
    } else if (canResumeBlocked && (!input.mappedStatus || input.mappedStatus === 'accepted')) {
      orderPatch.status = blockedStatus;
      integrationPatch.paymentGateBlockedStatus = FieldValue.delete();
      integrationPatch.paymentGateBlockedAt = FieldValue.delete();
    } else if (incomingAllowed && input.mappedStatus) {
      orderPatch.status = input.mappedStatus;
      integrationPatch.paymentGateBlockedStatus = FieldValue.delete();
      integrationPatch.paymentGateBlockedAt = FieldValue.delete();
    }

    transaction.set(orderReference, orderPatch, { merge: true });

    if (hasActiveAuthority && executionSnapshot) {
      const execution = record(executionSnapshot.data());
      const executionPhase = clean(execution.status);
      transaction.update(executionSnapshot.ref, {
        ...(outboundStatus === 'executing' && EXECUTING_PHASES.has(executionPhase)
          ? {
              status: 'reconciliation_uncertain',
              inboundAuthorityTransferredAt: observedAt,
            }
          : {}),
        lastInboundEventId: eventId,
        lastInboundEventType: eventType,
        lastInboundMappedStatus: input.mappedStatus || FieldValue.delete(),
        lastInboundEventPath: eventReferencePath,
        lastInboundObservedAt: observedAt,
        inboundEvidenceCount: FieldValue.increment(1),
        providerWarning: warning,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    return {
      reconciliationRequired: hasActiveAuthority,
      executionId: hasActiveAuthority ? executionId : '',
      localStatusApplied: mayApplyStatus,
    };
  });
};