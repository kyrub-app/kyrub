import { createHash } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import type { DeliveryOperationalEvent } from '../../shared/deliveryOperationalResponsibility.js';

const DELIVERY_OPERATIONAL_EVENT_COLLECTION = 'deliveryOperationalEvents';

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

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
 * Persists the store's "ready" declaration as operational evidence.
 *
 * The caller cannot supply occurredAt/recordedAt. Both timestamps are minted by
 * the server when this function executes. This event is evidence of a store
 * action only; it does not assign responsibility or economic billability.
 */
export const persistStoreMarkedReadyOperationalEvent = async (
  input: PersistStoreMarkedReadyOperationalEventInput
): Promise<DeliveryOperationalEvent> => {
  const tenantId = clean(input.tenantId);
  const orderId = clean(input.orderId);
  const actorUid = clean(input.actorUid);
  if (!tenantId || !orderId || !actorUid) {
    throw new Error('STORE_READY_OPERATIONAL_EVENT_IDENTITY_INVALID');
  }

  const deliveryId = kyrubDeliveryIdForOrder(tenantId, orderId);
  const eventId = storeMarkedReadyEventIdForOrder(tenantId, orderId);
  const reference = adminDb.doc(eventPath(eventId));

  return adminDb.runTransaction(async transaction => {
    const existing = await transaction.get(reference);
    if (existing.exists) {
      const data = existing.data() as DeliveryOperationalEvent;
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

    transaction.create(reference, {
      ...event,
      recordedAtServer: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
    });
    return event;
  });
};
