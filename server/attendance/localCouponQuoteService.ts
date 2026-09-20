import type { DocumentData } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import { resolveStorePromotionForCheckout } from '../payments/storePromotionService.js';
import { normalizePromotionCode } from '../../src/utils/storePromotions.js';
import { resolveInPersonOrderStoreContext } from './inPersonOrderService.js';
import { summarizeLocalOrderPayable } from './localOrderPayable.js';

const clean = (value: unknown, max = 220): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

const finite = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const positiveQuantity = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;

export interface LocalCouponQuoteResult {
  orderId: string;
  couponCode: string;
  promotionId: string;
  title: string;
  badge: string;
  subtotal: number;
  discountTotal: number;
  total: number;
}

export const quoteLocalOrderCoupon = async (input: {
  legacyStoreId: string;
  orderId: string;
  couponCode: string;
}): Promise<LocalCouponQuoteResult> => {
  const orderId = clean(input.orderId);
  const couponCode = normalizePromotionCode(input.couponCode);
  if (!orderId || !couponCode) throw new Error('LOCAL_COUPON_QUOTE_REQUIRED');

  const storeContext = await resolveInPersonOrderStoreContext(input.legacyStoreId);
  const snapshot = await adminDb.doc(
    `stores/${storeContext.canonicalStoreId}/orders/${orderId}`
  ).get();
  if (!snapshot.exists) throw new Error('LOCAL_COUPON_ORDER_NOT_FOUND');
  const order = snapshot.data() as DocumentData;
  if (clean(order.id) !== orderId || order.fulfillmentType !== 'dine_in') {
    throw new Error('LOCAL_COUPON_ORDER_NOT_ELIGIBLE');
  }
  if (order.status === 'rejected' || order.status === 'cancelled') {
    throw new Error('LOCAL_COUPON_ORDER_NOT_ELIGIBLE');
  }
  const buyerId = clean(order.buyerId);
  if (!buyerId || buyerId.startsWith('local-order:')) {
    throw new Error('LOCAL_COUPON_CUSTOMER_IDENTIFICATION_REQUIRED');
  }

  const payable = summarizeLocalOrderPayable(order);
  if (payable.hasOperationalPaidQuantity) {
    throw new Error('LOCAL_COUPON_RECONCILIATION_REQUIRED');
  }

  if (!Array.isArray(order.items) || order.items.length === 0) {
    throw new Error('LOCAL_COUPON_ORDER_ITEMS_INVALID');
  }
  const lines = order.items.map((candidate: unknown) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new Error('LOCAL_COUPON_ORDER_ITEMS_INVALID');
    }
    const item = candidate as Record<string, unknown>;
    const productId = clean(item.productId ?? item.id);
    const unitPrice = finite(item.price);
    const ordered = positiveQuantity(item.quantity);
    const transferred = typeof item.transferredQuantity === 'number' && Number.isSafeInteger(item.transferredQuantity)
      ? item.transferredQuantity
      : 0;
    const quantity = ordered === null ? null : ordered - transferred;
    if (!productId || unitPrice === null || unitPrice < 0 || quantity === null || quantity <= 0) {
      throw new Error('LOCAL_COUPON_ORDER_ITEMS_INVALID');
    }
    return { productId, unitPrice, quantity };
  });

  const resolved = await resolveStorePromotionForCheckout({
    storeId: storeContext.canonicalStoreId,
    buyerId,
    couponCode,
    lines,
  });
  if (resolved.quote.discountTotal <= 0) {
    throw new Error('LOCAL_COUPON_NO_DISCOUNT');
  }

  const subtotal = Number(payable.billableAmount.toFixed(2));
  const discountTotal = Number(resolved.quote.discountTotal.toFixed(2));
  const total = Number((subtotal - discountTotal).toFixed(2));
  if (total <= 0) throw new Error('LOCAL_COUPON_TOTAL_INVALID');

  return {
    orderId,
    couponCode: resolved.promotion.code,
    promotionId: resolved.promotion.id,
    title: resolved.promotion.title,
    badge: resolved.promotion.badge,
    subtotal,
    discountTotal,
    total,
  };
};
