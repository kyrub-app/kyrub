import type { PaymentContext, PaymentMethod } from './canonicalPayment';
import type { StorePromotionDiscountType } from './storePromotions';
import { normalizeStorePointsPerUnit } from '../../shared/storePoints';

export type PaymentIntentStatus =
  | 'pending'
  | 'paid'
  | 'failed'
  | 'expired'
  | 'cancelled';

export interface PaymentIntentItem {
  productId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  total: number;
  note?: string;
  image?: string;
  isService?: boolean;
  storePointsPerUnit?: number;
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

export interface MarketplacePaymentIntentTarget {
  kind: 'marketplace_order_draft';
  orderId: string;
}

export interface ExistingOrderPaymentIntentTarget {
  kind: 'existing_order';
  orderId: string;
}

export type PaymentIntentTarget =
  | MarketplacePaymentIntentTarget
  | ExistingOrderPaymentIntentTarget;

/**
 * Persistence/input shape. Historical marketplace intents may not have
 * explicit context/target yet, so both remain optional at this boundary.
 * Normalized code must use NormalizedCanonicalPaymentIntent instead.
 */
export interface CanonicalPaymentIntent {
  id: string;
  storeId: string;
  buyerId: string;
  context?: PaymentContext;
  method: PaymentMethod;
  status: PaymentIntentStatus;
  amount: number;
  currency: 'BRL';
  provider: string;
  providerIntentId: string;
  idempotencyKey: string;
  target?: PaymentIntentTarget;
  orderDraft?: PaymentIntentOrderDraft;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

interface NormalizedPaymentIntentBase {
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
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

export interface MarketplaceCanonicalPaymentIntent
  extends NormalizedPaymentIntentBase {
  context: 'marketplace';
  target: MarketplacePaymentIntentTarget;
  orderDraft: PaymentIntentOrderDraft;
}

export interface ExistingOrderCanonicalPaymentIntent
  extends NormalizedPaymentIntentBase {
  context: 'table' | 'pos';
  target: ExistingOrderPaymentIntentTarget;
  orderDraft?: never;
}

export type NormalizedCanonicalPaymentIntent =
  | MarketplaceCanonicalPaymentIntent
  | ExistingOrderCanonicalPaymentIntent;

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

export const paymentIntentContext = (
  intent: Pick<CanonicalPaymentIntent, 'context'>
): PaymentContext => {
  if (intent.context === undefined) return 'marketplace';
  if (
    intent.context !== 'marketplace' &&
    intent.context !== 'table' &&
    intent.context !== 'pos'
  ) {
    throw new Error('Payment intent context is invalid.');
  }
  return intent.context;
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
    storePointsPerUnit: normalizeStorePointsPerUnit(item.storePointsPerUnit),
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

const normalizeTargetOrderId = (target: PaymentIntentTarget | undefined): string =>
  target ? required('payment intent target order id', target.orderId) : '';

const normalizeBase = (
  intent: CanonicalPaymentIntent,
  amount: number
): NormalizedPaymentIntentBase => ({
  id: required('payment intent id', intent.id),
  storeId: required('store id', intent.storeId),
  buyerId: required('buyer id', intent.buyerId),
  method: intent.method,
  status: intent.status,
  amount,
  currency: 'BRL',
  provider: intent.provider.trim(),
  providerIntentId: intent.providerIntentId.trim(),
  idempotencyKey: required('payment intent idempotency key', intent.idempotencyKey),
  createdAt: intent.createdAt.trim(),
  updatedAt: intent.updatedAt.trim(),
  expiresAt: intent.expiresAt.trim(),
});

export const normalizeCanonicalPaymentIntent = (
  intent: CanonicalPaymentIntent
): NormalizedCanonicalPaymentIntent => {
  const context = paymentIntentContext(intent);
  const amount = money('payment intent amount', intent.amount);
  if (amount <= 0) throw new Error('Payment intent amount must be positive.');
  const base = normalizeBase(intent, amount);

  if (context === 'marketplace') {
    if (!intent.orderDraft) {
      throw new Error('Marketplace payment intent requires an immutable order draft.');
    }
    const orderDraft = normalizePaymentIntentOrderDraft(intent.orderDraft);
    if (amount !== orderDraft.total) {
      throw new Error('Payment intent amount must equal the immutable order draft total.');
    }
    if (base.storeId !== orderDraft.storeId) {
      throw new Error('Payment intent store does not match order draft store.');
    }
    if (base.buyerId !== orderDraft.buyerId) {
      throw new Error('Payment intent buyer does not match order draft buyer.');
    }
    if (intent.target && intent.target.kind !== 'marketplace_order_draft') {
      throw new Error('Marketplace payment intent target is invalid.');
    }
    const targetOrderId = intent.target
      ? normalizeTargetOrderId(intent.target)
      : orderDraft.draftId;
    if (targetOrderId !== orderDraft.draftId) {
      throw new Error('Payment intent target does not match order draft.');
    }
    return {
      ...base,
      context: 'marketplace',
      target: {
        kind: 'marketplace_order_draft',
        orderId: targetOrderId,
      },
      orderDraft,
    };
  }

  if (intent.orderDraft !== undefined) {
    throw new Error('Existing-order payment intent cannot contain a marketplace order draft.');
  }
  if (!intent.target || intent.target.kind !== 'existing_order') {
    throw new Error('Existing-order payment intent target is required.');
  }
  const targetOrderId = normalizeTargetOrderId(intent.target);
  return {
    ...base,
    context,
    target: {
      kind: 'existing_order',
      orderId: targetOrderId,
    },
  };
};

export const isMarketplacePaymentIntent = (
  intent: NormalizedCanonicalPaymentIntent
): intent is MarketplaceCanonicalPaymentIntent => intent.context === 'marketplace';

export const assertMarketplacePaymentIntent = (
  intent: NormalizedCanonicalPaymentIntent
): asserts intent is MarketplaceCanonicalPaymentIntent => {
  if (!isMarketplacePaymentIntent(intent)) {
    throw new Error('Marketplace payment intent required.');
  }
};

export const canMaterializeOperationalOrder = (
  intent: NormalizedCanonicalPaymentIntent
): boolean => intent.context === 'marketplace' && intent.status === 'paid';
