import { adminDb } from '../firebaseAdmin.js';

export const ORDER_COMMERCIAL_SNAPSHOT_SCHEMA_VERSION = 1 as const;

const clean = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number'
    ? String(value).trim()
    : '';

export const orderCommercialSnapshotPath = (
  storeId: string,
  orderId: string
): string => `stores/${storeId}/orderCommercialSnapshots/${orderId}`;

export interface FreezeOrderCommercialSnapshotInput {
  storeId: string;
  orderId: string;
  paymentIntentId: string;
  paymentId: string;
}

/**
 * Freezes the commercial state used to authorize payment before fulfillment can
 * mutate the operational order. The document is create-once: retries validate
 * identity and never rewrite the original snapshot.
 */
export const freezeOrderCommercialSnapshot = async (
  input: FreezeOrderCommercialSnapshotInput
): Promise<void> => {
  const orderRef = adminDb.doc(
    `artifacts/${input.storeId}/public/data/customerOrders/${input.orderId}`
  );
  const snapshotRef = adminDb.doc(
    orderCommercialSnapshotPath(input.storeId, input.orderId)
  );

  await adminDb.runTransaction(async transaction => {
    const [existingSnapshot, orderSnapshot] = await Promise.all([
      transaction.get(snapshotRef),
      transaction.get(orderRef),
    ]);

    if (!orderSnapshot.exists) throw new Error('CHECKOUT_ORDER_NOT_FOUND');
    const order = orderSnapshot.data() as Record<string, unknown>;
    if (
      clean(order.id) !== input.orderId ||
      clean(order.storeId) !== input.storeId ||
      clean(order.paymentIntentId) !== input.paymentIntentId ||
      clean(order.paymentId) !== input.paymentId
    ) {
      throw new Error('CHECKOUT_ORDER_PAYMENT_AUTHORITY_MISMATCH');
    }

    if (existingSnapshot.exists) {
      const frozen = existingSnapshot.data() as Record<string, unknown>;
      if (
        clean(frozen.orderId) !== input.orderId ||
        clean(frozen.storeId) !== input.storeId ||
        clean(frozen.paymentIntentId) !== input.paymentIntentId ||
        clean(frozen.paymentId) !== input.paymentId
      ) {
        throw new Error('CHECKOUT_COMMERCIAL_SNAPSHOT_CONFLICT');
      }
      return;
    }

    const capturedAt = new Date().toISOString();
    transaction.create(snapshotRef, {
      schemaVersion: ORDER_COMMERCIAL_SNAPSHOT_SCHEMA_VERSION,
      storeId: input.storeId,
      orderId: input.orderId,
      paymentIntentId: input.paymentIntentId,
      paymentId: input.paymentId,
      capturedAt,
      source: 'checkout_payment_authorization',
      order,
    });
  });
};
