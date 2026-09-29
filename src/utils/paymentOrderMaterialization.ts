import type { CustomerOrder, CustomerOrderItem } from './customerOrders.js';
import {
  canMaterializeOperationalOrder,
  normalizeCanonicalPaymentIntent,
  type CanonicalPaymentIntent,
  type MarketplaceCanonicalPaymentIntent,
  type PaymentIntentOrderDraft,
} from './canonicalPaymentIntent.js';

export type PendingMarketplaceOperationalOrder = CustomerOrder & {
  paymentIntentId: string;
  paymentId: string;
  checkoutAuthority: 'merchant_approval_required';
};

const roundMoney = (value: number): number => Math.round(value * 100) / 100;

const allocateDraftDiscounts = (draft: PaymentIntentOrderDraft): number[] => {
  const discountTotal = roundMoney(draft.discountTotal ?? 0);
  if (discountTotal <= 0) return draft.items.map(() => 0);

  const eligibleProductIds = new Set(
    draft.promotionSnapshot?.eligibleProductIds ?? draft.items.map(item => item.productId)
  );
  const eligibleIndexes = draft.items.flatMap((item, index) =>
    eligibleProductIds.has(item.productId) ? [index] : []
  );
  if (!eligibleIndexes.length) {
    throw new Error('PAYMENT_ORDER_DISCOUNT_ALLOCATION_INVALID');
  }

  const eligibleSubtotal = roundMoney(
    eligibleIndexes.reduce((sum, index) => sum + draft.items[index].total, 0)
  );
  if (eligibleSubtotal <= 0 || discountTotal > eligibleSubtotal) {
    throw new Error('PAYMENT_ORDER_DISCOUNT_ALLOCATION_INVALID');
  }

  const targetCents = Math.round(discountTotal * 100);
  const allocations = draft.items.map(() => 0);
  let allocatedCents = 0;

  eligibleIndexes.forEach((index, position) => {
    const line = draft.items[index];
    const lineCents = Math.round(line.total * 100);
    const cents = position === eligibleIndexes.length - 1
      ? targetCents - allocatedCents
      : Math.min(
          lineCents,
          Math.floor((targetCents * line.total) / eligibleSubtotal)
        );
    allocations[index] = cents / 100;
    allocatedCents += cents;
  });

  if (allocatedCents !== targetCents) {
    throw new Error('PAYMENT_ORDER_DISCOUNT_ALLOCATION_INVALID');
  }
  return allocations;
};

const marketplaceOrderItems = (
  draft: PaymentIntentOrderDraft,
  paid: boolean
): CustomerOrderItem[] => {
  const discounts = allocateDraftDiscounts(draft);
  return draft.items.map((item, index) => {
    const discountAmount = discounts[index];
    const netAmount = roundMoney(Math.max(0, item.total - discountAmount));
    return {
      lineId: `${draft.draftId}:${index + 1}`,
      productId: item.productId,
      name: item.name,
      price: item.unitPrice,
      quantity: item.quantity,
      paidQuantity: 0,
      transferredQuantity: 0,
      voidedQuantity: 0,
      settledAmount: paid ? netAmount : 0,
      discountAmount,
      note: item.note ?? '',
      image: item.image ?? '',
      isService: item.isService === true,
    };
  });
};

const baseMarketplaceOrder = (
  intent: MarketplaceCanonicalPaymentIntent,
  now: string,
  paid: boolean
): CustomerOrder => {
  const draft = intent.orderDraft;
  return {
    id: draft.draftId,
    storeId: draft.storeId,
    buyerId: draft.buyerId,
    buyerName: draft.buyerName,
    buyerEmail: draft.buyerEmail,
    fulfillmentType: draft.fulfillmentType,
    deliveryAddress: draft.deliveryAddress,
    tableCode: '',
    customerNote: draft.customerNote,
    items: marketplaceOrderItems(draft, paid),
    subtotal: draft.subtotal,
    total: draft.total,
    status: 'pending',
    paymentStatus: paid ? 'paid' : 'unpaid',
    source: 'customer',
    sourceChannel: 'kyrub',
    operatorId: draft.buyerId,
    operatorName: draft.buyerName,
    createdAt: now,
    updatedAt: now,
  };
};

const validTimestamp = (value: string): string => {
  const normalized = value.trim();
  if (!normalized || Number.isNaN(Date.parse(normalized))) {
    throw new Error('ORDER_MATERIALIZATION_TIMESTAMP_INVALID');
  }
  return normalized;
};

export const materializePendingMarketplaceOrder = (input: {
  intent: CanonicalPaymentIntent;
  paymentId: string;
  now?: string;
}): PendingMarketplaceOperationalOrder => {
  const intent = normalizeCanonicalPaymentIntent(input.intent);
  if (intent.context !== 'marketplace' || intent.status !== 'pending') {
    throw new Error('PAYMENT_PENDING_ORDER_MATERIALIZATION_INVALID');
  }
  const paymentId = input.paymentId.trim();
  if (!paymentId) throw new Error('PAYMENT_ID_REQUIRED_BEFORE_ORDER_MATERIALIZATION');
  const now = validTimestamp(input.now || new Date().toISOString());

  return {
    ...baseMarketplaceOrder(intent, now, false),
    paymentIntentId: intent.id,
    paymentId,
    checkoutAuthority: 'merchant_approval_required',
  };
};

export const materializePaidMarketplaceOrder = (input: {
  intent: CanonicalPaymentIntent;
  now?: string;
}): CustomerOrder => {
  const intent = normalizeCanonicalPaymentIntent(input.intent);
  if (
    intent.context !== 'marketplace' ||
    !canMaterializeOperationalOrder(intent)
  ) {
    throw new Error('PAYMENT_REQUIRED_BEFORE_ORDER_MATERIALIZATION');
  }

  const now = validTimestamp(input.now || new Date().toISOString());
  return baseMarketplaceOrder(intent, now, true);
};

export const settleExistingMarketplaceOrder = (input: {
  order: CustomerOrder;
  intent: CanonicalPaymentIntent;
  now?: string;
}): CustomerOrder => {
  const intent = normalizeCanonicalPaymentIntent(input.intent);
  if (intent.context !== 'marketplace') {
    throw new Error('PAYMENT_ORDER_SETTLEMENT_CONTEXT_INVALID');
  }
  const order = input.order;
  if (
    order.id !== intent.target.orderId ||
    order.storeId !== intent.storeId ||
    order.buyerId !== intent.buyerId
  ) {
    throw new Error('PAYMENT_ORDER_SETTLEMENT_TARGET_MISMATCH');
  }
  const now = validTimestamp(input.now || new Date().toISOString());

  return {
    ...order,
    paymentStatus: 'paid',
    items: order.items.map(item => {
      const billableQuantity = Math.max(
        0,
        item.quantity - item.transferredQuantity - (item.voidedQuantity ?? 0)
      );
      const grossAmount = roundMoney(billableQuantity * item.price);
      const discountAmount = roundMoney(Math.max(0, item.discountAmount ?? 0));
      return {
        ...item,
        paidQuantity: 0,
        settledAmount: roundMoney(Math.max(0, grossAmount - discountAmount)),
      };
    }),
    updatedAt: now,
  };
};
