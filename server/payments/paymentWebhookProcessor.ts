import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import {
  assertPaymentStatusTransition,
  normalizeCanonicalPayment,
  type CanonicalPayment,
} from '../../src/utils/canonicalPayment.js';
import {
  normalizeCanonicalPaymentIntent,
  type CanonicalPaymentIntent,
  type PaymentIntentStatus,
} from '../../src/utils/canonicalPaymentIntent.js';
import { materializePaidMarketplaceOrder } from '../../src/utils/paymentOrderMaterialization.js';
import {
  buildPaymentWebhookIdempotencyKey,
  normalizeVerifiedProviderEvent,
  paymentStatusFromProviderEvent,
  type VerifiedPaymentProviderEvent,
} from '../../src/utils/paymentProvider.js';
import {
  buildStorePointPurchaseEntry,
  buildStorePointPurchaseEntryId,
  buildStorePointReversalEntry,
  type StorePointLedgerEntry,
} from '../../shared/storePoints.js';
import {
  applyStoreChallengePaymentPlan,
  prepareStoreChallengePaymentPlan,
  type StoreChallengePaymentPlan,
} from './storeChallengeProcessor.js';

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

const promotionPath = (storeId: string, promotionId: string): string =>
  `stores/${storeId}/promotions/${promotionId}`;

const promotionRedemptionPath = (
  storeId: string,
  promotionId: string,
  paymentId: string
): string => `stores/${storeId}/promotions/${promotionId}/redemptions/${paymentId}`;

const storePointLedgerPath = (storeId: string, entryId: string): string =>
  `stores/${storeId}/storePointLedger/${Buffer.from(entryId).toString('base64url')}`;

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

const assertStorePointPurchaseMatchesPayment = (
  entry: StorePointLedgerEntry,
  payment: CanonicalPayment,
  intent: CanonicalPaymentIntent
): void => {
  if (
    entry.kind !== 'purchase_base' ||
    entry.amount <= 0 ||
    entry.storeId !== payment.storeId ||
    entry.customerId !== payment.buyerId ||
    entry.orderId !== payment.orderId ||
    entry.paymentId !== payment.id ||
    entry.paymentIntentId !== intent.id
  ) {
    throw new Error('STORE_POINTS_PURCHASE_LEDGER_MISMATCH');
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
    let promotionRef: ReturnType<typeof adminDb.doc> | null = null;
    let promotionExists = false;
    let redemptionRef: ReturnType<typeof adminDb.doc> | null = null;
    let redemptionExists = false;
    let pointLedgerEntry: StorePointLedgerEntry | null = null;
    let pointLedgerRef: ReturnType<typeof adminDb.doc> | null = null;
    let pointLedgerExists = false;
    let pointReversalEntry: StorePointLedgerEntry | null = null;
    let pointReversalRef: ReturnType<typeof adminDb.doc> | null = null;
    let pointReversalExists = false;
    let challengePlan: StoreChallengePaymentPlan | null = null;
    const intentStatus = intentStatusForPaymentStatus(effectiveStatus);

    // Firestore transactions require every read to happen before any write.
    // Resolve order, coupon, points and challenge documents first.
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

        const promotion = intent.orderDraft.promotionSnapshot;
        if (promotion && (intent.orderDraft.discountTotal ?? 0) > 0) {
          promotionRef = adminDb.doc(promotionPath(storeId, promotion.promotionId));
          redemptionRef = adminDb.doc(
            promotionRedemptionPath(storeId, promotion.promotionId, paymentId)
          );
          const [promotionSnapshot, redemptionSnapshot] = await Promise.all([
            transaction.get(promotionRef),
            transaction.get(redemptionRef),
          ]);
          promotionExists = promotionSnapshot.exists;
          redemptionExists = redemptionSnapshot.exists;
        }

        pointLedgerEntry = buildStorePointPurchaseEntry({
          storeId,
          customerId: intent.buyerId,
          orderId: intent.orderDraft.draftId,
          paymentId,
          paymentIntentId: intent.id,
          occurredAt: event.occurredAt,
          items: intent.orderDraft.items,
        });
        if (pointLedgerEntry) {
          pointLedgerRef = adminDb.doc(
            storePointLedgerPath(storeId, pointLedgerEntry.id)
          );
          pointLedgerExists = (await transaction.get(pointLedgerRef)).exists;
        }
      } else if (effectiveStatus === 'refunded') {
        const purchaseEntryId = buildStorePointPurchaseEntryId(paymentId);
        const purchaseLedgerRef = adminDb.doc(
          storePointLedgerPath(storeId, purchaseEntryId)
        );
        const purchaseLedgerSnapshot = await transaction.get(purchaseLedgerRef);
        if (purchaseLedgerSnapshot.exists) {
          const purchaseEntry = purchaseLedgerSnapshot.data() as StorePointLedgerEntry;
          assertStorePointPurchaseMatchesPayment(purchaseEntry, current, intent);
          pointReversalEntry = buildStorePointReversalEntry({
            reversalId: `refund:${paymentId}`,
            original: purchaseEntry,
            reason: 'payment_refunded',
            occurredAt: event.occurredAt,
          });
          pointReversalRef = adminDb.doc(
            storePointLedgerPath(storeId, pointReversalEntry.id)
          );
          pointReversalExists = (await transaction.get(pointReversalRef)).exists;
        }
      }

      if (effectiveStatus === 'paid' || effectiveStatus === 'refunded') {
        challengePlan = await prepareStoreChallengePaymentPlan({
          transaction,
          storeId,
          paymentId,
          status: effectiveStatus,
          intent,
          occurredAt: event.occurredAt,
        });
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

    if (pointLedgerEntry && pointLedgerRef && !pointLedgerExists) {
      transaction.set(pointLedgerRef, pointLedgerEntry);
    }

    if (pointReversalEntry && pointReversalRef && !pointReversalExists) {
      transaction.set(pointReversalRef, pointReversalEntry);
    }

    if (challengePlan) {
      applyStoreChallengePaymentPlan(transaction, challengePlan);
    }

    if (
      intent &&
      effectiveStatus === 'paid' &&
      redemptionRef &&
      !redemptionExists
    ) {
      const promotion = intent.orderDraft.promotionSnapshot!;
      transaction.set(redemptionRef, {
        promotionId: promotion.promotionId,
        code: promotion.code,
        storeId,
        buyerId: intent.buyerId,
        paymentIntentId: intent.id,
        paymentId,
        orderId: intent.orderDraft.draftId,
        subtotal: intent.orderDraft.subtotal,
        discountTotal: intent.orderDraft.discountTotal ?? 0,
        paidTotal: intent.orderDraft.total,
        redeemedAt: event.occurredAt,
        provider: event.provider,
        providerPaymentId: event.providerPaymentId,
      });
      // A promotion may be administratively removed after a Pix was issued.
      // The immutable payment snapshot still honors the paid order; only update
      // the live aggregate when the original promotion document remains.
      if (promotionRef && promotionExists) {
        transaction.update(promotionRef, {
          redemptionCount: FieldValue.increment(1),
          updatedAt: event.occurredAt,
        });
      }
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
