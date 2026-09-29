import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import { resolveMercadoPagoAccessToken } from '../integrations/providerCredentialResolver.js';
import { mercadoPagoStoreRequest } from '../integrations/mercadoPagoStoreOauthService.js';
import { loadMercadoPagoPaymentProviderBinding } from './paymentProviderBindingService.js';
import {
  normalizeCanonicalPayment,
  type CanonicalPayment,
} from '../../src/utils/canonicalPayment.js';
import {
  STORE_ECONOMIC_LEDGER_SCHEMA_VERSION,
  brlToMinor,
  buildPaymentCaptureEconomicEntryId,
  buildRecoveredPaymentCaptureEconomicEntry,
  storeEconomicLedgerEntryPath,
  type StoreEconomicLedgerEntry,
} from '../../shared/storeEconomicLedger.js';

export interface OrderItemCancellationSelection {
  lineId: string;
  quantity: number;
}

export type OrderItemCancellationRefundStatus =
  | 'not_required'
  | 'required'
  | 'processing'
  | 'refunded'
  | 'failed';

export interface OrderItemCancellationResult {
  orderId: string;
  operationId: string;
  cancelledAmount: number;
  remainingTotal: number;
  refundRequired: boolean;
  refundStatus: OrderItemCancellationRefundStatus;
  providerRefundId: string;
  duplicate: boolean;
}

interface NormalizedCancellationSelection {
  lineId: string;
  quantity: number;
}

interface CancellationMutationResult {
  orderId: string;
  operationId: string;
  cancelledAmount: number;
  remainingTotal: number;
  paymentStatus: string;
  duplicate: boolean;
  refundStatus: OrderItemCancellationRefundStatus;
  providerRefundId: string;
}

interface MercadoPagoRefundResponse {
  id?: string | number;
  payment_id?: string | number;
  amount?: number;
  status?: string;
  date_created?: string;
}

const clean = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number'
    ? String(value).trim()
    : '';

const money = (value: number): number =>
  Math.round((value + Number.EPSILON) * 100) / 100;

const nonNegativeMoney = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0
    ? money(value)
    : 0;

const integer = (value: unknown): number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : 0;

const cancellationPath = (
  storeId: string,
  operationId: string
): string => `stores/${storeId}/orderItemCancellations/${operationId}`;

const partialRefundPath = (
  storeId: string,
  operationId: string
): string => `stores/${storeId}/paymentPartialRefunds/${operationId}`;

const normalizeSelections = (
  value: unknown
): NormalizedCancellationSelection[] => {
  if (!Array.isArray(value) || value.length === 0 || value.length > 80) {
    throw new Error('ORDER_ITEM_CANCELLATION_SELECTION_REQUIRED');
  }
  const seen = new Set<string>();
  return value.map(candidate => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new Error('ORDER_ITEM_CANCELLATION_SELECTION_INVALID');
    }
    const record = candidate as Record<string, unknown>;
    const lineId = clean(record.lineId);
    const quantity = integer(record.quantity);
    if (!lineId || lineId.length > 240 || quantity <= 0 || seen.has(lineId)) {
      throw new Error('ORDER_ITEM_CANCELLATION_SELECTION_INVALID');
    }
    seen.add(lineId);
    return { lineId, quantity };
  });
};

const partialRefundIdempotencyKey = (input: {
  storeId: string;
  paymentId: string;
  operationId: string;
  amount: number;
}): string =>
  createHash('sha256')
    .update(
      `kyrub:partial-refund:${input.storeId}:${input.paymentId}:${input.operationId}:${money(input.amount).toFixed(2)}`
    )
    .digest('hex')
    .slice(0, 48);

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
    throw new Error(`MERCADO_PAGO_PARTIAL_REFUND_API_ERROR:${diagnostic.slice(0, 160)}`);
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
      throw new Error('PAYMENT_PARTIAL_REFUND_PROVIDER_BINDING_MISMATCH');
    }
    return mercadoPagoStoreRequest<T>(binding.legacyStoreId, path, init);
  }
  return platformMercadoPagoRequest<T>(path, init);
};

const loadPaidMercadoPagoPayment = async (
  storeId: string,
  orderId: string
): Promise<CanonicalPayment> => {
  const snapshot = await adminDb
    .collection(`stores/${storeId}/payments`)
    .where('orderId', '==', orderId)
    .limit(10)
    .get();
  const eligible = snapshot.docs.flatMap(document => {
    try {
      const payment = normalizeCanonicalPayment({
        ...(document.data() as CanonicalPayment),
        id: document.id,
        storeId,
      });
      return payment.provider === 'mercado-pago' &&
        payment.providerPaymentId &&
        payment.status === 'paid'
        ? [payment]
        : [];
    } catch {
      return [];
    }
  });
  if (eligible.length === 0) throw new Error('PAYMENT_PARTIAL_REFUND_PAYMENT_NOT_FOUND');
  if (eligible.length > 1) throw new Error('PAYMENT_PARTIAL_REFUND_MULTIPLE_PAYMENTS_UNSUPPORTED');
  return eligible[0];
};

const recordPartialRefundEconomicEntry = async (input: {
  payment: CanonicalPayment;
  operationId: string;
  amount: number;
  providerRefundId: string;
  occurredAt: string;
}): Promise<void> => {
  const refundEntryId = `payment:partial_refund:${input.payment.id}:${input.operationId}`;
  const refundEntryRef = adminDb.doc(
    storeEconomicLedgerEntryPath(input.payment.storeId, refundEntryId)
  );
  const captureEntryId = buildPaymentCaptureEconomicEntryId(input.payment.id);
  const captureEntryRef = adminDb.doc(
    storeEconomicLedgerEntryPath(input.payment.storeId, captureEntryId)
  );
  const paymentRef = adminDb.doc(
    `stores/${input.payment.storeId}/payments/${input.payment.id}`
  );

  await adminDb.runTransaction(async transaction => {
    const [refundSnapshot, captureSnapshot] = await Promise.all([
      transaction.get(refundEntryRef),
      transaction.get(captureEntryRef),
    ]);
    if (refundSnapshot.exists) return;

    if (!captureSnapshot.exists) {
      transaction.set(
        captureEntryRef,
        buildRecoveredPaymentCaptureEconomicEntry({
          payment: input.payment,
          paymentIntentId: input.payment.paymentIntentId,
        })
      );
    }

    const entry: StoreEconomicLedgerEntry = {
      schemaVersion: STORE_ECONOMIC_LEDGER_SCHEMA_VERSION,
      id: refundEntryId,
      storeId: input.payment.storeId,
      kind: 'payment_refund',
      currency: 'BRL',
      amountMinor: -brlToMinor(input.amount),
      paymentId: input.payment.id,
      paymentIntentId: input.payment.paymentIntentId,
      orderId: input.payment.orderId,
      buyerId: input.payment.buyerId,
      paymentContext: input.payment.context,
      paymentMethod: input.payment.method,
      provider: input.payment.provider,
      providerPaymentId: input.payment.providerPaymentId,
      providerEventId: input.providerRefundId,
      sourceAuthority: 'operator_attestation',
      reversalOfEntryId: captureEntryId,
      occurredAt: input.occurredAt,
    };
    transaction.set(refundEntryRef, entry);
    transaction.set(paymentRef, {
      partialRefundedAmount: FieldValue.increment(input.amount),
      lastPartialRefundId: input.providerRefundId,
      lastPartialRefundAt: input.occurredAt,
      updatedAt: input.occurredAt,
    }, { merge: true });
  });
};

const attemptPartialRefund = async (input: {
  storeId: string;
  orderId: string;
  operationId: string;
  amount: number;
  reason: string;
}): Promise<{ status: OrderItemCancellationRefundStatus; providerRefundId: string }> => {
  const requestRef = adminDb.doc(partialRefundPath(input.storeId, input.operationId));
  const existing = await requestRef.get();
  if (existing.exists && clean(existing.data()?.status) === 'refunded') {
    return {
      status: 'refunded',
      providerRefundId: clean(existing.data()?.providerRefundId),
    };
  }

  let payment: CanonicalPayment;
  try {
    payment = await loadPaidMercadoPagoPayment(input.storeId, input.orderId);
  } catch (error) {
    const code = error instanceof Error ? error.message : String(error);
    await requestRef.set({
      storeId: input.storeId,
      orderId: input.orderId,
      operationId: input.operationId,
      amount: input.amount,
      reason: input.reason,
      status: 'required',
      failureCode: code,
      updatedAt: new Date().toISOString(),
    }, { merge: true });
    return { status: 'required', providerRefundId: '' };
  }

  const idempotencyKey = partialRefundIdempotencyKey({
    storeId: input.storeId,
    paymentId: payment.id,
    operationId: input.operationId,
    amount: input.amount,
  });
  const now = new Date().toISOString();
  await requestRef.set({
    storeId: input.storeId,
    orderId: input.orderId,
    operationId: input.operationId,
    paymentId: payment.id,
    provider: payment.provider,
    providerPaymentId: payment.providerPaymentId,
    amount: input.amount,
    currency: 'BRL',
    reason: input.reason,
    status: 'processing',
    idempotencyKey,
    requestedAt: existing.data()?.requestedAt ?? now,
    updatedAt: now,
  }, { merge: true });

  try {
    const refund = await providerRequest<MercadoPagoRefundResponse>(
      payment,
      `/v1/payments/${encodeURIComponent(payment.providerPaymentId)}/refunds`,
      {
        method: 'POST',
        headers: { 'X-Idempotency-Key': idempotencyKey },
        body: JSON.stringify({ amount: money(input.amount) }),
      }
    );
    const providerRefundId = clean(refund.id);
    const providerPaymentId = clean(refund.payment_id);
    const providerAmount = Number(refund.amount);
    const providerStatus = clean(refund.status).toLowerCase();
    if (
      !providerRefundId ||
      (providerPaymentId && providerPaymentId !== payment.providerPaymentId) ||
      (Number.isFinite(providerAmount) && money(providerAmount) !== money(input.amount))
    ) {
      throw new Error('PAYMENT_PARTIAL_REFUND_PROVIDER_STATE_MISMATCH');
    }
    const refunded = !providerStatus ||
      providerStatus === 'approved' ||
      providerStatus === 'refunded' ||
      providerStatus === 'completed';
    const occurredAt = clean(refund.date_created) || new Date().toISOString();
    await requestRef.set({
      status: refunded ? 'refunded' : 'processing',
      providerRefundId,
      providerRefundStatus: providerStatus,
      refundedAt: refunded ? occurredAt : '',
      updatedAt: new Date().toISOString(),
    }, { merge: true });
    if (refunded) {
      await recordPartialRefundEconomicEntry({
        payment,
        operationId: input.operationId,
        amount: input.amount,
        providerRefundId,
        occurredAt,
      });
    }
    return {
      status: refunded ? 'refunded' : 'processing',
      providerRefundId,
    };
  } catch (error) {
    const code = error instanceof Error ? error.message : String(error);
    await requestRef.set({
      status: 'failed',
      failureCode: code.slice(0, 180),
      updatedAt: new Date().toISOString(),
    }, { merge: true });
    return { status: 'failed', providerRefundId: '' };
  }
};

const mutateOrderItems = async (input: {
  storeId: string;
  orderId: string;
  operationId: string;
  reason: string;
  alternative: string;
  selections: NormalizedCancellationSelection[];
}): Promise<CancellationMutationResult> => {
  const orderRef = adminDb.doc(
    `artifacts/${input.storeId}/public/data/customerOrders/${input.orderId}`
  );
  const tenantRef = adminDb.doc(`tenants/${input.storeId}`);
  const cancellationRef = adminDb.doc(
    cancellationPath(input.storeId, input.operationId)
  );

  return adminDb.runTransaction(async transaction => {
    const [existingCancellation, orderSnapshot, tenantSnapshot] = await Promise.all([
      transaction.get(cancellationRef),
      transaction.get(orderRef),
      transaction.get(tenantRef),
    ]);
    if (existingCancellation.exists) {
      const data = existingCancellation.data() as Record<string, unknown>;
      if (clean(data.orderId) !== input.orderId) {
        throw new Error('ORDER_ITEM_CANCELLATION_OPERATION_CONFLICT');
      }
      return {
        orderId: input.orderId,
        operationId: input.operationId,
        cancelledAmount: nonNegativeMoney(data.cancelledAmount),
        remainingTotal: nonNegativeMoney(data.remainingTotal),
        paymentStatus: clean(data.paymentStatus),
        duplicate: true,
        refundStatus: (clean(data.refundStatus) || 'not_required') as OrderItemCancellationRefundStatus,
        providerRefundId: clean(data.providerRefundId),
      };
    }
    if (!orderSnapshot.exists) throw new Error('ORDER_ITEM_CANCELLATION_ORDER_NOT_FOUND');
    const order = orderSnapshot.data() as Record<string, unknown>;
    if (clean(order.storeId) !== input.storeId || clean(order.id) !== input.orderId) {
      throw new Error('ORDER_ITEM_CANCELLATION_ORDER_MISMATCH');
    }
    if (clean(order.status) !== 'pending') {
      throw new Error('ORDER_ITEM_CANCELLATION_ORDER_NOT_PENDING');
    }
    if (!Array.isArray(order.items) || order.items.length === 0) {
      throw new Error('ORDER_ITEM_CANCELLATION_ORDER_EMPTY');
    }

    const selections = new Map(
      input.selections.map(selection => [selection.lineId, selection.quantity])
    );
    const found = new Set<string>();
    const cancelledSnapshots: Array<Record<string, unknown>> = [];
    let cancelledAmount = 0;
    let totalRemainingQuantity = 0;

    const nextItems = order.items.flatMap(candidate => {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
        throw new Error('ORDER_ITEM_CANCELLATION_ORDER_INVALID');
      }
      const item = candidate as Record<string, unknown>;
      const lineId = clean(item.lineId);
      const currentQuantity = integer(item.quantity);
      if (!lineId || currentQuantity <= 0) {
        throw new Error('ORDER_ITEM_CANCELLATION_ORDER_INVALID');
      }
      const cancelQuantity = selections.get(lineId) ?? 0;
      if (cancelQuantity <= 0) {
        totalRemainingQuantity += currentQuantity;
        return [item];
      }
      found.add(lineId);
      if (cancelQuantity > currentQuantity) {
        throw new Error('ORDER_ITEM_CANCELLATION_QUANTITY_EXCEEDED');
      }
      const transferredQuantity = integer(item.transferredQuantity);
      const remainingQuantity = currentQuantity - cancelQuantity;
      if (transferredQuantity > remainingQuantity) {
        throw new Error('ORDER_ITEM_CANCELLATION_TRANSFERRED_QUANTITY');
      }

      const price = nonNegativeMoney(item.price);
      const settledAmount = nonNegativeMoney(item.settledAmount);
      const discountAmount = nonNegativeMoney(item.discountAmount);
      const ratio = remainingQuantity / currentQuantity;
      const remainingSettledAmount = money(settledAmount * ratio);
      const remainingDiscountAmount = money(discountAmount * ratio);
      const currentNetAmount = settledAmount > 0
        ? settledAmount
        : money(Math.max(0, currentQuantity * price - discountAmount));
      const remainingNetAmount = settledAmount > 0
        ? remainingSettledAmount
        : money(Math.max(0, remainingQuantity * price - remainingDiscountAmount));
      const lineCancelledAmount = money(currentNetAmount - remainingNetAmount);
      cancelledAmount = money(cancelledAmount + lineCancelledAmount);

      cancelledSnapshots.push({
        lineId,
        productId: clean(item.productId),
        name: clean(item.name),
        quantity: cancelQuantity,
        unitPrice: price,
        cancelledAmount: lineCancelledAmount,
      });

      if (remainingQuantity === 0) return [];
      totalRemainingQuantity += remainingQuantity;
      return [{
        ...item,
        quantity: remainingQuantity,
        paidQuantity: Math.min(integer(item.paidQuantity), remainingQuantity),
        transferredQuantity,
        settledAmount: remainingSettledAmount,
        discountAmount: remainingDiscountAmount,
      }];
    });

    if (found.size !== input.selections.length) {
      throw new Error('ORDER_ITEM_CANCELLATION_LINE_NOT_FOUND');
    }
    if (totalRemainingQuantity <= 0 || nextItems.length === 0) {
      throw new Error('ORDER_ITEM_CANCELLATION_USE_FULL_REJECTION');
    }
    if (cancelledAmount <= 0) {
      throw new Error('ORDER_ITEM_CANCELLATION_AMOUNT_INVALID');
    }

    const previousTotal = nonNegativeMoney(order.total);
    const remainingTotal = money(Math.max(0, previousTotal - cancelledAmount));
    const remainingSubtotal = money(nextItems.reduce((sum, candidate) => {
      const item = candidate as Record<string, unknown>;
      return sum + nonNegativeMoney(item.price) * integer(item.quantity);
    }, 0));
    const paymentStatus = clean(order.paymentStatus);
    const refundRequired = paymentStatus === 'paid';
    const updatedAt = new Date().toISOString();
    const cancellationRecord = {
      storeId: input.storeId,
      orderId: input.orderId,
      operationId: input.operationId,
      kind: 'partial_item_cancellation',
      reason: input.reason,
      alternative: input.alternative,
      items: cancelledSnapshots,
      cancelledAmount,
      previousTotal,
      remainingTotal,
      paymentStatus,
      refundRequired,
      refundStatus: refundRequired ? 'required' : 'not_required',
      providerRefundId: '',
      createdAt: updatedAt,
      updatedAt,
    };
    const nextCustomerNote = [
      clean(order.customerNote),
      `Cancelamento parcial: ${input.reason}`,
      input.alternative ? `Alternativa sugerida: ${input.alternative}` : '',
    ].filter(Boolean).join('\n');
    const orderPatch = {
      items: nextItems,
      subtotal: remainingSubtotal,
      total: remainingTotal,
      customerNote: nextCustomerNote,
      lastPartialCancellation: {
        operationId: input.operationId,
        cancelledAmount,
        reason: input.reason,
        itemCount: cancelledSnapshots.length,
        createdAt: updatedAt,
      },
      partialCancellationTotal: FieldValue.increment(cancelledAmount),
      updatedAt,
    };

    transaction.set(orderRef, orderPatch, { merge: true });
    const canonicalStoreId = clean(tenantSnapshot.data()?.canonicalStoreId);
    if (canonicalStoreId) {
      transaction.set(
        adminDb.doc(`stores/${canonicalStoreId}/orders/${input.orderId}`),
        orderPatch,
        { merge: true }
      );
    }
    transaction.create(cancellationRef, cancellationRecord);

    return {
      orderId: input.orderId,
      operationId: input.operationId,
      cancelledAmount,
      remainingTotal,
      paymentStatus,
      duplicate: false,
      refundStatus: refundRequired ? 'required' : 'not_required',
      providerRefundId: '',
    };
  });
};

const syncCancellationRefundState = async (input: {
  storeId: string;
  operationId: string;
  status: OrderItemCancellationRefundStatus;
  providerRefundId: string;
}): Promise<void> => {
  await adminDb.doc(cancellationPath(input.storeId, input.operationId)).set({
    refundStatus: input.status,
    providerRefundId: input.providerRefundId,
    updatedAt: new Date().toISOString(),
  }, { merge: true });
};

export const cancelOrderItemsWithRefund = async (input: {
  storeId: string;
  orderId: string;
  operationId: string;
  reason: string;
  alternative?: string;
  selections: unknown;
}): Promise<OrderItemCancellationResult> => {
  const storeId = clean(input.storeId);
  const orderId = clean(input.orderId);
  const operationId = clean(input.operationId);
  const reason = clean(input.reason);
  const alternative = clean(input.alternative);
  if (!storeId || !orderId) throw new Error('ORDER_ITEM_CANCELLATION_TARGET_REQUIRED');
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(operationId)) {
    throw new Error('ORDER_ITEM_CANCELLATION_OPERATION_REQUIRED');
  }
  if (!reason || reason.length > 500 || alternative.length > 500) {
    throw new Error('ORDER_ITEM_CANCELLATION_REASON_REQUIRED');
  }
  const selections = normalizeSelections(input.selections);
  const mutation = await mutateOrderItems({
    storeId,
    orderId,
    operationId,
    reason,
    alternative,
    selections,
  });

  if (mutation.paymentStatus !== 'paid') {
    return {
      orderId,
      operationId,
      cancelledAmount: mutation.cancelledAmount,
      remainingTotal: mutation.remainingTotal,
      refundRequired: false,
      refundStatus: 'not_required',
      providerRefundId: '',
      duplicate: mutation.duplicate,
    };
  }

  const refund = await attemptPartialRefund({
    storeId,
    orderId,
    operationId,
    amount: mutation.cancelledAmount,
    reason,
  });
  await syncCancellationRefundState({
    storeId,
    operationId,
    status: refund.status,
    providerRefundId: refund.providerRefundId,
  });
  return {
    orderId,
    operationId,
    cancelledAmount: mutation.cancelledAmount,
    remainingTotal: mutation.remainingTotal,
    refundRequired: true,
    refundStatus: refund.status,
    providerRefundId: refund.providerRefundId,
    duplicate: mutation.duplicate,
  };
};
