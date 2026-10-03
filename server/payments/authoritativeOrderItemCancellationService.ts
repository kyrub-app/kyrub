import { adminDb } from '../firebaseAdmin.js';
import {
  calculateAuthoritativeCancellationAmount,
  loadCommercialRefundAuthority,
} from './orderCommercialRefundAuthorityService.js';
import {
  cancelOrderItemsWithRefund as cancelOrderItemsWithLegacyCompatibleRefund,
  type OrderItemCancellationResult,
} from './orderItemCancellationService.js';

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

interface Selection {
  lineId: string;
  quantity: number;
}

const normalizeSelections = (value: unknown): Selection[] => {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('ORDER_ITEM_CANCELLATION_SELECTION_REQUIRED');
  }
  return value.map(candidate => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new Error('ORDER_ITEM_CANCELLATION_SELECTION_INVALID');
    }
    const record = candidate as Record<string, unknown>;
    const lineId = clean(record.lineId);
    const quantity = integer(record.quantity);
    if (!lineId || quantity <= 0) {
      throw new Error('ORDER_ITEM_CANCELLATION_SELECTION_INVALID');
    }
    return { lineId, quantity };
  });
};

const operationalCancellationAmount = (
  item: Record<string, unknown>,
  cancelQuantity: number
): number => {
  const currentQuantity = integer(item.quantity);
  if (currentQuantity <= 0 || cancelQuantity <= 0 || cancelQuantity > currentQuantity) {
    throw new Error('ORDER_COMMERCIAL_REFUND_QUANTITY_INVALID');
  }
  const price = nonNegativeMoney(item.price);
  const settledAmount = nonNegativeMoney(item.settledAmount);
  const discountAmount = nonNegativeMoney(item.discountAmount);
  const currentNetAmount = settledAmount > 0
    ? settledAmount
    : money(Math.max(0, currentQuantity * price - discountAmount));
  if (cancelQuantity === currentQuantity) return currentNetAmount;
  return money(currentNetAmount * (cancelQuantity / currentQuantity));
};

/**
 * New orders that have a create-once commercial snapshot are fail-closed before
 * the existing transactional mutation/refund path runs. The operational order
 * remains the fulfillment authority, but it may not authorize a financial
 * amount that differs from the immutable checkout snapshot.
 *
 * Legacy orders without a commercial snapshot retain the previous behavior.
 */
export const cancelOrderItemsWithAuthoritativeRefund = async (input: {
  storeId: string;
  orderId: string;
  operationId: string;
  reason: string;
  alternative?: string;
  selections: unknown;
}): Promise<OrderItemCancellationResult> => {
  const storeId = clean(input.storeId);
  const orderId = clean(input.orderId);
  const authority = await loadCommercialRefundAuthority(storeId, orderId);

  if (authority) {
    const selections = normalizeSelections(input.selections);
    const orderSnapshot = await adminDb
      .doc(`artifacts/${storeId}/public/data/customerOrders/${orderId}`)
      .get();
    if (!orderSnapshot.exists) {
      throw new Error('ORDER_ITEM_CANCELLATION_ORDER_NOT_FOUND');
    }
    const order = orderSnapshot.data() as Record<string, unknown>;
    if (clean(order.storeId) !== storeId || clean(order.id) !== orderId) {
      throw new Error('ORDER_COMMERCIAL_REFUND_AUTHORITY_MISMATCH');
    }
    if (!Array.isArray(order.items)) {
      throw new Error('ORDER_COMMERCIAL_REFUND_AUTHORITY_EMPTY');
    }
    const operationalLines = new Map<string, Record<string, unknown>>();
    for (const candidate of order.items) {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
      const item = candidate as Record<string, unknown>;
      const lineId = clean(item.lineId);
      if (lineId) operationalLines.set(lineId, item);
    }

    for (const selection of selections) {
      const frozenLine = authority.lines.get(selection.lineId);
      const operationalLine = operationalLines.get(selection.lineId);
      if (!frozenLine || !operationalLine) {
        throw new Error('ORDER_COMMERCIAL_REFUND_LINE_NOT_FOUND');
      }
      if (
        clean(operationalLine.productId) &&
        frozenLine.productId &&
        clean(operationalLine.productId) !== frozenLine.productId
      ) {
        throw new Error('ORDER_COMMERCIAL_REFUND_LINE_IDENTITY_MISMATCH');
      }
      const authoritativeAmount = calculateAuthoritativeCancellationAmount({
        authority,
        lineId: selection.lineId,
        cancelQuantity: selection.quantity,
      });
      const operationalAmount = operationalCancellationAmount(
        operationalLine,
        selection.quantity
      );
      if (money(authoritativeAmount) !== money(operationalAmount)) {
        throw new Error('ORDER_COMMERCIAL_REFUND_AMOUNT_MISMATCH');
      }
    }
  }

  return cancelOrderItemsWithLegacyCompatibleRefund(input);
};
