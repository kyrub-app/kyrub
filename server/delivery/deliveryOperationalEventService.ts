import type { Transaction } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import type {
  DeliveryOperationalActor,
  DeliveryOperationalEvent,
  DeliveryOperationalEventAuthority,
  DeliveryOperationalEventType,
} from '../../shared/deliveryOperationalResponsibility.js';

const COLLECTION = 'deliveryOperationalEvents';

const clean = (value: string): string => value.trim();

const validIdentity = (value: string, label: string): string => {
  const normalized = clean(value);
  if (!normalized || normalized.length > 180 || normalized.includes('/')) {
    throw new Error(`DELIVERY_OPERATIONAL_EVENT_${label}_INVALID`);
  }
  return normalized;
};

const eventId = (deliveryId: string, type: DeliveryOperationalEventType): string =>
  `${deliveryId}:${type}`;

export const persistDeliveryOperationalEvent = async (input: {
  transaction: Transaction;
  deliveryId: string;
  orderId: string;
  storeId: string;
  courierId: string;
  type: DeliveryOperationalEventType;
  occurredAt: string;
  authority: DeliveryOperationalEventAuthority;
  actor?: DeliveryOperationalActor;
  referenceId?: string;
}): Promise<DeliveryOperationalEvent | null> => {
  const deliveryId = validIdentity(input.deliveryId, 'DELIVERY_ID');
  const orderId = validIdentity(input.orderId, 'ORDER_ID');
  const storeId = validIdentity(input.storeId, 'STORE_ID');
  const courierId = validIdentity(input.courierId, 'COURIER_ID');
  const occurredAt = clean(input.occurredAt);
  if (!occurredAt || Number.isNaN(Date.parse(occurredAt))) {
    throw new Error('DELIVERY_OPERATIONAL_EVENT_OCCURRED_AT_INVALID');
  }

  const id = eventId(deliveryId, input.type);
  const reference = adminDb.doc(`${COLLECTION}/${encodeURIComponent(id)}`);
  const existingSnapshot = await input.transaction.get(reference);

  const event: DeliveryOperationalEvent = {
    schemaVersion: 1,
    id,
    deliveryId,
    orderId,
    storeId,
    courierId,
    type: input.type,
    occurredAt: new Date(occurredAt).toISOString(),
    recordedAt: new Date(occurredAt).toISOString(),
    authority: input.authority,
    ...(input.actor ? { actor: input.actor } : {}),
    ...(input.referenceId ? { referenceId: clean(input.referenceId) } : {}),
  };

  if (existingSnapshot.exists) {
    const existing = existingSnapshot.data() as Partial<DeliveryOperationalEvent>;
    const same =
      existing.schemaVersion === event.schemaVersion &&
      existing.id === event.id &&
      existing.deliveryId === event.deliveryId &&
      existing.orderId === event.orderId &&
      existing.storeId === event.storeId &&
      existing.courierId === event.courierId &&
      existing.type === event.type &&
      existing.occurredAt === event.occurredAt &&
      existing.authority === event.authority;
    return same ? event : null;
  }

  input.transaction.create(reference, event);
  return event;
};
