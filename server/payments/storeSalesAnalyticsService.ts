import type { DocumentData, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import {
  buildStoreSalesAnalytics,
  type StoreSalesAnalyticsOrder,
  type StoreSalesAnalyticsOrderItem,
  type StoreSalesAnalyticsPayload,
  type StoreSalesAnalyticsPeriod,
  type StoreSalesChannel,
  type StoreSalesFulfillment,
  type StoreSalesOrderStatus,
  type StoreSalesPaymentStatus,
} from '../../shared/storeSalesAnalytics.js';

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const finiteNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const toMinor = (value: unknown): number => {
  const amount = finiteNumber(value);
  return amount === null ? 0 : Math.max(0, Math.round(amount * 100));
};

const timestampIso = (value: unknown): string => {
  const direct = clean(value);
  if (direct && Number.isFinite(Date.parse(direct))) return direct;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  if (value && typeof value === 'object' && 'toDate' in value) {
    try {
      const date = (value as { toDate: () => Date }).toDate();
      return date instanceof Date && !Number.isNaN(date.getTime()) ? date.toISOString() : '';
    } catch {
      return '';
    }
  }
  return '';
};

const canonicalOrderPath = (storeId: string): string => `stores/${storeId}/orders`;
const operationalOrderPath = (storeId: string): string =>
  `artifacts/${storeId}/public/data/customerOrders`;

const normalizeStatus = (value: unknown): StoreSalesOrderStatus | null => {
  const status = clean(value);
  if (
    status === 'pending' ||
    status === 'accepted' ||
    status === 'preparing' ||
    status === 'ready' ||
    status === 'out_for_delivery' ||
    status === 'completed' ||
    status === 'rejected' ||
    status === 'cancelled'
  ) return status;

  if (status === 'processing') return 'preparing';
  if (status === 'shipped') return 'out_for_delivery';
  if (status === 'delivered') return 'completed';
  return null;
};

const normalizePaymentStatus = (value: unknown): StoreSalesPaymentStatus => {
  const status = clean(value);
  return status === 'unpaid' || status === 'partial' || status === 'paid'
    ? status
    : 'unknown';
};

const normalizeFulfillment = (value: unknown): StoreSalesFulfillment => {
  const fulfillment = clean(value);
  return fulfillment === 'delivery' || fulfillment === 'pickup' || fulfillment === 'dine_in'
    ? fulfillment
    : 'unknown';
};

const normalizeChannel = (value: unknown): StoreSalesChannel => {
  const channel = clean(value);
  if (
    channel === 'kyrub' ||
    channel === 'mercado_livre' ||
    channel === '99food' ||
    channel === 'shopee' ||
    channel === 'ifood' ||
    channel === 'instagram' ||
    channel === 'erp' ||
    channel === 'other'
  ) return channel;
  return 'unknown';
};

const parseItem = (value: unknown): StoreSalesAnalyticsOrderItem | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const name = clean(item.name);
  const quantity = finiteNumber(item.quantity);
  const price = finiteNumber(item.price) ?? finiteNumber(item.unitPrice);
  if (!name || quantity === null || quantity <= 0 || price === null || price < 0) return null;

  return {
    productId: clean(item.productId),
    name,
    unitPriceMinor: Math.round(price * 100),
    quantity: Math.max(0, Math.floor(quantity)),
    transferredQuantity: Math.max(0, Math.floor(finiteNumber(item.transferredQuantity) ?? 0)),
    voidedQuantity: Math.max(0, Math.floor(finiteNumber(item.voidedQuantity) ?? 0)),
    discountMinor: toMinor(item.discountAmount),
  };
};

const parseOrder = (
  doc: QueryDocumentSnapshot<DocumentData>,
  storeId: string,
  authority: StoreSalesAnalyticsOrder['authority']
): StoreSalesAnalyticsOrder | null => {
  const data = doc.data() as Record<string, unknown>;
  const orderId = clean(data.id) || doc.id;
  const status = normalizeStatus(data.status);
  const total = finiteNumber(data.total);
  const occurredAt =
    timestampIso(data.legacyCreatedAt) ||
    timestampIso(data.createdAt) ||
    timestampIso(data.legacyUpdatedAt) ||
    timestampIso(data.updatedAt);
  const rawItems = Array.isArray(data.items) ? data.items : [];
  const items = rawItems
    .map(parseItem)
    .filter((item): item is StoreSalesAnalyticsOrderItem => item !== null);

  if (
    !orderId ||
    clean(data.storeId) !== storeId ||
    !status ||
    total === null ||
    total < 0 ||
    !occurredAt ||
    rawItems.length > 0 && items.length === 0
  ) return null;

  return {
    orderId,
    buyerId: clean(data.buyerId),
    buyerName: clean(data.buyerName),
    status,
    paymentStatus: normalizePaymentStatus(data.paymentStatus),
    fulfillmentType: normalizeFulfillment(data.fulfillmentType),
    sourceChannel: normalizeChannel(data.sourceChannel),
    operatorId: clean(data.operatorId),
    operatorName: clean(data.operatorName),
    totalMinor: Math.round(total * 100),
    occurredAt,
    authority,
    items,
  };
};

export const loadStoreSalesAnalytics = async (input: {
  storeId: string;
  period: StoreSalesAnalyticsPeriod;
  now?: Date;
}): Promise<StoreSalesAnalyticsPayload> => {
  const storeId = clean(input.storeId);
  if (!storeId) throw new Error('STORE_SALES_ANALYTICS_STORE_REQUIRED');

  const [operationalSnapshot, canonicalSnapshot] = await Promise.all([
    adminDb.collection(operationalOrderPath(storeId)).get(),
    adminDb.collection(canonicalOrderPath(storeId)).get(),
  ]);

  const byOrderId = new Map<string, StoreSalesAnalyticsOrder>();

  for (const doc of operationalSnapshot.docs) {
    const order = parseOrder(doc, storeId, 'operational');
    if (order) byOrderId.set(order.orderId, order);
  }

  // Canonical store orders are authoritative whenever the same order also exists
  // in the operational projection. Paid marketplace orders that only exist in the
  // operational path remain visible instead of being silently dropped.
  for (const doc of canonicalSnapshot.docs) {
    const order = parseOrder(doc, storeId, 'canonical');
    if (order) byOrderId.set(order.orderId, order);
  }

  return buildStoreSalesAnalytics({
    storeId,
    period: input.period,
    now: input.now,
    orders: Array.from(byOrderId.values()),
  });
};
