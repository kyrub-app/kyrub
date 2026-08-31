import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin';
import {
  reserveCanonicalOrderInventory,
  transitionCanonicalInventoryReservation,
} from './canonicalInventoryReservationService';

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const inventoryLedgerId = (tenantId: string, orderId: string): string =>
  createHash('sha256').update(`${tenantId}:${orderId}`).digest('hex');

const inventoryLedgerPath = (tenantId: string, orderId: string): string =>
  `inventoryOrderConsumptions/${inventoryLedgerId(tenantId, orderId)}`;

const legacyOrderPath = (tenantId: string, orderId: string): string =>
  `artifacts/${tenantId}/public/data/customerOrders/${orderId}`;

const reservationCollectionPath = (storeId: string): string =>
  `stores/${storeId}/inventoryReservations`;

const reservationStatePatch = (state: string, detail = '') => ({
  inventoryReservation: {
    state,
    detail,
    reconciledAt: new Date().toISOString(),
  },
});

const writeOrderReservationState = async (input: {
  tenantId: string;
  storeId: string;
  orderId: string;
  state: string;
  detail?: string;
}): Promise<void> => {
  const patch = reservationStatePatch(input.state, input.detail ?? '');
  const batch = adminDb.batch();
  batch.set(adminDb.doc(legacyOrderPath(input.tenantId, input.orderId)), patch, { merge: true });
  batch.set(adminDb.doc(`stores/${input.storeId}/orders/${input.orderId}`), patch, { merge: true });
  await batch.commit();
};

const findReservationId = async (
  storeId: string,
  orderId: string
): Promise<string | null> => {
  const snapshot = await adminDb
    .collection(reservationCollectionPath(storeId))
    .where('orderId', '==', orderId)
    .get();
  const matches = snapshot.docs.filter(document => document.data().sourceChannel === '99food');
  if (matches.length > 1) {
    throw new Error('INVENTORY_RESERVATION_DUPLICATE_ORDER_BINDING');
  }
  return matches[0]?.id ?? null;
};

export type NinetyNineFoodReservationReconciliationState =
  | 'reserved'
  | 'released'
  | 'consumed'
  | 'waiting_physical_consumption'
  | 'not_applicable'
  | 'blocked_insufficient_atp'
  | 'blocked_authority_unresolved';

export const reconcileNinetyNineFoodOrderReservation = async (
  tenantId: string,
  orderId: string
): Promise<NinetyNineFoodReservationReconciliationState> => {
  const normalizedTenantId = clean(tenantId);
  const normalizedOrderId = clean(orderId);
  if (!normalizedTenantId || !normalizedOrderId) {
    throw new Error('INVENTORY_RESERVATION_IDENTITY_REQUIRED');
  }

  const tenantSnapshot = await adminDb.doc(`tenants/${normalizedTenantId}`).get();
  const storeId = clean(tenantSnapshot.data()?.canonicalStoreId);
  if (!storeId) throw new Error('CANONICAL_STORE_REQUIRED_FOR_INVENTORY_RESERVATION');

  const orderSnapshot = await adminDb.doc(`stores/${storeId}/orders/${normalizedOrderId}`).get();
  const order = orderSnapshot.data() as Record<string, unknown> | undefined;
  if (!orderSnapshot.exists || !order) {
    throw new Error('CANONICAL_ORDER_REQUIRED_FOR_INVENTORY_RESERVATION');
  }

  const integration = order.integration && typeof order.integration === 'object'
    ? order.integration as Record<string, unknown>
    : {};
  if (clean(integration.provider) !== '99food') {
    throw new Error('INVENTORY_RESERVATION_SOURCE_CHANNEL_MISMATCH');
  }

  const status = clean(order.status);
  const items = Array.isArray(order.items)
    ? order.items.flatMap(candidate => {
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return [];
        const item = candidate as Record<string, unknown>;
        const productId = clean(item.sourceProductId) || clean(item.productId).split('::', 1)[0]?.trim();
        const quantity = typeof item.quantity === 'number' && Number.isFinite(item.quantity)
          ? Math.max(0, Math.trunc(item.quantity))
          : 0;
        const transferredQuantity = typeof item.transferredQuantity === 'number' && Number.isFinite(item.transferredQuantity)
          ? Math.max(0, Math.trunc(item.transferredQuantity))
          : 0;
        return productId && quantity > 0
          ? [{ productId, quantity, transferredQuantity }]
          : [];
      })
    : [];

  const ledgerReferencePath = inventoryLedgerPath(normalizedTenantId, normalizedOrderId);
  const ledgerSnapshot = await adminDb.doc(ledgerReferencePath).get();
  const ledgerStatus = clean(ledgerSnapshot.data()?.status);

  if (status === 'cancelled' || status === 'rejected') {
    const reservationId = await findReservationId(storeId, normalizedOrderId);
    if (!reservationId) {
      await writeOrderReservationState({
        tenantId: normalizedTenantId,
        storeId,
        orderId: normalizedOrderId,
        state: 'not_applicable',
        detail: 'no_active_reservation_to_release',
      });
      return 'not_applicable';
    }
    await transitionCanonicalInventoryReservation({
      storeId,
      reservationId,
      nextStatus: 'released',
    });
    await writeOrderReservationState({
      tenantId: normalizedTenantId,
      storeId,
      orderId: normalizedOrderId,
      state: 'released',
      detail: `order_${status}`,
    });
    return 'released';
  }

  let reservationId = await findReservationId(storeId, normalizedOrderId);
  if (!reservationId) {
    try {
      const reserved = await reserveCanonicalOrderInventory({
        storeId,
        orderId: normalizedOrderId,
        sourceChannel: '99food',
        orderLines: items,
      });
      reservationId = reserved.reservationId;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('INVENTORY_RESERVATION_NO_COMPOSED_ITEMS')) {
        await writeOrderReservationState({
          tenantId: normalizedTenantId,
          storeId,
          orderId: normalizedOrderId,
          state: 'not_applicable',
          detail: 'order_without_composed_inventory_items',
        });
        return 'not_applicable';
      }
      if (message.includes('INVENTORY_AVAILABLE_TO_PROMISE_EXCEEDED')) {
        await writeOrderReservationState({
          tenantId: normalizedTenantId,
          storeId,
          orderId: normalizedOrderId,
          state: 'blocked_insufficient_atp',
          detail: message.slice(0, 500),
        });
        return 'blocked_insufficient_atp';
      }
      if (
        message.includes('INVENTORY_AUTHORITY_OWNER_UNRESOLVED') ||
        message.includes('INVENTORY_AUTHORITY_DOCUMENT_NOT_FOUND')
      ) {
        await writeOrderReservationState({
          tenantId: normalizedTenantId,
          storeId,
          orderId: normalizedOrderId,
          state: 'blocked_authority_unresolved',
          detail: message.slice(0, 500),
        });
        return 'blocked_authority_unresolved';
      }
      throw error;
    }
  }

  if (ledgerStatus === 'consumed') {
    await transitionCanonicalInventoryReservation({
      storeId,
      reservationId,
      nextStatus: 'consumed',
      physicalConsumptionEvidenceId: ledgerReferencePath,
    });
    await writeOrderReservationState({
      tenantId: normalizedTenantId,
      storeId,
      orderId: normalizedOrderId,
      state: 'consumed',
      detail: ledgerReferencePath,
    });
    return 'consumed';
  }

  if (ledgerStatus === 'reversed') {
    await transitionCanonicalInventoryReservation({
      storeId,
      reservationId,
      nextStatus: 'released',
    });
    await writeOrderReservationState({
      tenantId: normalizedTenantId,
      storeId,
      orderId: normalizedOrderId,
      state: 'released',
      detail: 'physical_inventory_reversed',
    });
    return 'released';
  }

  const state = status === 'pending' || status === 'accepted'
    ? 'reserved'
    : 'waiting_physical_consumption';
  await writeOrderReservationState({
    tenantId: normalizedTenantId,
    storeId,
    orderId: normalizedOrderId,
    state,
    detail: ledgerStatus || 'physical_consumption_not_applied',
  });
  return state;
};

export const markReservationSweepAttempt = async (input: {
  tenantId: string;
  orderId: string;
  error: unknown;
}): Promise<void> => {
  await adminDb.doc(`inventoryReservationReconciliationQueue/${createHash('sha256')
    .update(`${input.tenantId}:${input.orderId}`)
    .digest('hex')}`).set({
      tenantId: input.tenantId,
      orderId: input.orderId,
      status: 'pending',
      attempts: FieldValue.increment(1),
      lastError: (input.error instanceof Error ? input.error.message : String(input.error)).slice(0, 1_000),
      updatedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
    }, { merge: true });
};
