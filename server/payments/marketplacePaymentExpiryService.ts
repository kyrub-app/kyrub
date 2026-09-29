import { adminDb } from '../firebaseAdmin.js';
import {
  normalizeCanonicalPayment,
  type CanonicalPayment,
} from '../../src/utils/canonicalPayment.js';
import {
  normalizeCanonicalPaymentIntent,
  type CanonicalPaymentIntent,
} from '../../src/utils/canonicalPaymentIntent.js';
import type {
  PaymentProviderEventType,
  VerifiedPaymentProviderEvent,
} from '../../src/utils/paymentProvider.js';
import {
  cancelMercadoPagoPayment,
  getMercadoPagoPayment,
} from './mercadoPagoPixProvider.js';
import { processVerifiedPaymentWebhook } from './paymentWebhookProcessor.js';
import { settleMarketplaceOperationalOrderAfterPayment } from './marketplaceOrderPaymentSettlementService.js';
import {
  attachPreparedCustomerDestinationResolutionToOperationalOrder,
  prepareCustomerDestinationResolutionForPaymentIntent,
} from '../delivery/customerDestinationOrderResolutionService.js';
import {
  markMarketplaceOrderInventoryReservationPaymentConfirmed,
  releaseMarketplaceReservationForTerminalPayment,
} from '../inventory/marketplaceOrderInventoryReservationService.js';

const RESERVATION_COLLECTION = 'inventoryOrderReservations';
const DEFAULT_BATCH_SIZE = 50;
const MAX_BATCH_SIZE = 100;

const clean = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number'
    ? String(value).trim()
    : '';

const operationalOrderPath = (storeId: string, orderId: string): string =>
  `artifacts/${storeId}/public/data/customerOrders/${orderId}`;

const validBatchSize = (value: number): number =>
  Number.isInteger(value) && value > 0
    ? Math.min(value, MAX_BATCH_SIZE)
    : DEFAULT_BATCH_SIZE;

const providerEventType = (
  payment: Awaited<ReturnType<typeof getMercadoPagoPayment>>,
  forcedExpiry = false
): PaymentProviderEventType | null => {
  const status = clean(payment.status).toLowerCase();
  const detail = clean(payment.status_detail).toLowerCase();
  if (status === 'approved') return 'payment.paid';
  if (status === 'rejected') return 'payment.failed';
  if (status === 'cancelled') {
    if (forcedExpiry || detail.includes('expired')) return 'payment.expired';
    return 'payment.cancelled';
  }
  return null;
};

const authoritativeProviderEvent = (input: {
  payment: Awaited<ReturnType<typeof getMercadoPagoPayment>>;
  intent: ReturnType<typeof normalizeCanonicalPaymentIntent>;
  canonicalPayment: CanonicalPayment;
  forcedExpiry?: boolean;
}): VerifiedPaymentProviderEvent | null => {
  const eventType = providerEventType(input.payment, input.forcedExpiry === true);
  if (!eventType) return null;

  const providerPaymentId = clean(input.payment.id);
  const metadata = input.payment.metadata ?? {};
  const paymentIntentId =
    clean(metadata.kyrub_payment_intent_id) || clean(input.payment.external_reference);
  const storeId = clean(metadata.kyrub_store_id);
  const paymentId = clean(metadata.kyrub_payment_id);
  const amount = Number(input.payment.transaction_amount);
  const occurredAt =
    clean(input.payment.date_last_updated) ||
    clean(input.payment.date_created) ||
    new Date().toISOString();

  if (
    !providerPaymentId ||
    paymentIntentId !== input.intent.id ||
    storeId !== input.intent.storeId ||
    paymentId !== input.canonicalPayment.id ||
    providerPaymentId !== input.canonicalPayment.providerPaymentId ||
    providerPaymentId !== input.intent.providerIntentId ||
    !Number.isFinite(amount) ||
    Number(amount.toFixed(2)) !== input.intent.amount
  ) {
    throw new Error('MERCADO_PAGO_EXPIRY_RECONCILIATION_MISMATCH');
  }

  return {
    provider: 'mercado-pago',
    eventId: `${providerPaymentId}:${clean(input.payment.status)}:${occurredAt}:${eventType}`,
    eventType,
    providerPaymentId,
    paymentIntentId,
    amount: Number(amount.toFixed(2)),
    currency: 'BRL',
    method: 'pix',
    occurredAt,
    signatureVerified: true,
  };
};

const reconcileVerifiedProviderEvent = async (input: {
  storeId: string;
  paymentId: string;
  event: VerifiedPaymentProviderEvent;
}): Promise<'paid' | 'terminal'> => {
  const preparedDestination = await prepareCustomerDestinationResolutionForPaymentIntent({
    storeId: input.storeId,
    paymentIntentId: input.event.paymentIntentId,
  });
  const result = await processVerifiedPaymentWebhook({
    storeId: input.storeId,
    paymentId: input.paymentId,
    event: input.event,
  });

  if (input.event.eventType === 'payment.paid' && result.orderId) {
    await settleMarketplaceOperationalOrderAfterPayment({
      storeId: input.storeId,
      orderId: result.orderId,
      paymentIntentId: input.event.paymentIntentId,
      occurredAt: input.event.occurredAt,
    });
    await markMarketplaceOrderInventoryReservationPaymentConfirmed(
      input.storeId,
      result.orderId
    );
    await attachPreparedCustomerDestinationResolutionToOperationalOrder(preparedDestination);
    return 'paid';
  }

  if (
    input.event.eventType === 'payment.failed' ||
    input.event.eventType === 'payment.expired' ||
    input.event.eventType === 'payment.cancelled'
  ) {
    await releaseMarketplaceReservationForTerminalPayment({
      storeId: input.storeId,
      paymentIntentId: input.event.paymentIntentId,
      eventType: input.event.eventType,
    });
    await attachPreparedCustomerDestinationResolutionToOperationalOrder(preparedDestination);
    return 'terminal';
  }

  throw new Error(`UNSUPPORTED_EXPIRY_PROVIDER_EVENT:${input.event.eventType}`);
};

const expireWithoutProvider = async (input: {
  storeId: string;
  orderId: string;
  paymentIntentId: string;
  paymentId: string;
}): Promise<'expired' | 'paid' | 'provider_attached' | 'terminal'> =>
  adminDb.runTransaction(async transaction => {
    const intentRef = adminDb.doc(
      `stores/${input.storeId}/paymentIntents/${input.paymentIntentId}`
    );
    const paymentRef = adminDb.doc(
      `stores/${input.storeId}/payments/${input.paymentId}`
    );
    const orderRef = adminDb.doc(operationalOrderPath(input.storeId, input.orderId));
    const [intentSnapshot, paymentSnapshot, orderSnapshot] = await Promise.all([
      transaction.get(intentRef),
      transaction.get(paymentRef),
      transaction.get(orderRef),
    ]);
    if (!intentSnapshot.exists || !paymentSnapshot.exists || !orderSnapshot.exists) {
      throw new Error('PAYMENT_EXPIRY_STATE_MISSING');
    }
    const intent = normalizeCanonicalPaymentIntent(
      intentSnapshot.data() as CanonicalPaymentIntent
    );
    const payment = normalizeCanonicalPayment(
      paymentSnapshot.data() as CanonicalPayment
    );
    if (
      intent.context !== 'marketplace' ||
      intent.storeId !== input.storeId ||
      intent.target.orderId !== input.orderId ||
      payment.storeId !== input.storeId ||
      payment.orderId !== input.orderId ||
      payment.paymentIntentId !== intent.id
    ) {
      throw new Error('PAYMENT_EXPIRY_STATE_MISMATCH');
    }
    if (intent.status === 'paid' || payment.status === 'paid') return 'paid';
    if (intent.status !== 'pending' || payment.status !== 'pending') return 'terminal';
    if (intent.providerIntentId || payment.providerPaymentId) return 'provider_attached';

    const now = new Date().toISOString();
    transaction.update(intentRef, { status: 'expired', updatedAt: now });
    transaction.update(paymentRef, { status: 'expired', updatedAt: now });
    return 'expired';
  });

const reconcileDueReservation = async (input: {
  storeId: string;
  orderId: string;
}): Promise<'paid' | 'released' | 'deferred'> => {
  const orderSnapshot = await adminDb.doc(
    operationalOrderPath(input.storeId, input.orderId)
  ).get();
  if (!orderSnapshot.exists) {
    throw new Error('PAYMENT_EXPIRY_ORDER_NOT_FOUND');
  }
  const order = orderSnapshot.data() as Record<string, unknown>;
  const paymentIntentId = clean(order.paymentIntentId);
  const paymentId = clean(order.paymentId);
  if (!paymentIntentId || !paymentId) {
    throw new Error('PAYMENT_EXPIRY_REFERENCE_MISSING');
  }

  const [intentSnapshot, paymentSnapshot] = await Promise.all([
    adminDb.doc(`stores/${input.storeId}/paymentIntents/${paymentIntentId}`).get(),
    adminDb.doc(`stores/${input.storeId}/payments/${paymentId}`).get(),
  ]);
  if (!intentSnapshot.exists || !paymentSnapshot.exists) {
    throw new Error('PAYMENT_EXPIRY_STATE_MISSING');
  }
  let intent = normalizeCanonicalPaymentIntent(
    intentSnapshot.data() as CanonicalPaymentIntent
  );
  let payment = normalizeCanonicalPayment(
    paymentSnapshot.data() as CanonicalPayment
  );
  if (
    intent.context !== 'marketplace' ||
    intent.target.orderId !== input.orderId ||
    intent.storeId !== input.storeId ||
    payment.orderId !== input.orderId ||
    payment.storeId !== input.storeId ||
    payment.paymentIntentId !== intent.id
  ) {
    throw new Error('PAYMENT_EXPIRY_STATE_MISMATCH');
  }

  if (intent.status === 'paid' || payment.status === 'paid') {
    await markMarketplaceOrderInventoryReservationPaymentConfirmed(
      input.storeId,
      input.orderId
    );
    return 'paid';
  }
  if (intent.status !== 'pending' || payment.status !== 'pending') {
    await releaseMarketplaceReservationForTerminalPayment({
      storeId: input.storeId,
      paymentIntentId,
      eventType: intent.status === 'cancelled' || payment.status === 'cancelled'
        ? 'payment.cancelled'
        : intent.status === 'failed' || payment.status === 'failed'
          ? 'payment.failed'
          : 'payment.expired',
    });
    return 'released';
  }

  if (!intent.providerIntentId && !payment.providerPaymentId) {
    const localResult = await expireWithoutProvider({
      storeId: input.storeId,
      orderId: input.orderId,
      paymentIntentId,
      paymentId,
    });
    if (localResult === 'paid') {
      await markMarketplaceOrderInventoryReservationPaymentConfirmed(
        input.storeId,
        input.orderId
      );
      return 'paid';
    }
    if (localResult === 'provider_attached') {
      const refreshedIntentSnapshot = await adminDb.doc(
        `stores/${input.storeId}/paymentIntents/${paymentIntentId}`
      ).get();
      const refreshedPaymentSnapshot = await adminDb.doc(
        `stores/${input.storeId}/payments/${paymentId}`
      ).get();
      if (!refreshedIntentSnapshot.exists || !refreshedPaymentSnapshot.exists) {
        throw new Error('PAYMENT_EXPIRY_STATE_MISSING');
      }
      intent = normalizeCanonicalPaymentIntent(
        refreshedIntentSnapshot.data() as CanonicalPaymentIntent
      );
      payment = normalizeCanonicalPayment(
        refreshedPaymentSnapshot.data() as CanonicalPayment
      );
    } else {
      await releaseMarketplaceReservationForTerminalPayment({
        storeId: input.storeId,
        paymentIntentId,
        eventType: 'payment.expired',
      });
      return 'released';
    }
  }

  if (
    intent.provider !== 'mercado-pago' ||
    payment.provider !== 'mercado-pago' ||
    !intent.providerIntentId ||
    intent.providerIntentId !== payment.providerPaymentId
  ) {
    return 'deferred';
  }

  let providerPayment = await getMercadoPagoPayment(intent.providerIntentId);
  let event = authoritativeProviderEvent({
    payment: providerPayment,
    intent,
    canonicalPayment: payment,
  });
  if (!event) {
    try {
      providerPayment = await cancelMercadoPagoPayment(
        intent.providerIntentId,
        `kyrub-expire-${intent.id}`
      );
    } catch (error) {
      providerPayment = await getMercadoPagoPayment(intent.providerIntentId);
      const afterFailure = authoritativeProviderEvent({
        payment: providerPayment,
        intent,
        canonicalPayment: payment,
      });
      if (!afterFailure) throw error;
      event = afterFailure;
    }
    if (!event) {
      event = authoritativeProviderEvent({
        payment: providerPayment,
        intent,
        canonicalPayment: payment,
        forcedExpiry: true,
      });
    }
  }
  if (!event) return 'deferred';

  const result = await reconcileVerifiedProviderEvent({
    storeId: input.storeId,
    paymentId,
    event,
  });
  return result === 'paid' ? 'paid' : 'released';
};

export interface MarketplacePaymentExpirySweepResult {
  scanned: number;
  paid: number;
  released: number;
  deferred: number;
  failed: number;
}

export const expireDueMarketplacePixReservations = async (
  batchSize = DEFAULT_BATCH_SIZE
): Promise<MarketplacePaymentExpirySweepResult> => {
  const now = new Date().toISOString();
  const snapshot = await adminDb
    .collection(RESERVATION_COLLECTION)
    .where('activeExpiresAt', '<=', now)
    .limit(validBatchSize(batchSize))
    .get();
  const result: MarketplacePaymentExpirySweepResult = {
    scanned: snapshot.size,
    paid: 0,
    released: 0,
    deferred: 0,
    failed: 0,
  };

  for (const document of snapshot.docs) {
    const data = document.data() as Record<string, unknown>;
    const storeId = clean(data.tenantId);
    const orderId = clean(data.orderId);
    if (!storeId || !orderId) {
      result.failed += 1;
      console.error('[Marketplace Payment Expiry] Invalid reservation identity.', document.id);
      continue;
    }
    try {
      const outcome = await reconcileDueReservation({ storeId, orderId });
      result[outcome] += 1;
    } catch (error) {
      result.failed += 1;
      console.error('[Marketplace Payment Expiry] Reconciliation failed.', {
        storeId,
        orderId,
        error,
      });
    }
  }
  return result;
};
