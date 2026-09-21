import { adminDb } from '../firebaseAdmin.js';
import {
  assertPaymentStatusTransition,
  normalizeCanonicalPayment,
  type CanonicalPayment,
} from '../../src/utils/canonicalPayment.js';
import {
  normalizeCanonicalPaymentIntent,
  type ExistingOrderPaymentIntentDocument,
} from '../../src/utils/canonicalPaymentIntent.js';

const clean = (value: unknown, max = 220): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

export const expireStaleUnboundLocalPayment = async (input: {
  canonicalStoreId: string;
  orderId: string;
  payment: CanonicalPayment;
  now?: Date;
}): Promise<CanonicalPayment> => {
  const canonicalStoreId = clean(input.canonicalStoreId, 180);
  const orderId = clean(input.orderId);
  const paymentIntentId = clean(input.payment.paymentIntentId);
  const now = input.now ?? new Date();

  if (
    !canonicalStoreId ||
    !orderId ||
    !paymentIntentId ||
    input.payment.orderId !== orderId ||
    input.payment.storeId !== canonicalStoreId ||
    input.payment.status !== 'pending' ||
    clean(input.payment.provider, 80) ||
    clean(input.payment.providerPaymentId)
  ) {
    return input.payment;
  }
  if (Number.isNaN(now.getTime())) return input.payment;

  const paymentRef = adminDb.doc(
    `stores/${canonicalStoreId}/payments/${input.payment.id}`
  );
  const intentRef = adminDb.doc(
    `stores/${canonicalStoreId}/paymentIntents/${paymentIntentId}`
  );

  return adminDb.runTransaction(async transaction => {
    const [paymentSnapshot, intentSnapshot] = await Promise.all([
      transaction.get(paymentRef),
      transaction.get(intentRef),
    ]);
    if (!paymentSnapshot.exists || !intentSnapshot.exists) return input.payment;

    const payment = normalizeCanonicalPayment(
      paymentSnapshot.data() as CanonicalPayment
    );
    const intent = normalizeCanonicalPaymentIntent(
      intentSnapshot.data() as ExistingOrderPaymentIntentDocument
    );

    if (
      payment.id !== input.payment.id ||
      payment.storeId !== canonicalStoreId ||
      payment.orderId !== orderId ||
      payment.paymentIntentId !== intent.id ||
      payment.status !== 'pending' ||
      intent.status !== 'pending' ||
      intent.storeId !== canonicalStoreId ||
      intent.context !== payment.context ||
      intent.target.kind !== 'existing_order' ||
      intent.target.orderId !== orderId ||
      intent.buyerId !== payment.buyerId ||
      intent.amount !== payment.amount ||
      intent.method !== payment.method ||
      intent.idempotencyKey !== payment.idempotencyKey ||
      clean(payment.provider, 80) ||
      clean(payment.providerPaymentId) ||
      clean(intent.provider, 80) ||
      clean(intent.providerIntentId)
    ) {
      return payment;
    }

    const expiresAt = Date.parse(intent.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt > now.getTime()) return payment;

    assertPaymentStatusTransition(payment.status, 'expired');
    const updatedAt = now.toISOString();
    transaction.update(paymentRef, { status: 'expired', updatedAt });
    transaction.update(intentRef, { status: 'expired', updatedAt });

    return normalizeCanonicalPayment({
      ...payment,
      status: 'expired',
      updatedAt,
    });
  });
};
