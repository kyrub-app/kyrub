import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin';
import {
  assertPaymentStatusTransition,
  normalizeCanonicalPayment,
  type CanonicalPayment,
} from '../../src/utils/canonicalPayment';
import {
  normalizeCanonicalPaymentIntent,
  type CanonicalPaymentIntent,
  type PaymentIntentStatus,
} from '../../src/utils/canonicalPaymentIntent';
import { materializePaidMarketplaceOrder } from '../../src/utils/paymentOrderMaterialization';
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
  orderId: string;
  orderMaterialized: boolean;
}

const EVENT_COLLECTION = 'paymentWebhookEvents';

const paymentPath = (storeId: string, paymentId: string): string =>
  `stores/${storeId}/payments/${paymentId}`;

const paymentIntentPath = (storeId: string, paymentIntentId: string): string =>
  `stores/${storeId}/paymentIntents/${paymentIntentId}`;

const operationalOrderPath = (storeId: string, orderId: string): string =>
  `artifacts/${storeId}/public/data/customerOrders/${orderId}`;

const eventPath = (key: string): string =>
  `${EVENT_COLLECTION}/${Buffer.from(key).toString('base64url')}`;

const intentStatusForPaymentStatus = (
  status: CanonicalPayment['status']
): PaymentIntentStatus | null => {
  if (status === 'paid') return 'paid';
  if (status === 'failed') return 'failed';
  if (status === 'expired') return 'expired';
  return null;
};

const assertMarketplacePaymentIntentMatchesPayment = (
  payment: CanonicalPayment,
  intent: CanonicalPaymentIntent,
  event: VerifiedPaymentProviderEvent
): void => {
  if (intent.id !== event.paymentIntentId) {
    throw new Error('PAYMENT_INTENT_ID_MISMATCH');
  }
  if (intent.storeId !== payment.storeId) {
    throw new Error('PAYMENT_INTENT_STORE_MISMATCH');
  }
  if (intent.buyerId !== payment.buyerId) {
    throw new Error('PAYMENT_INTENT_BUYER_MISMATCH');
  }
  if (intent.orderDraft.draftId !== payment.orderId) {
    throw new Error('PAYMENT_INTENT_ORDER_MISMATCH');
  }
  if (intent.amount !== payment.amount || intent.amount !== event.amount) {
    throw new Error('PAYMENT_INTENT_AMOUNT_MISMATCH');
  }
  if (intent.method !== payment.method || intent.method !== event.method) {
    throw new Error('PAYMENT_INTENT_METHOD_MISMATCH');
  }
  if (intent.provider && intent.provider !== event.provider) {
    throw new Error('PAYMENT_INTENT_PROVIDER_MISMATCH');
  }
};

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
    const intentRef = adminDb.doc(paymentIntentPath(storeId, event.paymentIntentId));

    const [paymentSnapshot, eventSnapshot, intentSnapshot] = await Promise.all([
      transaction.get(paymentRef),
      transaction.get(eventRef),
      transaction.get(intentRef),
    ]);

    if (!paymentSnapshot.exists) throw new Error('PAYMENT_NOT_FOUND');
    const current = normalizeCanonicalPayment(
      paymentSnapshot.data() as CanonicalPayment
    );

    if (current.storeId !== storeId || current.id !== paymentId) {
      throw new Error('PAYMENT_WEBHOOK_TARGET_MISMATCH');
    }

    const duplicate = eventSnapshot.exists;
    const requestedStatus = paymentStatusFromProviderEvent(event.eventType);
    const effectiveStatus = duplicate ? current.status : requestedStatus;

    if (!duplicate) {
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
      if (current.method !== event.method) {
        throw new Error('PAYMENT_METHOD_MISMATCH');
      }
      if (current.status !== requestedStatus) {
        assertPaymentStatusTransition(current.status, requestedStatus);
      }
    }

    let orderId = '';
    let orderMaterialized = false;
    let intent: CanonicalPaymentIntent | null = null;
    let operationalOrder: ReturnType<typeof materializePaidMarketplaceOrder> | null = null;
    let operationalOrderExists = false;
    const intentStatus = intentStatusForPaymentStatus(effectiveStatus);

    // Firestore transactions require every read to happen before any write.
    // Resolve and read the operational order before scheduling intent/payment mutations.
    if (current.context === 'marketplace') {
      if (!intentSnapshot.exists) throw new Error('PAYMENT_INTENT_NOT_FOUND');
      intent = normalizeCanonicalPaymentIntent(
        intentSnapshot.data() as CanonicalPaymentIntent
      );
      assertMarketplacePaymentIntentMatchesPayment(current, intent, event);

      if (effectiveStatus === 'paid') {
        const paidIntent: CanonicalPaymentIntent = {
          ...intent,
          status: 'paid',
          provider: event.provider,
          providerIntentId: event.paymentIntentId,
          updatedAt: event.occurredAt,
        };
        operationalOrder = materializePaidMarketplaceOrder({
          intent: paidIntent,
          now: event.occurredAt,
        });
        const orderRef = adminDb.doc(
          operationalOrderPath(operationalOrder.storeId, operationalOrder.id)
        );
        operationalOrderExists = (await transaction.get(orderRef)).exists;
        orderId = operationalOrder.id;
      }
    }

    if (intent && intentStatus && intent.status !== intentStatus) {
      if (intent.status !== 'pending') {
        throw new Error(`PAYMENT_INTENT_STATUS_CONFLICT:${intent.status}->${intentStatus}`);
      }
      transaction.update(intentRef, {
        status: intentStatus,
        updatedAt: event.occurredAt,
        ...(intentStatus === 'paid'
          ? {
              provider: event.provider,
              providerIntentId: event.paymentIntentId,
            }
          : {}),
      });
    }

    if (operationalOrder && !operationalOrderExists) {
      const orderRef = adminDb.doc(
        operationalOrderPath(operationalOrder.storeId, operationalOrder.id)
      );
      transaction.set(orderRef, operationalOrder);
      orderMaterialized = true;
    }

    if (!duplicate) {
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
        status: requestedStatus,
        provider: event.provider,
        providerPaymentId: event.providerPaymentId,
        updatedAt: new Date().toISOString(),
        ...(requestedStatus === 'paid' ? { paidAt: event.occurredAt } : {}),
        ...(requestedStatus === 'refunded' ? { refundedAt: event.occurredAt } : {}),
      });
    }

    return {
      duplicate,
      paymentId,
      status: effectiveStatus,
      orderId,
      orderMaterialized,
    };
  });
};
