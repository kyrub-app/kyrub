import type { DocumentData, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const finiteIso = (value: unknown): string => {
  const normalized = clean(value);
  return normalized && Number.isFinite(Date.parse(normalized)) ? normalized : '';
};

const timestampIso = (value: unknown): string => {
  const direct = finiteIso(value);
  if (direct) return direct;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  if (value && typeof value === 'object' && 'toDate' in value) {
    try {
      const date = (value as { toDate: () => Date }).toDate();
      return date instanceof Date && !Number.isNaN(date.getTime())
        ? date.toISOString()
        : '';
    } catch {
      return '';
    }
  }
  return '';
};

const ORDER_STATUSES = new Set([
  'pending',
  'accepted',
  'preparing',
  'ready',
  'out_for_delivery',
  'completed',
  'rejected',
  'cancelled',
]);

const canonicalOrderPath = (storeId: string): string => `stores/${storeId}/orders`;
const operationalOrderPath = (storeId: string): string =>
  `artifacts/${storeId}/public/data/customerOrders`;
const crmCustomerPath = (storeId: string): string =>
  `stores/${storeId}/crmCustomers`;

interface PersistedCrmOrder {
  orderId: string;
  customerId: string;
  buyerName: string;
  buyerEmail: string;
  occurredAt: string;
}

const parseOrderData = (
  data: Record<string, unknown>,
  documentId: string,
  storeId: string
): PersistedCrmOrder | null => {
  const orderId = clean(data.id) || documentId;
  const customerId = clean(data.buyerId);
  const buyerName = clean(data.buyerName);
  const buyerEmail = clean(data.buyerEmail);
  const source = clean(data.source) || 'customer';
  const status = clean(data.status);
  const occurredAt =
    timestampIso(data.legacyCreatedAt) ||
    timestampIso(data.createdAt) ||
    timestampIso(data.legacyUpdatedAt) ||
    timestampIso(data.updatedAt);

  if (
    !orderId ||
    clean(data.storeId) !== storeId ||
    !customerId ||
    customerId.startsWith('local-order:') ||
    !buyerName ||
    !buyerEmail ||
    source !== 'customer' ||
    !ORDER_STATUSES.has(status) ||
    !Array.isArray(data.items) ||
    data.items.length === 0 ||
    !occurredAt
  ) {
    return null;
  }

  return { orderId, customerId, buyerName, buyerEmail, occurredAt };
};

const parseOrderDocument = (
  doc: QueryDocumentSnapshot<DocumentData>,
  storeId: string
): PersistedCrmOrder | null =>
  parseOrderData(doc.data() as Record<string, unknown>, doc.id, storeId);

const defaultMarketingConsent = () => ({
  whatsapp: { status: 'unknown' as const },
  email: { status: 'unknown' as const },
  sms: { status: 'unknown' as const },
});

const dedupeOrders = (orders: PersistedCrmOrder[]): PersistedCrmOrder[] => {
  const byOrderId = new Map<string, PersistedCrmOrder>();
  for (const order of orders) {
    const existing = byOrderId.get(order.orderId);
    if (!existing || order.occurredAt >= existing.occurredAt) {
      byOrderId.set(order.orderId, order);
    }
  }
  return Array.from(byOrderId.values()).sort((left, right) =>
    left.occurredAt.localeCompare(right.occurredAt) ||
    left.orderId.localeCompare(right.orderId)
  );
};

const loadOrdersForBuyer = async (
  storeId: string,
  customerId: string
): Promise<PersistedCrmOrder[]> => {
  const [canonical, operational] = await Promise.all([
    adminDb.collection(canonicalOrderPath(storeId)).where('buyerId', '==', customerId).get(),
    adminDb.collection(operationalOrderPath(storeId)).where('buyerId', '==', customerId).get(),
  ]);
  return dedupeOrders([
    ...canonical.docs.map(doc => parseOrderDocument(doc, storeId)).filter((order): order is PersistedCrmOrder => order !== null),
    ...operational.docs.map(doc => parseOrderDocument(doc, storeId)).filter((order): order is PersistedCrmOrder => order !== null),
  ]);
};

const loadTargetOrder = async (
  storeId: string,
  orderId: string
): Promise<PersistedCrmOrder | null> => {
  const [canonical, operational] = await Promise.all([
    adminDb.doc(`${canonicalOrderPath(storeId)}/${orderId}`).get(),
    adminDb.doc(`${operationalOrderPath(storeId)}/${orderId}`).get(),
  ]);
  const canonicalOrder = canonical.exists
    ? parseOrderData(canonical.data() as Record<string, unknown>, canonical.id, storeId)
    : null;
  if (canonicalOrder) return canonicalOrder;
  return operational.exists
    ? parseOrderData(operational.data() as Record<string, unknown>, operational.id, storeId)
    : null;
};

const writeCustomerAggregate = async (input: {
  storeId: string;
  customerId: string;
  orders: PersistedCrmOrder[];
  now?: Date;
}): Promise<{ customerId: string; orderCount: number }> => {
  const orders = dedupeOrders(input.orders);
  if (orders.length === 0) throw new Error('STORE_CRM_ORDER_INVALID');
  const first = orders[0];
  const last = orders.at(-1) ?? first;
  const now = input.now ?? new Date();
  if (Number.isNaN(now.getTime())) throw new Error('STORE_CRM_NOW_INVALID');
  const nowIso = now.toISOString();
  const reference = adminDb.doc(
    `${crmCustomerPath(input.storeId)}/${input.customerId}`
  );
  const existing = await reference.get();

  await reference.set({
    schemaVersion: 1,
    storeId: input.storeId,
    customerId: input.customerId,
    orderIdentity: {
      displayName: last.buyerName || first.buyerName,
      email: last.buyerEmail || first.buyerEmail,
    },
    orderStats: {
      firstOrderId: first.orderId,
      firstOrderAt: first.occurredAt,
      lastOrderId: last.orderId,
      lastOrderAt: last.occurredAt,
      orderCount: orders.length,
    },
    ...(existing.exists
      ? {}
      : {
          marketingConsent: defaultMarketingConsent(),
          createdAt: nowIso,
        }),
    updatedAt: nowIso,
  }, { merge: true });

  return { customerId: input.customerId, orderCount: orders.length };
};

export const syncCanonicalOrderCustomerIntoCrm = async (input: {
  storeId: string;
  orderId: string;
  authenticatedBuyerId: string;
  now?: Date;
}): Promise<{ customerId: string; orderCount: number }> => {
  const storeId = clean(input.storeId);
  const orderId = clean(input.orderId);
  const authenticatedBuyerId = clean(input.authenticatedBuyerId);
  if (!storeId) throw new Error('STORE_CRM_STORE_REQUIRED');
  if (!orderId) throw new Error('STORE_CRM_ORDER_REQUIRED');
  if (!authenticatedBuyerId) throw new Error('STORE_CRM_BUYER_REQUIRED');

  const targetOrder = await loadTargetOrder(storeId, orderId);
  if (!targetOrder) throw new Error('STORE_CRM_ORDER_NOT_FOUND');
  if (targetOrder.customerId !== authenticatedBuyerId) {
    throw new Error('STORE_CRM_ORDER_BUYER_FORBIDDEN');
  }

  const orders = await loadOrdersForBuyer(storeId, authenticatedBuyerId);
  if (!orders.some(order => order.orderId === orderId)) {
    throw new Error('STORE_CRM_ORDER_INVALID');
  }
  return writeCustomerAggregate({
    storeId,
    customerId: authenticatedBuyerId,
    orders,
    now: input.now,
  });
};

export const syncPersistedCustomerOrderIntoCrm = async (input: {
  storeId: string;
  orderId: string;
  now?: Date;
}): Promise<{ customerId: string; orderCount: number }> => {
  const storeId = clean(input.storeId);
  const orderId = clean(input.orderId);
  if (!storeId) throw new Error('STORE_CRM_STORE_REQUIRED');
  if (!orderId) throw new Error('STORE_CRM_ORDER_REQUIRED');
  const targetOrder = await loadTargetOrder(storeId, orderId);
  if (!targetOrder) throw new Error('STORE_CRM_ORDER_NOT_FOUND');
  const orders = await loadOrdersForBuyer(storeId, targetOrder.customerId);
  return writeCustomerAggregate({
    storeId,
    customerId: targetOrder.customerId,
    orders,
    now: input.now,
  });
};

export const reconcilePersistedCustomerOrdersIntoCrm = async (input: {
  storeId: string;
  now?: Date;
}): Promise<number> => {
  const storeId = clean(input.storeId);
  if (!storeId) throw new Error('STORE_CRM_STORE_REQUIRED');
  const [canonical, operational] = await Promise.all([
    adminDb.collection(canonicalOrderPath(storeId)).get(),
    adminDb.collection(operationalOrderPath(storeId)).get(),
  ]);
  const orders = dedupeOrders([
    ...canonical.docs.map(doc => parseOrderDocument(doc, storeId)).filter((order): order is PersistedCrmOrder => order !== null),
    ...operational.docs.map(doc => parseOrderDocument(doc, storeId)).filter((order): order is PersistedCrmOrder => order !== null),
  ]);
  const byCustomer = new Map<string, PersistedCrmOrder[]>();
  for (const order of orders) {
    const current = byCustomer.get(order.customerId) ?? [];
    current.push(order);
    byCustomer.set(order.customerId, current);
  }
  for (const [customerId, customerOrders] of byCustomer) {
    await writeCustomerAggregate({
      storeId,
      customerId,
      orders: customerOrders,
      now: input.now,
    });
  }
  return byCustomer.size;
};
