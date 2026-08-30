import { createHash } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import type { DeliveryOperationalEvent } from '../../shared/deliveryOperationalResponsibility.js';

const DELIVERY_OPERATIONAL_EVENT_COLLECTION = 'deliveryOperationalEvents';

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const orderPath = (tenantId: string, orderId: string): string =>
  `artifacts/${tenantId}/public/data/customerOrders/${orderId}`;

export const kyrubDeliveryIdForOrder = (tenantId: string, orderId: string): string =>
  `order-${createHash('sha256').update(`${tenantId}:${orderId}`).digest('hex')}`;

export const storeMarkedReadyEventIdForOrder = (
  tenantId: string,
  orderId: string
): string =>
  `evt-${createHash('sha256')
    .update(`${tenantId}:${orderId}:store_marked_ready:v1`)
    .digest('hex')}`;

const eventPath = (eventId: string): string =>
  `${DELIVERY_OPERATIONAL_EVENT_COLLECTION}/${eventId}`;

export interface PersistStoreMarkedReadyOperationalEventInput {
  tenantId: string;
  orderId: string;
  actorUid: string;
}

/**
 * Completes the server-authoritative side of a store "ready" action.
 *
 * The caller cannot supply readyAt/occurredAt/recordedAt. The order must
 * already be in the canonical `ready` state. For Kyrub delivery orders, the
 * same transaction that stamps readyAt also creates the immutable,
 * deterministic `store_marked_ready` operational event.
 *
 * This is evidence of a store action only. It never assigns responsibility,
 * economic billability, obligation, settlement or payout.
 */
export const persistStoreMarkedReadyOperationalEvent = async (
  input: PersistStoreMarkedReadyOperationalEventInput
): Promise<DeliveryOperationalEvent | null> => {
  const tenantId = clean(input.tenantId);
  const orderId = clean(input.orderId);
  const actorUid = clean(input.actorUid);
  if (!tenantId || !orderId || !actorUid) {
    throw new Error('STORE_READY_OPERATIONAL_EVENT_IDENTITY_INVALID');
  }

  const deliveryId = kyrubDeliveryIdForOrder(tenantId, orderId);
  const eventId = storeMarkedReadyEventIdForOrder(tenantId, orderId);
  const orderReference = adminDb.doc(orderPath(tenantId, orderId));
  const tenantReference = adminDb.doc(`tenants/${tenantId}`);
  const eventReference = adminDb.doc(eventPath(eventId));

  return adminDb.runTransaction(async transaction => {
    const [orderSnapshot, tenantSnapshot, existingEvent] = await Promise.all([
      transaction.get(orderReference),
      transaction.get(tenantReference),
      transaction.get(eventReference),
    ]);
    if (!orderSnapshot.exists) throw new Error('STORE_READY_ORDER_NOT_FOUND');

    const order = orderSnapshot.data() as Record<string, unknown>;
    if (clean(order.status) !== 'ready') {
      throw new Error('STORE_READY_ORDER_STATE_CONFLICT');
    }

    const canonicalStoreId = clean(tenantSnapshot.data()?.canonicalStoreId);
    if (order.readyAt == null) {
      transaction.set(
        orderReference,
        {
          readyAt: FieldValue.serverTimestamp(),
          readyAtAuthority: 'kyrub_server',
        },
        { merge: true }
      );
      if (canonicalStoreId) {
        transaction.set(
          adminDb.doc(`stores/${canonicalStoreId}/orders/${orderId}`),
          {
            readyAt: FieldValue.serverTimestamp(),
            readyAtAuthority: 'kyrub_server',
          },
          { merge: true }
        );
      }
    }

    const isKyrubDelivery =
      clean(order.fulfillmentType) === 'delivery' &&
      clean(order.deliveryProvider) === 'kyrub';
    if (!isKyrubDelivery) return null;

    if (existingEvent.exists) {
      const data = existingEvent.data() as DeliveryOperationalEvent;
      if (
        data.schemaVersion !== 1 ||
        data.id !== eventId ||
        data.deliveryId !== deliveryId ||
        data.orderId !== orderId ||
        data.storeId !== tenantId ||
        data.type !== 'store_marked_ready' ||
        data.authority !== 'store_action' ||
        data.actor !== 'store'
      ) {
        throw new Error('STORE_READY_OPERATIONAL_EVENT_CONFLICT');
      }
      return data;
    }

    const now = Timestamp.now().toDate().toISOString();
    const event: DeliveryOperationalEvent = {
      schemaVersion: 1,
      id: eventId,
      deliveryId,
      orderId,
      storeId: tenantId,
      courierId: '',
      type: 'store_marked_ready',
      occurredAt: now,
      recordedAt: now,
      authority: 'store_action',
      actor: 'store',
      referenceId: actorUid,
    };

    transaction.create(eventReference, {
      ...event,
      recordedAtServer: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
    });
    return event;
  });
};
