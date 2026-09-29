import { createHash } from 'node:crypto';
import { adminDb } from '../firebaseAdmin.js';
import { resolveMercadoPagoAccessToken } from '../integrations/providerCredentialResolver.js';
import { mercadoPagoStoreRequest } from '../integrations/mercadoPagoStoreOauthService.js';
import {
  assertPaymentStatusTransition,
  normalizeCanonicalPayment,
  type CanonicalPayment,
} from '../../src/utils/canonicalPayment.js';
import type { VerifiedPaymentProviderEvent } from '../../src/utils/paymentProvider.js';
import { loadMercadoPagoPaymentProviderBinding } from './paymentProviderBindingService.js';
import { processVerifiedPaymentWebhook } from './paymentWebhookProcessor.js';
import { writeOperationalOrderRefundState } from './orderRefundStateService.js';

interface MercadoPagoRefundResponse {
  id?: string | number;
  payment_id?: string | number;
  amount?: number;
  status?: string;
  date_created?: string;
}

interface MercadoPagoPaymentSnapshot {
  id?: string | number;
  status?: string;
  transaction_amount?: number;
  date_created?: string;
  date_last_updated?: string;
  external_reference?: string;
  metadata?: Record<string, unknown>;
}

export interface CanonicalOrderRefundResult {
  orderId: string;
  paymentId: string;
  providerPaymentId: string;
  amount: number;
  status: 'processing' | 'refunded';
  duplicate: boolean;
}

const clean = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number'
    ? String(value).trim()
    : '';

const paymentPath = (storeId: string, paymentId: string): string =>
  `stores/${storeId}/payments/${paymentId}`;

const refundRequestPath = (storeId: string, paymentId: string): string =>
  `stores/${storeId}/paymentRefunds/${paymentId}`;

const refundIdempotencyKey = (storeId: string, paymentId: string): string =>
  createHash('sha256')
    .update(`kyrub:full-refund:${storeId}:${paymentId}`)
    .digest('hex')
    .slice(0, 48);

const providerErrorCode = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  if (/already[-_ ]?refunded|charge-already-refunded/i.test(message)) {
    return 'MERCADO_PAGO_ALREADY_REFUNDED';
  }
  if (/too-old|too old|15016/i.test(message)) {
    return 'MERCADO_PAGO_REFUND_TOO_OLD';
  }
  if (/not.allowed|not-allowed|4295|4297/i.test(message)) {
    return 'MERCADO_PAGO_REFUND_NOT_ALLOWED';
  }
  if (/MERCADO_PAGO_NOT_CONFIGURED/i.test(message)) {
    return 'MERCADO_PAGO_NOT_CONFIGURED';
  }
  if (/MERCADO_PAGO_.*API_ERROR/i.test(message)) {
    return 'MERCADO_PAGO_REFUND_PROVIDER_ERROR';
  }
  return 'MERCADO_PAGO_REFUND_STATUS_UNCERTAIN';
};

const platformMercadoPagoRequest = async <T>(
  path: string,
  init: RequestInit = {}
): Promise<T> => {
  const token = await resolveMercadoPagoAccessToken();
  if (!token) throw new Error('MERCADO_PAGO_NOT_CONFIGURED');
  const response = await fetch(`https://api.mercadopago.com${path}`, {
    ...init,
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${token}`,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  });
  const payload = await response.json().catch(() => ({})) as T & Record<string, unknown>;
  if (!response.ok) {
    const diagnostic = clean(payload.message) || clean(payload.error) || `HTTP_${response.status}`;
    throw new Error(`MERCADO_PAGO_REFUND_API_ERROR:${diagnostic.slice(0, 160)}`);
  }
  return payload;
};

const providerRequest = async <T>(
  payment: CanonicalPayment,
  path: string,
  init: RequestInit = {}
): Promise<T> => {
  const binding = await loadMercadoPagoPaymentProviderBinding(payment.providerPaymentId);
  if (binding) {
    if (
      binding.canonicalStoreId !== payment.storeId ||
      binding.paymentId !== payment.id ||
      binding.providerPaymentId !== payment.providerPaymentId
    ) {
      throw new Error('PAYMENT_REFUND_PROVIDER_BINDING_MISMATCH');
    }
    return mercadoPagoStoreRequest<T>(binding.legacyStoreId, path, init);
  }
  return platformMercadoPagoRequest<T>(path, init);
};

const fetchProviderPayment = async (
  payment: CanonicalPayment
): Promise<MercadoPagoPaymentSnapshot> =>
  providerRequest<MercadoPagoPaymentSnapshot>(
    payment,
    `/v1/payments/${encodeURIComponent(payment.providerPaymentId)}`
  );

const buildRefundSucceededEvent = (
  payment: CanonicalPayment,
  snapshot: MercadoPagoPaymentSnapshot
): VerifiedPaymentProviderEvent | null => {
  const status = clean(snapshot.status).toLowerCase();
  if (status !== 'refunded') return null;
  const providerPaymentId = clean(snapshot.id);
  const amount = Number(snapshot.transaction_amount);
  const metadata = snapshot.metadata ?? {};
  const paymentIntentId =
    clean(metadata.kyrub_payment_intent_id) ||
    clean(snapshot.external_reference) ||
    clean(payment.paymentIntentId);
  const metadataStoreId = clean(metadata.kyrub_store_id);
  const metadataPaymentId = clean(metadata.kyrub_payment_id);
  const occurredAt =
    clean(snapshot.date_last_updated) ||
    clean(snapshot.date_created) ||
    new Date().toISOString();

  if (
    providerPaymentId !== payment.providerPaymentId ||
    !paymentIntentId ||
    !Number.isFinite(amount) ||
    Number(amount.toFixed(2)) !== Number(payment.amount.toFixed(2)) ||
    (metadataStoreId && metadataStoreId !== payment.storeId) ||
    (metadataPaymentId && metadataPaymentId !== payment.id)
  ) {
    throw new Error('PAYMENT_REFUND_PROVIDER_STATE_MISMATCH');
  }

  return {
    provider: 'mercado-pago',
    eventId: `${providerPaymentId}:${status}:${occurredAt}`,
    eventType: 'refund.succeeded',
    providerPaymentId,
    paymentIntentId,
    amount: Number(amount.toFixed(2)),
    currency: 'BRL',
    method: payment.method,
    occurredAt,
    signatureVerified: true,
  };
};

const loadRefundablePayment = async (
  storeId: string,
  orderId: string
): Promise<CanonicalPayment> => {
  const snapshot = await adminDb
    .collection(`stores/${storeId}/payments`)
    .where('orderId', '==', orderId)
    .limit(10)
    .get();

  const payments = snapshot.docs.flatMap(document => {
    try {
      const payment = normalizeCanonicalPayment({
        ...(document.data() as CanonicalPayment),
        id: document.id,
        storeId,
      });
      return payment.provider === 'mercado-pago' && payment.providerPaymentId
        ? [payment]
        : [];
    } catch {
      return [];
    }
  });

  const eligible = payments.filter(payment =>
    ['paid', 'refund_requested', 'refund_processing', 'refund_failed', 'refunded']
      .includes(payment.status)
  );
  if (eligible.length === 0) throw new Error('PAYMENT_REFUND_PAYMENT_NOT_FOUND');
  if (eligible.length > 1) throw new Error('PAYMENT_REFUND_MULTIPLE_PAYMENTS_UNSUPPORTED');
  return eligible[0];
};

const preparePaymentForRefund = async (
  payment: CanonicalPayment,
  reason: string
): Promise<CanonicalPayment> => {
  const ref = adminDb.doc(paymentPath(payment.storeId, payment.id));
  const requestRef = adminDb.doc(refundRequestPath(payment.storeId, payment.id));
  const idempotencyKey = refundIdempotencyKey(payment.storeId, payment.id);
  const requestedAt = new Date().toISOString();

  await adminDb.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw new Error('PAYMENT_REFUND_PAYMENT_NOT_FOUND');
    const current = normalizeCanonicalPayment({
      ...(snapshot.data() as CanonicalPayment),
      id: payment.id,
      storeId: payment.storeId,
    });
    if (current.status === 'refunded' || current.status === 'refund_processing') return;
    if (current.status === 'paid' || current.status === 'refund_failed') {
      assertPaymentStatusTransition(current.status, 'refund_requested');
      transaction.update(ref, {
        status: 'refund_requested',
        updatedAt: requestedAt,
      });
    } else if (current.status !== 'refund_requested') {
      throw new Error('PAYMENT_REFUND_STATUS_NOT_ELIGIBLE');
    }
    transaction.set(requestRef, {
      storeId: payment.storeId,
      orderId: payment.orderId,
      paymentId: payment.id,
      provider: payment.provider,
      providerPaymentId: payment.providerPaymentId,
      amount: payment.amount,
      currency: payment.currency,
      reason,
      status: 'requested',
      idempotencyKey,
      requestedAt,
      updatedAt: requestedAt,
    }, { merge: true });
  });

  await adminDb.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw new Error('PAYMENT_REFUND_PAYMENT_NOT_FOUND');
    const current = normalizeCanonicalPayment({
      ...(snapshot.data() as CanonicalPayment),
      id: payment.id,
      storeId: payment.storeId,
    });
    if (current.status === 'refunded' || current.status === 'refund_processing') return;
    if (current.status !== 'refund_requested') {
      throw new Error('PAYMENT_REFUND_STATUS_NOT_ELIGIBLE');
    }
    assertPaymentStatusTransition(current.status, 'refund_processing');
    const now = new Date().toISOString();
    transaction.update(ref, { status: 'refund_processing', updatedAt: now });
    transaction.set(requestRef, { status: 'processing', updatedAt: now }, { merge: true });
  });

  const updated = await ref.get();
  return normalizeCanonicalPayment({
    ...(updated.data() as CanonicalPayment),
    id: payment.id,
    storeId: payment.storeId,
  });
};

const markRefundRequest = async (
  payment: CanonicalPayment,
  status: 'processing' | 'refunded' | 'failed',
  extra: Record<string, unknown> = {}
): Promise<void> => {
  await adminDb.doc(refundRequestPath(payment.storeId, payment.id)).set({
    status,
    updatedAt: new Date().toISOString(),
    ...extra,
  }, { merge: true });
};

const markPaymentRefundFailed = async (
  payment: CanonicalPayment,
  code: string
): Promise<void> => {
  const ref = adminDb.doc(paymentPath(payment.storeId, payment.id));
  await adminDb.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return;
    const current = normalizeCanonicalPayment({
      ...(snapshot.data() as CanonicalPayment),
      id: payment.id,
      storeId: payment.storeId,
    });
    if (current.status !== 'refund_processing') return;
    assertPaymentStatusTransition(current.status, 'refund_failed');
    transaction.update(ref, {
      status: 'refund_failed',
      updatedAt: new Date().toISOString(),
      refundFailureCode: code,
    });
  });
};

const reconcileRefund = async (
  payment: CanonicalPayment,
  reason: string
): Promise<CanonicalOrderRefundResult | null> => {
  const snapshot = await fetchProviderPayment(payment);
  const event = buildRefundSucceededEvent(payment, snapshot);
  if (!event) return null;
  await processVerifiedPaymentWebhook({
    storeId: payment.storeId,
    paymentId: payment.id,
    event,
  });
  await markRefundRequest(payment, 'refunded', {
    providerEventId: event.eventId,
    refundedAt: event.occurredAt,
  });
  await writeOperationalOrderRefundState({
    storeId: payment.storeId,
    orderId: payment.orderId,
    paymentId: payment.id,
    provider: payment.provider,
    amount: payment.amount,
    status: 'refunded',
    reason,
    refundedAt: event.occurredAt,
  });
  return {
    orderId: payment.orderId,
    paymentId: payment.id,
    providerPaymentId: payment.providerPaymentId,
    amount: payment.amount,
    status: 'refunded',
    duplicate: payment.status === 'refunded',
  };
};

export const requestCanonicalOrderRefund = async (input: {
  storeId: string;
  orderId: string;
  reason: string;
}): Promise<CanonicalOrderRefundResult> => {
  const storeId = clean(input.storeId);
  const orderId = clean(input.orderId);
  const reason = clean(input.reason);
  if (!storeId || !orderId) throw new Error('PAYMENT_REFUND_TARGET_REQUIRED');
  if (!reason || reason.length > 500) throw new Error('PAYMENT_REFUND_REASON_REQUIRED');

  const orderRef = adminDb.doc(
    `artifacts/${storeId}/public/data/customerOrders/${orderId}`
  );
  const orderSnapshot = await orderRef.get();
  if (!orderSnapshot.exists) throw new Error('PAYMENT_REFUND_ORDER_NOT_FOUND');
  const order = orderSnapshot.data() as Record<string, unknown>;
  if (clean(order.storeId) !== storeId || clean(order.id) !== orderId) {
    throw new Error('PAYMENT_REFUND_ORDER_MISMATCH');
  }
  const orderStatus = clean(order.status);
  if (orderStatus !== 'rejected' && orderStatus !== 'cancelled') {
    throw new Error('PAYMENT_REFUND_ORDER_NOT_TERMINAL');
  }
  if (clean(order.paymentStatus) !== 'paid') {
    throw new Error('PAYMENT_REFUND_ORDER_NOT_PAID');
  }

  const initialPayment = await loadRefundablePayment(storeId, orderId);
  if (initialPayment.status === 'refunded') {
    await writeOperationalOrderRefundState({
      storeId,
      orderId,
      paymentId: initialPayment.id,
      provider: initialPayment.provider,
      amount: initialPayment.amount,
      status: 'refunded',
      reason,
      refundedAt: initialPayment.refundedAt,
    });
    return {
      orderId,
      paymentId: initialPayment.id,
      providerPaymentId: initialPayment.providerPaymentId,
      amount: initialPayment.amount,
      status: 'refunded',
      duplicate: true,
    };
  }

  const payment = await preparePaymentForRefund(initialPayment, reason);
  await writeOperationalOrderRefundState({
    storeId,
    orderId,
    paymentId: payment.id,
    provider: payment.provider,
    amount: payment.amount,
    status: 'processing',
    reason,
  });

  const alreadyRefunded = await reconcileRefund(payment, reason).catch(() => null);
  if (alreadyRefunded) return alreadyRefunded;

  const idempotencyKey = refundIdempotencyKey(storeId, payment.id);
  try {
    const refund = await providerRequest<MercadoPagoRefundResponse>(
      payment,
      `/v1/payments/${encodeURIComponent(payment.providerPaymentId)}/refunds`,
      {
        method: 'POST',
        headers: { 'X-Idempotency-Key': idempotencyKey },
      }
    );
    await markRefundRequest(payment, 'processing', {
      providerRefundId: clean(refund.id),
      providerRefundStatus: clean(refund.status),
      providerRefundCreatedAt: clean(refund.date_created),
    });
  } catch (error) {
    const reconciled = await reconcileRefund(payment, reason).catch(() => null);
    if (reconciled) return reconciled;
    const code = providerErrorCode(error);
    if (code !== 'MERCADO_PAGO_REFUND_STATUS_UNCERTAIN') {
      await markPaymentRefundFailed(payment, code);
      await markRefundRequest(payment, 'failed', { failureCode: code });
      await writeOperationalOrderRefundState({
        storeId,
        orderId,
        paymentId: payment.id,
        provider: payment.provider,
        amount: payment.amount,
        status: 'failed',
        reason,
        failureCode: code,
      });
    }
    throw new Error(code);
  }

  const reconciled = await reconcileRefund(payment, reason).catch(() => null);
  if (reconciled) return reconciled;

  return {
    orderId,
    paymentId: payment.id,
    providerPaymentId: payment.providerPaymentId,
    amount: payment.amount,
    status: 'processing',
    duplicate: false,
  };
};
