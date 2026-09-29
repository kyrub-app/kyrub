import { adminDb } from '../firebaseAdmin.js';
import {
  normalizeCanonicalPaymentIntent,
  type CanonicalPaymentIntent,
} from '../../src/utils/canonicalPaymentIntent.js';
import type { CustomerOrder } from '../../src/utils/customerOrders.js';
import { settleExistingMarketplaceOrder } from '../../src/utils/paymentOrderMaterialization.js';

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const operationalOrderPath = (storeId: string, orderId: string): string =>
  `artifacts/${storeId}/public/data/customerOrders/${orderId}`;

const orderFromServerRecord = (value: Record<string, unknown>): CustomerOrder => {
  if (
    !clean(value.id) ||
    !clean(value.storeId) ||
    !clean(value.buyerId) ||
    !Array.isArray(value.items) ||
    !clean(value.status) ||
    !clean(value.paymentStatus)
  ) {
    throw new Error('PAYMENT_ORDER_SETTLEMENT_ORDER_INVALID');
  }
  return value as unknown as CustomerOrder;
};

export const settleMarketplaceOperationalOrderAfterPayment = async (input: {
  storeId: string;
  orderId: string;
  paymentIntentId: string;
  occurredAt: string;
}): Promise<void> => {
  const storeId = input.storeId.trim();
  const orderId = input.orderId.trim();
  const paymentIntentId = input.paymentIntentId.trim();
  if (!storeId || !orderId || !paymentIntentId) {
    throw new Error('PAYMENT_ORDER_SETTLEMENT_TARGET_REQUIRED');
  }

  await adminDb.runTransaction(async transaction => {
    const orderRef = adminDb.doc(operationalOrderPath(storeId, orderId));
    const tenantRef = adminDb.doc(`tenants/${storeId}`);
    const intentRef = adminDb.doc(`stores/${storeId}/paymentIntents/${paymentIntentId}`);
    const [orderSnapshot, tenantSnapshot, intentSnapshot] = await Promise.all([
      transaction.get(orderRef),
      transaction.get(tenantRef),
      transaction.get(intentRef),
    ]);
    if (!orderSnapshot.exists || !intentSnapshot.exists) {
      throw new Error('PAYMENT_ORDER_SETTLEMENT_STATE_MISSING');
    }

    const rawOrder = orderSnapshot.data() as Record<string, unknown>;
    const order = orderFromServerRecord(rawOrder);
    const intent = normalizeCanonicalPaymentIntent(
      intentSnapshot.data() as CanonicalPaymentIntent
    );
    if (
      intent.context !== 'marketplace' ||
      intent.target.orderId !== orderId ||
      intent.storeId !== storeId ||
      intent.buyerId !== order.buyerId
    ) {
      throw new Error('PAYMENT_ORDER_SETTLEMENT_TARGET_MISMATCH');
    }

    if (order.paymentStatus === 'paid') return;
    if (order.status !== 'accepted') {
      throw new Error('PAYMENT_ORDER_SETTLEMENT_REQUIRES_ACCEPTED_ORDER');
    }

    const settled = settleExistingMarketplaceOrder({
      order,
      intent,
      now: input.occurredAt,
    });
    transaction.set(orderRef, { ...rawOrder, ...settled });

    const canonicalStoreId = clean(tenantSnapshot.data()?.canonicalStoreId);
    if (canonicalStoreId) {
      transaction.set(
        adminDb.doc(`stores/${canonicalStoreId}/orders/${orderId}`),
        {
          ...settled,
          storeId: canonicalStoreId,
          legacyStoreId: storeId,
          legacyUpdatedAt: settled.updatedAt,
        },
        { merge: true }
      );
    }
  });
};
