import type { PaymentMethod } from './canonicalPayment';
import type { StorePromotionDiscountType } from './storePromotions';

export type PaymentIntentStatus = 'pending' | 'paid' | 'failed' | 'expired';

export interface PaymentIntentItem {
  productId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  total: number;
  note?: string;
  image?: string;
  isService?: boolean;
}

export interface PaymentIntentPromotionSnapshot {
  promotionId: string;
  code: string;
  title: string;
  badge: string;
  discountType: StorePromotionDiscountType;
  discountValue: number;
  eligibleProductIds: string[];
}

export interface PaymentIntentOrderDraft {
  draftId: string;
  storeId: string;
  buyerId: string;
  buyerName: string;
  buyerEmail: string;
  fulfillmentType: 'delivery' | 'pickup';
  deliveryAddress: string;
  customerNote: string;
  items: PaymentIntentItem[];
  subtotal: number;
  discountTotal?: number;
  couponCode?: string;
  promotionSnapshot?: PaymentIntentPromotionSnapshot | null;
  deliveryFee: number;
  total: number;
}

export interface CanonicalPaymentIntent {
  id: string;
  storeId: string;
  buyerId: string;
  method: PaymentMethod;
  status: PaymentIntentStatus;
  amount: number;
  currency: 'BRL';
  provider: string;
  providerIntentId: string;
  idempotencyKey: string;
  orderDraft: PaymentIntentOrderDraft;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

const required = (label: string, value: string): string => {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
};

const money = (label: string, value: number): number => {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a finite non-negative number.`);
  }
  return Number(value.toFixed(2));
};

export const normalizePaymentIntentItem = (
  item: PaymentIntentItem
): PaymentIntentItem => {
  if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
    throw new Error('Payment intent item quantity must be a positive integer.');
  }
  const unitPrice = money('item unit price', item.unitPrice);
  const total = money('item total', item.total);
  const expectedTotal = Number((unitPrice * item.quantity).toFixed(2));
  if (total !== expectedTotal) {
    throw new Error('Payment intent item total does not match quantity x unit price.');
  }

  return {
    productId: required('product id', item.productId),
    name: required('product name', item.name),
    quantity: item.quantity,
    unitPrice,
    total,
    note: item.note?.trim() ?? '',
    image: item.image?.trim() ?? '',
    isService: item.isService === true,
  };
};

const normalizePromotionSnapshot = (
  value: PaymentIntentPromotionSnapshot | null | undefined
): PaymentIntentPromotionSnapshot | null => {
  if (!value) return null;
  if (value.discountType !== 'percentage' && value.discountType !== 'fixed') {
    throw new Error('Payment intent promotion discount type is invalid.');
  }
  if (!Number.isFinite(value.discountValue) || value.discountValue <= 0) {
    throw new Error('Payment intent promotion discount value is invalid.');
  }
  const eligibleProductIds = Array.from(
    new Set(value.eligibleProductIds.map(productId => productId.trim()).filter(Boolean))
  );
  if (!eligibleProductIds.length) {
    throw new Error('Payment intent promotion requires eligible products.');
  }
  return {
    promotionId: required('promotion id', value.promotionId),
    code: required('promotion code', value.code),
    title: required('promotion title', value.title),
    badge: value.badge.trim(),
    discountType: value.discountType,
    discountValue: value.discountValue,
    eligibleProductIds,
  };
};

export const normalizePaymentIntentOrderDraft = (
  draft: PaymentIntentOrderDraft
): PaymentIntentOrderDraft => {
  if (!draft.items.length) throw new Error('Payment intent requires at least one item.');
  const items = draft.items.map(normalizePaymentIntentItem);
  const subtotal = money('subtotal', draft.subtotal);
  const discountTotal = money('discount total', draft.discountTotal ?? 0);
  const deliveryFee = money('delivery fee', draft.deliveryFee);
  const total = money('total', draft.total);
  const expectedSubtotal = Number(
    items.reduce((sum, item) => sum + item.total, 0).toFixed(2)
  );
  const expectedTotal = Number((subtotal - discountTotal + deliveryFee).toFixed(2));
  const promotionSnapshot = normalizePromotionSnapshot(draft.promotionSnapshot);
  const couponCode = draft.couponCode?.trim() ?? '';

  if (subtotal !== expectedSubtotal) {
    throw new Error('Payment intent subtotal does not match item totals.');
  }
  if (discountTotal > subtotal) {
    throw new Error('Payment intent discount cannot exceed subtotal.');
  }
  if (total !== expectedTotal) {
    throw new Error('Payment intent total does not match subtotal - discount + delivery fee.');
  }
  if (discountTotal > 0 && (!promotionSnapshot || !couponCode)) {
    throw new Error('Discounted payment intent requires an immutable promotion snapshot.');
  }
  if (discountTotal === 0 && (promotionSnapshot || couponCode)) {
    throw new Error('Payment intent cannot snapshot a promotion without a discount.');
  }
  if (draft.fulfillmentType === 'delivery' && !draft.deliveryAddress.trim()) {
    throw new Error('Delivery payment intent requires a delivery address.');
  }

  return {
    ...draft,
    draftId: required('order draft id', draft.draftId),
    storeId: required('store id', draft.storeId),
    buyerId: required('buyer id', draft.buyerId),
    buyerName: draft.buyerName.trim(),
    buyerEmail: draft.buyerEmail.trim(),
    deliveryAddress: draft.deliveryAddress.trim(),
    customerNote: draft.customerNote.trim(),
    items,
    subtotal,
    discountTotal,
    couponCode,
    promotionSnapshot,
    deliveryFee,
    total,
  };
};

export const normalizeCanonicalPaymentIntent = (
  intent: CanonicalPaymentIntent
): CanonicalPaymentIntent => {
  const orderDraft = normalizePaymentIntentOrderDraft(intent.orderDraft);
  const amount = money('payment intent amount', intent.amount);
  if (amount <= 0) throw new Error('Payment intent amount must be positive.');
  if (amount !== orderDraft.total) {
    throw new Error('Payment intent amount must equal the immutable order draft total.');
  }
  if (intent.storeId.trim() !== orderDraft.storeId) {
    throw new Error('Payment intent store does not match order draft store.');
  }
  if (intent.buyerId.trim() !== orderDraft.buyerId) {
    throw new Error('Payment intent buyer does not match order draft buyer.');
  }

  return {
    ...intent,
    id: required('payment intent id', intent.id),
    storeId: required('store id', intent.storeId),
    buyerId: required('buyer id', intent.buyerId),
    amount,
    currency: 'BRL',
    provider: intent.provider.trim(),
    providerIntentId: intent.providerIntentId.trim(),
    idempotencyKey: required('payment intent idempotency key', intent.idempotencyKey),
    orderDraft,
    createdAt: intent.createdAt.trim(),
    updatedAt: intent.updatedAt.trim(),
    expiresAt: intent.expiresAt.trim(),
  };
};

export const canMaterializeOperationalOrder = (
  intent: CanonicalPaymentIntent
): boolean => intent.status === 'paid';