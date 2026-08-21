import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin';
import {
  assertPaymentStatusTransition,
  normalizeCanonicalPayment,
  type CanonicalPayment,
} from '../../src/utils/canonicalPayment';
import {
  buildPaymentWebhookIdempotencyKey,
  normalizeVerifiedProviderEvent,
  paymentStatusFromProviderEvent,
  type VerifiedPaymentProviderEvent,
} from '../../src/utils/paymentProvider';

interface ProcessPaymentWebhookResult {
  duplicate: boolean;
  paymentId: string;
  status: CanonicalPayment['status'];
}

const EVENT_COLLECTION = 'paymentWebhookEvents';

const paymentPath = (storeId: string, paymentId: string): string =>
  `stores/${storeId}/payments/${paymentId}`;

const eventPath = (key: string): string =>
  `${EVENT_COLLECTION}/${Buffer.from(key).toString('base64url')}`;

export const processVerifiedPaymentWebhook = async (input: {
  storeId: string;
  paymentId: string;
  event: VerifiedPaymentProviderEvent;
}): Promise<ProcessPaymentWebhookResult> => {
  const storeId = input.storeId.trim();
  const paymentId = input.paymentId.trim();
  if (!storeId || !paymentId) throw new Error('PAYMENT_WEBHOOK_TARGET_REQUIRED');

  const event = normalizeVerifiedProviderEvent(input.event);
  const idempotencyKey = buildPaymentWebhookIdempotencyKey(event);

  return adminDb.runTransaction(async transaction => {
    const paymentRef = adminDb.doc(paymentPath(storeId, paymentId));
    const eventRef = adminDb.doc(eventPath(idempotencyKey));
    const [paymentSnapshot, eventSnapshot] = await Promise.all([
      transaction.get(paymentRef),
      transaction.get(eventRef),
    ]);

    if (eventSnapshot.exists) {
      const current = paymentSnapshot.data() as CanonicalPayment | undefined;
      if (!current) throw new Error('PAYMENT_NOT_FOUND');
      return {
        duplicate: true,
        paymentId,
        status: current.status,
      };
    }

    if (!paymentSnapshot.exists) throw new Error('PAYMENT_NOT_FOUND');
    const current = normalizeCanonicalPayment(
      paymentSnapshot.data() as CanonicalPayment
    );

    if (current.provider && current.provider !== event.provider) {
      throw new Error('PAYMENT_PROVIDER_MISMATCH');
    }
    if (
      current.providerPaymentId &&
      current.providerPaymentId !== event.providerPaymentId
    ) {
      throw new Error('PROVIDER_PAYMENT_ID_MISMATCH');
    }
    if (Number(current.amount.toFixed(2)) !== event.amount) {
      throw new Error('PAYMENT_AMOUNT_MISMATCH');
    }

    const nextStatus = paymentStatusFromProviderEvent(event.eventType);
    if (current.status !== nextStatus) {
      assertPaymentStatusTransition(current.status, nextStatus);
    }

    const now = FieldValue.serverTimestamp();
    transaction.set(eventRef, {
      idempotencyKey,
      provider: event.provider,
      eventId: event.eventId,
      eventType: event.eventType,
      providerPaymentId: event.providerPaymentId,
      paymentIntentId: event.paymentIntentId,
      storeId,
      paymentId,
      occurredAt: event.occurredAt,
      processedAt: now,
    });

    transaction.update(paymentRef, {
      status: nextStatus,
      provider: event.provider,
      providerPaymentId: event.providerPaymentId,
      updatedAt: new Date().toISOString(),
      ...(nextStatus === 'paid' ? { paidAt: event.occurredAt } : {}),
      ...(nextStatus === 'refunded' ? { refundedAt: event.occurredAt } : {}),
    });

    return {
      duplicate: false,
      paymentId,
      status: nextStatus,
    };
  });
};
