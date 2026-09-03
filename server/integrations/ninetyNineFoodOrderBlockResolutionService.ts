import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin';
import {
  extractNinetyNineFoodExternalOrderLines,
  reconcileNinetyNineFoodOrderReservation,
  resolveNinetyNineFoodBoundOrderLines,
} from '../inventory/ninetyNineFoodReservationLifecycle';
import { inspectCanonicalOrderInventoryAvailability } from '../inventory/canonicalInventoryReservationService';
import { sendNinetyNineFoodOrderStatus } from './ninetyNineFoodService';

const clean = (value: unknown, maximum = 500): string =>
  typeof value === 'string' || typeof value === 'number'
    ? String(value).replace(/\s+/g, ' ').trim().slice(0, maximum)
    : '';

const stringList = (value: unknown, maximum = 240): string[] =>
  Array.isArray(value)
    ? Array.from(new Set(value.map(item => clean(item, maximum)).filter(Boolean))).sort()
    : [];

const finiteNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const BLOCKED_STATES = new Set([
  'blocked_insufficient_atp',
  'blocked_product_binding_unresolved',
]);

const canonicalStoreIdForTenant = async (tenantId: string): Promise<string> => {
  const tenant = await adminDb.doc(`tenants/${tenantId}`).get();
  const canonicalStoreId = clean(tenant.data()?.canonicalStoreId, 160);
  if (!canonicalStoreId) throw new Error('NINETY_NINE_FOOD_BLOCK_CANONICAL_STORE_REQUIRED');
  return canonicalStoreId;
};

const resolutionIdFor = (tenantId: string, orderId: string): string =>
  `99food_block_${createHash('sha256').update(`${tenantId}:${orderId}`).digest('hex').slice(0, 40)}`;

const resolutionPath = (canonicalStoreId: string, resolutionId: string): string =>
  `stores/${canonicalStoreId}/integrationOrderBlockResolutions/${resolutionId}`;

const orderPath = (canonicalStoreId: string, orderId: string): string =>
  `stores/${canonicalStoreId}/orders/${orderId}`;

const inventoryReservationState = (order: Record<string, unknown>): string => {
  const value = order.inventoryReservation;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  return clean((value as Record<string, unknown>).state, 120);
};

const integrationProvider = (order: Record<string, unknown>): string => {
  const integration = order.integration;
  if (!integration || typeof integration !== 'object' || Array.isArray(integration)) return '';
  return clean((integration as Record<string, unknown>).provider, 120);
};

const externalOrderId = (order: Record<string, unknown>): string => {
  const integration = order.integration;
  if (!integration || typeof integration !== 'object' || Array.isArray(integration)) return '';
  return clean((integration as Record<string, unknown>).externalOrderId, 240);
};

export interface NinetyNineFoodBlockedOrder {
  orderId: string;
  externalOrderId: string;
  displayId: string;
  customerName: string;
  blockedState: 'blocked_insufficient_atp' | 'blocked_product_binding_unresolved';
  blockedDetail: string;
  unresolvedExternalProductIds: string[];
  canonicalProductIds: string[];
  inventoryItemId: string;
  requiredQuantity: number | null;
  availableQuantity: number | null;
  status: string;
}

export interface NinetyNineFoodReservationPreflightLine {
  inventoryItemId: string;
  requiredQuantity: number;
  availableQuantity: number;
  shortageQuantity: number;
}

export interface NinetyNineFoodReservationPreflight {
  orderId: string;
  state:
    | 'binding_unresolved'
    | 'insufficient_atp'
    | 'ready_for_retry'
    | 'already_reserved'
    | 'not_applicable';
  canonicalProductIds: string[];
  unresolvedExternalProductIds: string[];
  lines: NinetyNineFoodReservationPreflightLine[];
  checkedAt: string;
}

export const listNinetyNineFoodBlockedOrders = async (input: {
  tenantId: string;
  requestedByUserId: string;
}): Promise<{ canonicalStoreId: string; items: NinetyNineFoodBlockedOrder[] }> => {
  const tenantId = clean(input.tenantId, 160);
  const requestedByUserId = clean(input.requestedByUserId, 160);
  if (!tenantId || requestedByUserId !== tenantId) throw new Error('NINETY_NINE_FOOD_BLOCK_FORBIDDEN');
  const canonicalStoreId = await canonicalStoreIdForTenant(tenantId);
  const snapshot = await adminDb.collection(`stores/${canonicalStoreId}/orders`).get();
  const items = snapshot.docs.flatMap(document => {
    const order = document.data() as Record<string, unknown>;
    const integration = order.integration && typeof order.integration === 'object'
      ? order.integration as Record<string, unknown>
      : {};
    if (clean(integration.provider) !== '99food') return [];
    const state = inventoryReservationState(order);
    if (!BLOCKED_STATES.has(state)) return [];
    const reservation = order.inventoryReservation as Record<string, unknown>;
    return [{
      orderId: document.id,
      externalOrderId: clean(integration.externalOrderId, 240),
      displayId: clean(integration.displayId, 120),
      customerName: clean(order.buyerName, 240),
      blockedState: state as NinetyNineFoodBlockedOrder['blockedState'],
      blockedDetail: clean(reservation.detail, 1_000),
      unresolvedExternalProductIds: stringList(reservation.unresolvedExternalProductIds),
      canonicalProductIds: stringList(reservation.canonicalProductIds),
      inventoryItemId: clean(reservation.inventoryItemId, 240),
      requiredQuantity: finiteNumber(reservation.requiredQuantity),
      availableQuantity: finiteNumber(reservation.availableQuantity),
      status: clean(order.status, 120),
    }];
  });
  return { canonicalStoreId, items };
};

export const preflightNinetyNineFoodBlockedOrderReservation = async (input: {
  tenantId: string;
  orderId: string;
  requestedByUserId: string;
}): Promise<NinetyNineFoodReservationPreflight> => {
  const tenantId = clean(input.tenantId, 160);
  const orderId = clean(input.orderId, 240);
  const requestedByUserId = clean(input.requestedByUserId, 160);
  if (!tenantId || !orderId || requestedByUserId !== tenantId) {
    throw new Error('NINETY_NINE_FOOD_BLOCK_INPUT_INVALID');
  }

  const canonicalStoreId = await canonicalStoreIdForTenant(tenantId);
  const snapshot = await adminDb.doc(orderPath(canonicalStoreId, orderId)).get();
  if (!snapshot.exists) throw new Error('NINETY_NINE_FOOD_BLOCK_ORDER_NOT_FOUND');
  const order = snapshot.data() as Record<string, unknown>;
  if (integrationProvider(order) !== '99food') {
    throw new Error('NINETY_NINE_FOOD_BLOCK_SOURCE_MISMATCH');
  }
  if (!BLOCKED_STATES.has(inventoryReservationState(order))) {
    throw new Error('NINETY_NINE_FOOD_BLOCK_ORDER_NOT_BLOCKED');
  }

  const externalLines = extractNinetyNineFoodExternalOrderLines(order);
  const { orderLines, unresolvedExternalProductIds } = await resolveNinetyNineFoodBoundOrderLines(
    tenantId,
    externalLines
  );
  const canonicalProductIds = Array.from(new Set(
    orderLines.map(line => clean(line.productId, 240)).filter(Boolean)
  )).sort();
  const checkedAt = new Date().toISOString();

  if (unresolvedExternalProductIds.length > 0) {
    return {
      orderId,
      state: 'binding_unresolved',
      canonicalProductIds,
      unresolvedExternalProductIds,
      lines: [],
      checkedAt,
    };
  }

  const inspection = await inspectCanonicalOrderInventoryAvailability({
    storeId: canonicalStoreId,
    orderId,
    sourceChannel: '99food',
    orderLines,
  });

  return {
    orderId,
    state: inspection.state === 'ready'
      ? 'ready_for_retry'
      : inspection.state,
    canonicalProductIds,
    unresolvedExternalProductIds: [],
    lines: inspection.lines,
    checkedAt: inspection.checkedAt,
  };
};

export const retryNinetyNineFoodBlockedOrderReservation = async (input: {
  tenantId: string;
  orderId: string;
  requestedByUserId: string;
}) => {
  const tenantId = clean(input.tenantId, 160);
  const orderId = clean(input.orderId, 240);
  const requestedByUserId = clean(input.requestedByUserId, 160);
  if (!tenantId || !orderId || requestedByUserId !== tenantId) {
    throw new Error('NINETY_NINE_FOOD_BLOCK_INPUT_INVALID');
  }
  const canonicalStoreId = await canonicalStoreIdForTenant(tenantId);
  const snapshot = await adminDb.doc(orderPath(canonicalStoreId, orderId)).get();
  if (!snapshot.exists) throw new Error('NINETY_NINE_FOOD_BLOCK_ORDER_NOT_FOUND');
  const order = snapshot.data() as Record<string, unknown>;
  if (!BLOCKED_STATES.has(inventoryReservationState(order))) {
    throw new Error('NINETY_NINE_FOOD_BLOCK_ORDER_NOT_BLOCKED');
  }
  const state = await reconcileNinetyNineFoodOrderReservation(tenantId, orderId);
  return { orderId, state };
};

export const rejectNinetyNineFoodBlockedOrder = async (input: {
  tenantId: string;
  orderId: string;
  reason: string;
  requestedByUserId: string;
}): Promise<{
  orderId: string;
  resolutionId: string;
  status: 'provider_write_succeeded' | 'reconciliation_required';
}> => {
  const tenantId = clean(input.tenantId, 160);
  const orderId = clean(input.orderId, 240);
  const reason = clean(input.reason, 500);
  const requestedByUserId = clean(input.requestedByUserId, 160);
  if (!tenantId || !orderId || !reason || requestedByUserId !== tenantId) {
    throw new Error('NINETY_NINE_FOOD_BLOCK_INPUT_INVALID');
  }
  const canonicalStoreId = await canonicalStoreIdForTenant(tenantId);
  const orderReference = adminDb.doc(orderPath(canonicalStoreId, orderId));
  const resolutionId = resolutionIdFor(tenantId, orderId);
  const resolutionReference = adminDb.doc(resolutionPath(canonicalStoreId, resolutionId));
  let providerOrderId = '';

  const reserve = await adminDb.runTransaction(async transaction => {
    const [orderDocument, resolutionDocument] = await Promise.all([
      transaction.get(orderReference),
      transaction.get(resolutionReference),
    ]);
    if (!orderDocument.exists) throw new Error('NINETY_NINE_FOOD_BLOCK_ORDER_NOT_FOUND');
    const order = orderDocument.data() as Record<string, unknown>;
    const blockedState = inventoryReservationState(order);
    if (!BLOCKED_STATES.has(blockedState)) throw new Error('NINETY_NINE_FOOD_BLOCK_ORDER_NOT_BLOCKED');
    providerOrderId = externalOrderId(order);
    if (!providerOrderId) throw new Error('NINETY_NINE_FOOD_BLOCK_EXTERNAL_ORDER_REQUIRED');

    if (resolutionDocument.exists) {
      const existing = resolutionDocument.data() as Record<string, unknown>;
      const status = clean(existing.status, 120);
      if (status === 'provider_write_succeeded') return { execute: false, status };
      if (status === 'executing' || status === 'reconciliation_required') {
        throw new Error('NINETY_NINE_FOOD_BLOCK_REJECTION_ALREADY_RESERVED');
      }
    }

    transaction.set(resolutionReference, {
      schemaVersion: 1,
      id: resolutionId,
      provider: '99food',
      tenantId,
      canonicalStoreId,
      orderId,
      externalOrderId: providerOrderId,
      blockedState,
      requestedAction: 'reject_order',
      reason,
      status: 'executing',
      authority: 'store_owner_block_resolution',
      requestedByUserId,
      requestedAt: new Date().toISOString(),
      serverRequestedAt: FieldValue.serverTimestamp(),
      attempts: 1,
    }, { merge: false });
    return { execute: true, status: 'executing' };
  });

  if (!reserve.execute) {
    return { orderId, resolutionId, status: 'provider_write_succeeded' };
  }

  try {
    await sendNinetyNineFoodOrderStatus(tenantId, providerOrderId, 'rejected', reason);
    await resolutionReference.update({
      status: 'provider_write_succeeded',
      completedAt: new Date().toISOString(),
      serverCompletedAt: FieldValue.serverTimestamp(),
    });
    return { orderId, resolutionId, status: 'provider_write_succeeded' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await resolutionReference.update({
      status: 'reconciliation_required',
      lastError: message.slice(0, 1_000),
      failedAt: new Date().toISOString(),
      serverFailedAt: FieldValue.serverTimestamp(),
    });
    return { orderId, resolutionId, status: 'reconciliation_required' };
  }
};
