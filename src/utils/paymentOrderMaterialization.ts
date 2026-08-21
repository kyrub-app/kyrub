import type { CustomerOrder } from './customerOrders';
import {
  canMaterializeOperationalOrder,
  normalizeCanonicalPaymentIntent,
  type CanonicalPaymentIntent,
} from './canonicalPaymentIntent';

export const materializePaidMarketplaceOrder = (input: {
  intent: CanonicalPaymentIntent;
  now?: string;
}): CustomerOrder => {
  const intent = normalizeCanonicalPaymentIntent(input.intent);
  if (!canMaterializeOperationalOrder(intent)) {
    throw new Error('PAYMENT_REQUIRED_BEFORE_ORDER_MATERIALIZATION');
  }

  const now = (input.now || new Date().toISOString()).trim();
  if (!now || Number.isNaN(Date.parse(now))) {
    throw new Error('ORDER_MATERIALIZATION_TIMESTAMP_INVALID');
  }

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
    items: draft.items.map((item, index) => ({
      lineId: `${draft.draftId}:${index + 1}`,
      productId: item.productId,
      name: item.name,
      price: item.unitPrice,
      quantity: item.quantity,
      paidQuantity: item.quantity,
      transferredQuantity: 0,
      note: '',
      image: '',
      isService: false,
    })),
    subtotal: draft.subtotal,
    total: draft.total,
    status: 'pending',
    paymentStatus: 'paid',
    source: 'customer',
    operatorId: draft.buyerId,
    operatorName: draft.buyerName,
    createdAt: now,
    updatedAt: now,
  };
};
