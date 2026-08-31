import { createHash } from 'node:crypto';
import {
  FieldValue,
  Timestamp,
  type DocumentData,
  type Transaction,
} from 'firebase-admin/firestore';
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

export interface WriteStoreMarkedReadyEvidenceInTransactionInput
  extends PersistStoreMarkedReadyOperationalEventInput {
  transaction: Transaction;
  order: DocumentData;
  canonicalStoreId?: string;
}

const assertExistingEvent = (input: {
  event: DeliveryOperationalEvent;
  eventId: string;
  deliveryId: string;
  tenantId: string;
  orderId: string;
}): DeliveryOperationalEvent => {
  const { event, eventId, deliveryId, tenantId, orderId } = input;
  if (
    event.schemaVersion !== 1 ||
    event.id !== eventId ||
    event.deliveryId !== deliveryId ||
    event.orderId !== orderId ||
    event.storeId !== tenantId ||
    event.type !== 'store_marked_ready' ||
    event.authority !== 'store_action' ||
    event.actor !== 'store'
  ) {
    throw new Error('STORE_READY_OPERATIONAL_EVENT_CONFLICT');
  }
  return event;
};

/**
 * Writes the ready timestamp and, for Kyrub deliveries, the immutable
 * `store_marked_ready` event inside a caller-owned Firestore transaction.
 *
 * The caller cannot supply any timestamp. This helper only records operational
 * evidence; it never assigns responsibility or economic billability.
 */
export const writeStoreMarkedReadyEvidenceInTransaction = async (
  input: WriteStoreMarkedReadyEvidenceInTransactionInput
): Promise<DeliveryOperationalEvent | null> => {
  const tenantId = clean(input.tenantId);
  const orderId = clean(input.orderId);
  const actorUid = clean(input.actorUid);
  const canonicalStoreId = clean(input.canonicalStoreId);
  if (!tenantId || !orderId || !actorUid) {
    throw new Error('STORE_READY_OPERATIONAL_EVENT_IDENTITY_INVALID');
  }
  if (clean(input.order.status) !== 'ready') {
    throw new Error('STORE_READY_ORDER_STATE_CONFLICT');
  }

  const isKyrubDelivery =
    clean(input.order.fulfillmentType) === 'delivery' &&
    clean(input.order.deliveryProvider) === 'kyrub';
  const deliveryId = isKyrubDelivery
    ? kyrubDeliveryIdForOrder(tenantId, orderId)
    : '';
  const eventId = isKyrubDelivery
    ? storeMarkedReadyEventIdForOrder(tenantId, orderId)
    : '';
  const eventReference = isKyrubDelivery
    ? adminDb.doc(eventPath(eventId))
    : null;
  const existingEvent = eventReference
    ? await input.transaction.get(eventReference)
    : null;

  const orderReference = adminDb.doc(orderPath(tenantId, orderId));
  if (input.order.readyAt == null) {
    input.transaction.set(
      orderReference,
      {
        readyAt: FieldValue.serverTimestamp(),
        readyAtAuthority: 'kyrub_server',
      },
      { merge: true }
    );
    if (canonicalStoreId) {
      input.transaction.set(
        adminDb.doc(`stores/${canonicalStoreId}/orders/${orderId}`),
        {
          readyAt: FieldValue.serverTimestamp(),
          readyAtAuthority: 'kyrub_server',
        },
        { merge: true }
      );
    }
  }

  if (!eventReference || !existingEvent) return null;
  if (existingEvent.exists) {
    return assertExistingEvent({
      event: existingEvent.data() as DeliveryOperationalEvent,
      eventId,
      deliveryId,
      tenantId,
      orderId,
    });
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

  input.transaction.create(eventReference, {
    ...event,
    recordedAtServer: FieldValue.serverTimestamp(),
    createdAt: FieldValue.serverTimestamp(),
  });
  return event;
};

/**
 * Retry/recovery facade for callers that already committed the canonical
 * order status. New authoritative ready transitions should prefer the helper
 * above so status, inventory, readyAt and evidence share one transaction.
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

  const orderReference = adminDb.doc(orderPath(tenantId, orderId));
  const tenantReference = adminDb.doc(`tenants/${tenantId}`);

  return adminDb.runTransaction(async transaction => {
    const [orderSnapshot, tenantSnapshot] = await Promise.all([
      transaction.get(orderReference),
      transaction.get(tenantReference),
    ]);
    if (!orderSnapshot.exists) throw new Error('STORE_READY_ORDER_NOT_FOUND');

    return writeStoreMarkedReadyEvidenceInTransaction({
      transaction,
      tenantId,
      orderId,
      actorUid,
      order: orderSnapshot.data() as DocumentData,
      canonicalStoreId: clean(tenantSnapshot.data()?.canonicalStoreId),
    });
  });
};
