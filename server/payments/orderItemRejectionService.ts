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

const nonNegativeMoney = (value: unknown): number | null =>
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

type ParsedOrderLine = {
  raw: Record<string, unknown>;
  lineId: string;
  productId: string;
  name: string;
  price: number;
  quantity: number;
  discountAmount: number;
};

const parsePendingOrderLine = (candidate: unknown): ParsedOrderLine => {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new Error('ORDER_ITEM_REJECTION_ORDER_INVALID');
  }
  const raw = candidate as Record<string, unknown>;
  const lineId = clean(raw.lineId);
  const productId = clean(raw.productId);
  const name = clean(raw.name) || 'Item';
  const quantity = nonNegativeInteger(raw.quantity);
  const paidQuantity = nonNegativeInteger(raw.paidQuantity) ?? 0;
  const transferredQuantity = nonNegativeInteger(raw.transferredQuantity) ?? 0;
  const voidedQuantity = nonNegativeInteger(raw.voidedQuantity) ?? 0;
  const settledAmount = nonNegativeMoney(raw.settledAmount) ?? 0;
  const price = nonNegativeMoney(raw.price);
  const discountAmount = nonNegativeMoney(raw.discountAmount) ?? 0;
  if (
    !lineId ||
    !productId ||
    quantity === null ||
    quantity <= 0 ||
    price === null ||
    paidQuantity !== 0 ||
    transferredQuantity !== 0 ||
    voidedQuantity !== 0 ||
    settledAmount > 0 ||
    discountAmount > money(price * quantity) + 0.009
  ) {
    throw new Error('ORDER_ITEM_REJECTION_ORDER_INVALID');
  }
  return { raw, lineId, productId, name, price, quantity, discountAmount };
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

    const parsedItems = order.items.map(parsePendingOrderLine);
    const requestedByLine = new Map(requestedLines.map(line => [line.lineId, line.quantity]));
    const found = new Set<string>();
    let cancelledGross = 0;
    let cancelledDiscount = 0;
    const rejectedDescriptions: string[] = [];

    const nextItems = parsedItems.flatMap(item => {
      const requested = requestedByLine.get(item.lineId) ?? 0;
      if (requested <= 0) return [item.raw];
      found.add(item.lineId);
      if (requested > item.quantity) {
        throw new Error('ORDER_ITEM_REJECTION_QUANTITY_INVALID');
      }
      const discountShare = money(item.discountAmount * requested / item.quantity);
      cancelledGross = money(cancelledGross + item.price * requested);
      cancelledDiscount = money(cancelledDiscount + discountShare);
      rejectedDescriptions.push(`${requested}× ${item.name}`);
      const remainingQuantity = item.quantity - requested;
      if (remainingQuantity === 0) return [];
      return [{
        ...item.raw,
        quantity: remainingQuantity,
        discountAmount: money(Math.max(0, item.discountAmount - discountShare)),
      }];
    });

    if (found.size !== requestedByLine.size) {
      throw new Error('ORDER_ITEM_REJECTION_LINE_NOT_FOUND');
    }
    if (nextItems.length === 0) {
      throw new Error('ORDER_ITEM_REJECTION_WHOLE_ORDER_REQUIRED');
    }

    const currentSubtotal = nonNegativeMoney(order.subtotal);
    const currentTotal = nonNegativeMoney(order.total);
    if (currentSubtotal === null || currentTotal === null) {
      throw new Error('ORDER_ITEM_REJECTION_ORDER_INVALID');
    }
    const cancelledAmount = money(Math.max(0, cancelledGross - cancelledDiscount));
    const nextSubtotal = money(Math.max(0, currentSubtotal - cancelledGross));
    const nextTotal = money(Math.max(0, currentTotal - cancelledAmount));
    if (nextTotal <= 0) throw new Error('ORDER_ITEM_REJECTION_WHOLE_ORDER_REQUIRED');

    const paymentIntentId = clean(order.paymentIntentId);
    const paymentId = clean(order.paymentId);
    if (Boolean(paymentIntentId) !== Boolean(paymentId)) {
      throw new Error('ORDER_ITEM_REJECTION_PAYMENT_STATE_INVALID');
    }

    let intentRef: ReturnType<typeof adminDb.doc> | null = null;
    let paymentRef: ReturnType<typeof adminDb.doc> | null = null;
    let nextOrderDraft: Record<string, unknown> | null = null;
    if (paymentIntentId && paymentId) {
      intentRef = adminDb.doc(`stores/${storeId}/paymentIntents/${paymentIntentId}`);
      paymentRef = adminDb.doc(`stores/${storeId}/payments/${paymentId}`);
      const [intentSnapshot, paymentSnapshot] = await Promise.all([
        transaction.get(intentRef),
        transaction.get(paymentRef),
      ]);
      if (!intentSnapshot.exists || !paymentSnapshot.exists) {
        throw new Error('ORDER_ITEM_REJECTION_PAYMENT_STATE_INVALID');
      }
      const intent = intentSnapshot.data() as Record<string, unknown>;
      const payment = paymentSnapshot.data() as Record<string, unknown>;
      const orderDraft = intent.orderDraft && typeof intent.orderDraft === 'object' && !Array.isArray(intent.orderDraft)
        ? intent.orderDraft as Record<string, unknown>
        : null;
      const draftItems = Array.isArray(orderDraft?.items) ? orderDraft.items : [];
      if (
        clean(intent.id) !== paymentIntentId ||
        clean(intent.storeId) !== storeId ||
        clean(intent.status) !== 'pending' ||
        clean(intent.providerIntentId) ||
        clean(payment.id) !== paymentId ||
        clean(payment.storeId) !== storeId ||
        clean(payment.orderId) !== orderId ||
        clean(payment.status) !== 'pending' ||
        clean(payment.providerPaymentId) ||
        !orderDraft ||
        clean(orderDraft.draftId) !== orderId ||
        draftItems.length !== parsedItems.length
      ) {
        throw new Error('ORDER_ITEM_REJECTION_PAYMENT_ALREADY_AUTHORIZED');
      }

      const nextDraftItems = draftItems.flatMap((candidate, index) => {
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
          throw new Error('ORDER_ITEM_REJECTION_PAYMENT_STATE_INVALID');
        }
        const draftItem = candidate as Record<string, unknown>;
        const orderItem = parsedItems[index];
        const draftQuantity = nonNegativeInteger(draftItem.quantity);
        const unitPrice = nonNegativeMoney(draftItem.unitPrice);
        if (
          clean(draftItem.productId) !== orderItem.productId ||
          draftQuantity !== orderItem.quantity ||
          unitPrice === null ||
          unitPrice !== orderItem.price
        ) {
          throw new Error('ORDER_ITEM_REJECTION_PAYMENT_STATE_INVALID');
        }
        const requested = requestedByLine.get(orderItem.lineId) ?? 0;
        const remainingQuantity = orderItem.quantity - requested;
        if (remainingQuantity <= 0) return [];
        return [{
          ...draftItem,
          quantity: remainingQuantity,
          total: money(unitPrice * remainingQuantity),
        }];
      });
      const currentDiscountTotal = nonNegativeMoney(orderDraft.discountTotal) ?? 0;
      nextOrderDraft = {
        ...orderDraft,
        items: nextDraftItems,
        subtotal: nextSubtotal,
        discountTotal: money(Math.max(0, currentDiscountTotal - cancelledDiscount)),
        total: nextTotal,
      };
    }

    const now = new Date().toISOString();
    const event = {
      id: `item-rejection:${now}:${requestedLines.map(line => `${line.lineId}:${line.quantity}`).join('|')}`,
      reason,
      alternative,
      lines: requestedLines,
      items: rejectedDescriptions,
      cancelledGross,
      cancelledDiscount,
      cancelledAmount,
      rejectedAt: now,
      actorUid: storeId,
    };
    const patch = {
      items: nextItems,
      subtotal: nextSubtotal,
      total: nextTotal,
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
    if (intentRef && paymentRef && nextOrderDraft) {
      transaction.update(intentRef, {
        amount: nextTotal,
        orderDraft: nextOrderDraft,
        updatedAt: now,
      });
      transaction.update(paymentRef, {
        amount: nextTotal,
        updatedAt: now,
      });
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
