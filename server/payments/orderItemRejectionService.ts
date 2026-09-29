import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';

export interface OrderItemRejectionLineInput {
  lineId: string;
  quantity: number;
}

export interface OrderItemRejectionResult {
  orderId: string;
  status: 'pending';
  paymentStatus: 'unpaid';
  cancelledAmount: number;
  subtotal: number;
  total: number;
  lines: OrderItemRejectionLineInput[];
}

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const money = (value: number): number =>
  Math.round((value + Number.EPSILON) * 100) / 100;

const nonNegativeInteger = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : null;

const positiveMoney = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? money(value)
    : null;

const parseSelection = (value: unknown): OrderItemRejectionLineInput[] => {
  if (!Array.isArray(value)) throw new Error('ORDER_ITEM_REJECTION_LINES_REQUIRED');
  const byLine = new Map<string, number>();
  for (const candidate of value.slice(0, 100)) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new Error('ORDER_ITEM_REJECTION_LINES_INVALID');
    }
    const line = candidate as Record<string, unknown>;
    const lineId = clean(line.lineId);
    const quantity = nonNegativeInteger(line.quantity);
    if (!lineId || quantity === null || quantity <= 0) {
      throw new Error('ORDER_ITEM_REJECTION_LINES_INVALID');
    }
    byLine.set(lineId, (byLine.get(lineId) ?? 0) + quantity);
  }
  const parsed = [...byLine.entries()].map(([lineId, quantity]) => ({ lineId, quantity }));
  if (parsed.length === 0) throw new Error('ORDER_ITEM_REJECTION_LINES_REQUIRED');
  return parsed;
};

export const rejectPendingOrderItems = async (input: {
  storeId: string;
  orderId: string;
  reason: string;
  alternative?: string;
  lines: OrderItemRejectionLineInput[];
}): Promise<OrderItemRejectionResult> => {
  const storeId = clean(input.storeId);
  const orderId = clean(input.orderId);
  const reason = clean(input.reason);
  const alternative = clean(input.alternative);
  const requestedLines = parseSelection(input.lines);

  if (!storeId || !orderId) throw new Error('ORDER_ITEM_REJECTION_TARGET_REQUIRED');
  if (!reason || reason.length > 500) throw new Error('ORDER_ITEM_REJECTION_REASON_REQUIRED');
  if (alternative.length > 500) throw new Error('ORDER_ITEM_REJECTION_ALTERNATIVE_INVALID');

  return adminDb.runTransaction(async transaction => {
    const orderRef = adminDb.doc(
      `artifacts/${storeId}/public/data/customerOrders/${orderId}`
    );
    const tenantRef = adminDb.doc(`tenants/${storeId}`);
    const [orderSnapshot, tenantSnapshot] = await Promise.all([
      transaction.get(orderRef),
      transaction.get(tenantRef),
    ]);

    if (!orderSnapshot.exists) throw new Error('ORDER_ITEM_REJECTION_ORDER_NOT_FOUND');
    const order = orderSnapshot.data() as Record<string, unknown>;
    if (clean(order.id) !== orderId || clean(order.storeId) !== storeId) {
      throw new Error('ORDER_ITEM_REJECTION_ORDER_MISMATCH');
    }
    if (clean(order.status) !== 'pending') {
      throw new Error('ORDER_ITEM_REJECTION_PENDING_REQUIRED');
    }
    if (clean(order.paymentStatus) !== 'unpaid') {
      throw new Error('ORDER_ITEM_REJECTION_PARTIAL_REFUND_REQUIRED');
    }
    const sourceChannel = clean(order.sourceChannel);
    const integration = order.integration && typeof order.integration === 'object' && !Array.isArray(order.integration)
      ? order.integration as Record<string, unknown>
      : {};
    if ((sourceChannel && sourceChannel !== 'kyrub') || clean(integration.provider)) {
      throw new Error('ORDER_ITEM_REJECTION_INTEGRATED_UNSUPPORTED');
    }
    if (!Array.isArray(order.items) || order.items.length === 0) {
      throw new Error('ORDER_ITEM_REJECTION_ORDER_INVALID');
    }

    const requestedByLine = new Map(requestedLines.map(line => [line.lineId, line.quantity]));
    const found = new Set<string>();
    let cancelledGross = 0;
    let cancelledDiscount = 0;
    let remainingOperationalQuantity = 0;
    const rejectedDescriptions: string[] = [];

    const nextItems = order.items.map(candidate => {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
        throw new Error('ORDER_ITEM_REJECTION_ORDER_INVALID');
      }
      const item = candidate as Record<string, unknown>;
      const lineId = clean(item.lineId);
      const name = clean(item.name) || 'Item';
      const quantity = nonNegativeInteger(item.quantity);
      const transferredQuantity = nonNegativeInteger(item.transferredQuantity) ?? 0;
      const voidedQuantity = nonNegativeInteger(item.voidedQuantity) ?? 0;
      const price = positiveMoney(item.price);
      const discountAmount = positiveMoney(item.discountAmount) ?? 0;
      if (!lineId || quantity === null || quantity <= 0 || price === null) {
        throw new Error('ORDER_ITEM_REJECTION_ORDER_INVALID');
      }
      const available = Math.max(0, quantity - transferredQuantity - voidedQuantity);
      const requested = requestedByLine.get(lineId) ?? 0;
      if (requested > 0) {
        found.add(lineId);
        if (requested > available) {
          throw new Error('ORDER_ITEM_REJECTION_QUANTITY_INVALID');
        }
        const discountShare = available > 0
          ? money(discountAmount * requested / available)
          : 0;
        cancelledGross = money(cancelledGross + price * requested);
        cancelledDiscount = money(cancelledDiscount + discountShare);
        rejectedDescriptions.push(`${requested}× ${name}`);
        remainingOperationalQuantity += available - requested;
        return {
          ...item,
          voidedQuantity: voidedQuantity + requested,
          discountAmount: money(Math.max(0, discountAmount - discountShare)),
        };
      }
      remainingOperationalQuantity += available;
      return item;
    });

    if (found.size !== requestedByLine.size) {
      throw new Error('ORDER_ITEM_REJECTION_LINE_NOT_FOUND');
    }
    if (remainingOperationalQuantity <= 0) {
      throw new Error('ORDER_ITEM_REJECTION_WHOLE_ORDER_REQUIRED');
    }

    const currentSubtotal = positiveMoney(order.subtotal);
    const currentTotal = positiveMoney(order.total);
    if (currentSubtotal === null || currentTotal === null) {
      throw new Error('ORDER_ITEM_REJECTION_ORDER_INVALID');
    }
    const cancelledAmount = money(Math.max(0, cancelledGross - cancelledDiscount));
    const nextSubtotal = money(Math.max(0, currentSubtotal - cancelledGross));
    const nextTotal = money(Math.max(0, currentTotal - cancelledAmount));
    const now = new Date().toISOString();
    const note = [
      `Itens recusados: ${rejectedDescriptions.join(', ')}`,
      `Motivo: ${reason}`,
      alternative ? `Alternativa: ${alternative}` : '',
    ].filter(Boolean).join(' · ');
    const currentCustomerNote = clean(order.customerNote);
    const nextCustomerNote = [currentCustomerNote, note].filter(Boolean).join('\n');
    const event = {
      id: `item-rejection:${now}:${requestedLines.map(line => `${line.lineId}:${line.quantity}`).join('|')}`,
      reason,
      alternative,
      lines: requestedLines,
      cancelledAmount,
      rejectedAt: now,
      actorUid: storeId,
    };
    const patch = {
      items: nextItems,
      subtotal: nextSubtotal,
      total: nextTotal,
      customerNote: nextCustomerNote,
      updatedAt: now,
      lastItemRejectionAt: now,
      itemRejections: FieldValue.arrayUnion(event),
    };

    transaction.set(orderRef, patch, { merge: true });
    const canonicalStoreId = clean(tenantSnapshot.data()?.canonicalStoreId);
    if (canonicalStoreId) {
      transaction.set(
        adminDb.doc(`stores/${canonicalStoreId}/orders/${orderId}`),
        patch,
        { merge: true }
      );
    }

    return {
      orderId,
      status: 'pending',
      paymentStatus: 'unpaid',
      cancelledAmount,
      subtotal: nextSubtotal,
      total: nextTotal,
      lines: requestedLines,
    };
  });
};
