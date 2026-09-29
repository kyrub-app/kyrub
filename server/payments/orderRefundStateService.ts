import { adminDb } from '../firebaseAdmin.js';

export type OperationalOrderRefundStatus =
  | 'requested'
  | 'processing'
  | 'refunded'
  | 'failed';

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

export interface OperationalOrderRefundStateInput {
  storeId: string;
  orderId: string;
  paymentId: string;
  provider: string;
  amount: number;
  status: OperationalOrderRefundStatus;
  reason?: string;
  requestedAt?: string;
  refundedAt?: string;
  failureCode?: string;
}

export const writeOperationalOrderRefundState = async (
  input: OperationalOrderRefundStateInput
): Promise<void> => {
  const storeId = clean(input.storeId);
  const orderId = clean(input.orderId);
  const paymentId = clean(input.paymentId);
  const provider = clean(input.provider);
  const reason = clean(input.reason);
  const requestedAt = clean(input.requestedAt);
  const refundedAt = clean(input.refundedAt);
  const failureCode = clean(input.failureCode);
  const amount = Number(input.amount);

  if (!storeId || !orderId || !paymentId || !provider) {
    throw new Error('ORDER_REFUND_STATE_TARGET_REQUIRED');
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('ORDER_REFUND_STATE_AMOUNT_INVALID');
  }

  const legacyRef = adminDb.doc(
    `artifacts/${storeId}/public/data/customerOrders/${orderId}`
  );
  const tenantRef = adminDb.doc(`tenants/${storeId}`);
  const [legacySnapshot, tenantSnapshot] = await Promise.all([
    legacyRef.get(),
    tenantRef.get(),
  ]);
  if (!legacySnapshot.exists) {
    throw new Error('ORDER_REFUND_STATE_ORDER_NOT_FOUND');
  }

  const now = new Date().toISOString();
  const patch = {
    refundStatus: input.status,
    refundPaymentId: paymentId,
    refundProvider: provider,
    refundAmount: Number(amount.toFixed(2)),
    refundReason: reason,
    refundRequestedAt: requestedAt || now,
    refundedAt: input.status === 'refunded' ? refundedAt || now : '',
    refundFailureCode: input.status === 'failed' ? failureCode : '',
    updatedAt: now,
  };

  const batch = adminDb.batch();
  batch.set(legacyRef, patch, { merge: true });

  const canonicalStoreId = clean(tenantSnapshot.data()?.canonicalStoreId);
  if (canonicalStoreId) {
    const canonicalRef = adminDb.doc(`stores/${canonicalStoreId}/orders/${orderId}`);
    const canonicalSnapshot = await canonicalRef.get();
    if (canonicalSnapshot.exists) {
      batch.set(canonicalRef, patch, { merge: true });
    }
  }

  await batch.commit();
};
