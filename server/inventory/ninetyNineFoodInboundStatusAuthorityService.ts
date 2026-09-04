import { FieldValue, type DocumentSnapshot } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import type { InventoryOrderStatus } from '../../shared/inventoryConsumption.js';

const STATUS_SYNC_EXECUTION_COLLECTION = 'ninetyNineFoodStatusSyncExecutions';
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

const legacyOrderReference = (tenantId: string, orderId: string) =>
  adminDb.doc(`artifacts/${tenantId}/public/data/customerOrders/${orderId}`);

export interface NinetyNineFoodInboundStatusAuthorityResult {
  orderExists: boolean;
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
  const legacyReference = legacyOrderReference(tenantId, orderId);

  return adminDb.runTransaction(async transaction => {
    const [tenantSnapshot, legacySnapshot] = await Promise.all([
      transaction.get(tenantReference),
      transaction.get(legacyReference),
    ]);
    if (!legacySnapshot.exists) {
      return {
        orderExists: false,
        reconciliationRequired: false,
        executionId: '',
        localStatusApplied: false,
      };
    }

    const canonicalStoreId = clean(tenantSnapshot.data()?.canonicalStoreId);
    const order = record(legacySnapshot.data());
    const integration = integrationData(order);
    const outboundStatus = clean(integration.outboundStatus);
    const executionId = clean(integration.outboundExecutionId);
    const hasActiveAuthority =
      clean(integration.provider) === '99food' &&
      ACTIVE_OUTBOUND_STATUSES.has(outboundStatus) &&
      Boolean(executionId);

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
    if (input.mappedStatus) orderPatch.status = input.mappedStatus;

    transaction.set(legacyReference, orderPatch, { merge: true });
    if (canonicalStoreId) {
      transaction.set(
        adminDb.doc(`stores/${canonicalStoreId}/orders/${orderId}`),
        orderPatch,
        { merge: true }
      );
    }

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
      orderExists: true,
      reconciliationRequired: hasActiveAuthority,
      executionId: hasActiveAuthority ? executionId : '',
      localStatusApplied: Boolean(input.mappedStatus),
    };
  });
};