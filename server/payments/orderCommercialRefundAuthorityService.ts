import { adminDb } from '../firebaseAdmin.js';
import { orderCommercialSnapshotPath } from './orderCommercialSnapshotService.js';

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

export interface CommercialRefundAuthorityLine {
  lineId: string;
  productId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  discountAmount: number;
  settledAmount: number;
  netAmount: number;
}

export interface CommercialRefundAuthority {
  source: 'immutable_commercial_snapshot';
  storeId: string;
  orderId: string;
  paymentIntentId: string;
  paymentId: string;
  capturedAt: string;
  total: number;
  lines: Map<string, CommercialRefundAuthorityLine>;
}

/**
 * Loads the create-once checkout snapshot used as financial authority for
 * post-payment item cancellation. Absence means legacy order; presence means
 * callers must reconcile selected lines against this snapshot and must not
 * estimate a refund from a later mutable fulfillment state.
 */
export const loadCommercialRefundAuthority = async (
  storeId: string,
  orderId: string
): Promise<CommercialRefundAuthority | null> => {
  const snapshot = await adminDb.doc(orderCommercialSnapshotPath(storeId, orderId)).get();
  if (!snapshot.exists) return null;

  const frozen = snapshot.data() as Record<string, unknown>;
  const order = frozen.order && typeof frozen.order === 'object' && !Array.isArray(frozen.order)
    ? frozen.order as Record<string, unknown>
    : null;
  if (
    !order ||
    clean(frozen.storeId) !== storeId ||
    clean(frozen.orderId) !== orderId ||
    clean(order.storeId) !== storeId ||
    clean(order.id) !== orderId
  ) {
    throw new Error('ORDER_COMMERCIAL_REFUND_AUTHORITY_MISMATCH');
  }
  if (!Array.isArray(order.items) || order.items.length === 0) {
    throw new Error('ORDER_COMMERCIAL_REFUND_AUTHORITY_EMPTY');
  }

  const lines = new Map<string, CommercialRefundAuthorityLine>();
  for (const candidate of order.items) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new Error('ORDER_COMMERCIAL_REFUND_AUTHORITY_INVALID');
    }
    const item = candidate as Record<string, unknown>;
    const lineId = clean(item.lineId);
    const quantity = integer(item.quantity);
    if (!lineId || quantity <= 0 || lines.has(lineId)) {
      throw new Error('ORDER_COMMERCIAL_REFUND_AUTHORITY_INVALID');
    }
    const unitPrice = nonNegativeMoney(item.price);
    const discountAmount = nonNegativeMoney(item.discountAmount);
    const settledAmount = nonNegativeMoney(item.settledAmount);
    const netAmount = settledAmount > 0
      ? settledAmount
      : money(Math.max(0, quantity * unitPrice - discountAmount));
    if (netAmount <= 0 && unitPrice <= 0) {
      throw new Error('ORDER_COMMERCIAL_REFUND_AUTHORITY_AMOUNT_INVALID');
    }
    lines.set(lineId, {
      lineId,
      productId: clean(item.productId),
      name: clean(item.name),
      quantity,
      unitPrice,
      discountAmount,
      settledAmount,
      netAmount,
    });
  }

  return {
    source: 'immutable_commercial_snapshot',
    storeId,
    orderId,
    paymentIntentId: clean(frozen.paymentIntentId),
    paymentId: clean(frozen.paymentId),
    capturedAt: clean(frozen.capturedAt),
    total: nonNegativeMoney(order.total),
    lines,
  };
};

export const calculateAuthoritativeCancellationAmount = (input: {
  authority: CommercialRefundAuthority;
  lineId: string;
  cancelQuantity: number;
}): number => {
  const line = input.authority.lines.get(input.lineId);
  if (!line) throw new Error('ORDER_COMMERCIAL_REFUND_LINE_NOT_FOUND');
  if (!Number.isInteger(input.cancelQuantity) || input.cancelQuantity <= 0 || input.cancelQuantity > line.quantity) {
    throw new Error('ORDER_COMMERCIAL_REFUND_QUANTITY_INVALID');
  }
  // Proportional allocation is deterministic and capped by the exact frozen
  // net amount. Cancelling the complete frozen quantity always returns the
  // exact frozen line net amount, avoiding cent drift.
  if (input.cancelQuantity === line.quantity) return line.netAmount;
  return money(line.netAmount * (input.cancelQuantity / line.quantity));
};
