import { adminDb } from '../firebaseAdmin.js';
import type { Transaction } from 'firebase-admin/firestore';
import { normalizeCanonicalPayment, type CanonicalPayment } from '../../src/utils/canonicalPayment.js';
import { resolveOrderReleaseDecision, type PrepaidOperationalRelease } from '../../shared/orderReleasePolicy.js';
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

const cents = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 ||
      !Number.isSafeInteger(Math.round(value * 100)) || Math.abs(value * 100 - Math.round(value * 100)) > 1e-6) {
    throw Error('PAYMENT_ORDER_SETTLEMENT_AMOUNT_INVALID');
  }
  return Math.round(value * 100);
};
const validReference = (value: unknown): value is string => typeof value === 'string' &&
  value.length > 0 && value.length <= 180 && !value.includes('/');

export const assertPrepaidStoreMirrorIdentity = async (transaction: Transaction, storeId: string, canonicalStoreId: string): Promise<void> => {
  if (!canonicalStoreId) return;
  if (!validReference(canonicalStoreId)) throw Error('PAYMENT_ORDER_SETTLEMENT_STORE_MISMATCH');
  const store = await transaction.get(adminDb.doc(`stores/${canonicalStoreId}`));
  if (store.get('ownerId') !== storeId || (store.get('legacyTenantId') || store.get('ownerId')) !== storeId) {
    throw Error('PAYMENT_ORDER_SETTLEMENT_STORE_MISMATCH');
  }
};

/** Read-only transaction preparation, reused by approval, settlement and KDS transitions. */
export const loadPrepaidPaymentConfirmation = async (input: {
  transaction: Transaction; storeId: string; orderId: string; order: Record<string, unknown>; now: string;
}): Promise<PrepaidOperationalRelease | null> => {
  const { transaction, storeId, orderId, order } = input;
  if (order.id !== orderId || order.storeId !== storeId || !validReference(order.buyerId)) {
    throw Error('PAYMENT_ORDER_SETTLEMENT_TARGET_MISMATCH');
  }
  if (!validReference(order.paymentIntentId) || !validReference(order.paymentId)) return null;
  const [intentDoc, paymentDoc] = await Promise.all([
    transaction.get(adminDb.doc(`stores/${storeId}/paymentIntents/${order.paymentIntentId}`)),
    transaction.get(adminDb.doc(`stores/${storeId}/payments/${order.paymentId}`)),
  ]);
  if (!intentDoc.exists || !paymentDoc.exists) return null;
  const intentData = intentDoc.data()!, paymentData = paymentDoc.data()!;
  const intent = normalizeCanonicalPaymentIntent(intentData as CanonicalPaymentIntent);
  const payment = normalizeCanonicalPayment(paymentData as CanonicalPayment);
  if (intent.context !== 'marketplace' || payment.context !== 'marketplace' ||
      intent.id !== order.paymentIntentId || payment.id !== order.paymentId ||
      intent.target.orderId !== orderId || payment.orderId !== orderId ||
      intent.storeId !== storeId || payment.storeId !== storeId ||
      intent.buyerId !== order.buyerId || payment.buyerId !== order.buyerId || payment.paymentIntentId !== intent.id) {
    throw Error('PAYMENT_ORDER_SETTLEMENT_TARGET_MISMATCH');
  }
  const amountMinor = cents(order.total);
  if (cents(intentData.amount) !== amountMinor || cents(paymentData.amount) !== amountMinor) {
    throw Error('PAYMENT_ORDER_SETTLEMENT_AMOUNT_MISMATCH');
  }
  if (intent.status !== 'paid' || payment.status !== 'paid') return null;
  const key = clean(paymentData.verifiedEventKey);
  if (!key || key.length > 1200 || !payment.providerPaymentId || payment.provider !== intent.provider ||
      payment.providerPaymentId !== intent.providerIntentId || payment.method !== intent.method) return null;
  const receiptDoc = await transaction.get(adminDb.doc(`paymentWebhookEvents/${Buffer.from(key).toString('base64url')}`));
  const receipt = receiptDoc.data();
  if (!receiptDoc.exists || receipt?.idempotencyKey !== key || receipt.eventType !== 'payment.paid' ||
      receipt.storeId !== storeId || receipt.paymentId !== payment.id || receipt.paymentIntentId !== intent.id ||
      receipt.provider !== payment.provider || receipt.providerPaymentId !== payment.providerPaymentId ||
      receipt.amountMinor !== amountMinor || receipt.currency !== 'BRL' || receipt.method !== payment.method ||
      receipt.occurredAt !== payment.paidAt || !Number.isFinite(Date.parse(receipt.occurredAt))) return null;
  const recipientAccountId = clean(receipt.recipientAccountId);
  if (payment.provider === 'mercado-pago' && !recipientAccountId) return null;
  const previous = order.operationalRelease as PrepaidOperationalRelease | undefined;
  return { schemaVersion: 1, storeId, orderId, buyerId: intent.buyerId, paymentIntentId: intent.id,
    paymentId: payment.id, providerPaymentId: payment.providerPaymentId, paymentEventKey: key, recipientAccountId,
    amountMinor, authorizedAt: previous?.paymentEventKey === key && Number.isFinite(Date.parse(previous.authorizedAt))
      ? previous.authorizedAt : input.now };
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
  if (!validReference(storeId) || !validReference(orderId) || !validReference(paymentIntentId)) {
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
      intent.id !== paymentIntentId || order.id !== orderId || order.storeId !== storeId ||
      intent.target.orderId !== orderId ||
      intent.storeId !== storeId ||
      intent.buyerId !== order.buyerId
    ) {
      throw new Error('PAYMENT_ORDER_SETTLEMENT_TARGET_MISMATCH');
    }

    // Do not settle an order using a paid intent for a different amount.
    // Compare integer cents to avoid floating-point representation errors.
    const orderTotalCents = Math.round(order.total * 100);
    const intentAmountCents = Math.round(intent.amount * 100);
    if (
      !Number.isSafeInteger(orderTotalCents) ||
      !Number.isSafeInteger(intentAmountCents) ||
      orderTotalCents < 0 ||
      orderTotalCents !== intentAmountCents
    ) {
      throw new Error('PAYMENT_ORDER_SETTLEMENT_AMOUNT_MISMATCH');
    }

    // A settled order must not be replayed with a different payment intent.
    // The authoritative intent must itself be paid, including on retries.
    if (intent.status !== 'paid') {
      throw new Error('PAYMENT_ORDER_SETTLEMENT_REQUIRES_VERIFIED_PAYMENT');
    }
    const recordedIntentId = clean(rawOrder.paymentIntentId);
    if (recordedIntentId && recordedIntentId !== paymentIntentId) {
      throw new Error('PAYMENT_ORDER_SETTLEMENT_INTENT_MISMATCH');
    }
    const prepaid = rawOrder.releaseMode === 'pay_before_fulfillment';
    if (order.status === 'rejected' || order.status === 'cancelled') {
      // A late payment remains in the financial ledger; never resurrect a closed request.
      if (prepaid) return;
      throw new Error('PAYMENT_ORDER_SETTLEMENT_ORDER_CLOSED');
    }
    if (order.paymentStatus === 'paid' && !prepaid) return;
    if (order.status !== 'accepted' && !(prepaid && order.status === 'pending') &&
        !(prepaid && ['preparing', 'ready', 'out_for_delivery', 'completed'].includes(order.status))) {
      throw new Error('PAYMENT_ORDER_SETTLEMENT_REQUIRES_ACCEPTED_ORDER');
    }

    const confirmation = prepaid ? await loadPrepaidPaymentConfirmation({ transaction, storeId, orderId,
      order: rawOrder, now: input.occurredAt }) : null;
    if (prepaid && !confirmation) throw Error('PAYMENT_ORDER_SETTLEMENT_REQUIRES_VERIFIED_PAYMENT');
    const release = prepaid ? resolveOrderReleaseDecision({ mode: 'pay_before_fulfillment',
      approval: order.status === 'pending' ? 'pending' : 'approved', settlement: 'paid', paymentVerifiedByServer: true }) : null;
    const canonicalStoreId = clean(tenantSnapshot.data()?.canonicalStoreId);
    if (prepaid) await assertPrepaidStoreMirrorIdentity(transaction, storeId, canonicalStoreId);

    const settled = settleExistingMarketplaceOrder({
      order,
      intent,
      now: input.occurredAt,
    });
    const releasePatch = prepaid ? { operationalRelease: release?.fulfillmentAuthorized ? confirmation : null } : {};
    transaction.set(orderRef, { ...rawOrder, ...settled, paymentIntentId, ...releasePatch });

    if (canonicalStoreId) {
      transaction.set(
        adminDb.doc(`stores/${canonicalStoreId}/orders/${orderId}`),
        {
          ...settled,
          paymentIntentId,
          ...releasePatch,
          storeId: canonicalStoreId,
          legacyStoreId: storeId,
          legacyUpdatedAt: settled.updatedAt,
        },
        { merge: true }
      );
    }
  });
};
