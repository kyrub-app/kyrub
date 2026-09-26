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
const ORDER_SOURCES = new Set(['customer', 'staff', 'transfer']);

const orderPath = (storeId: string): string => `stores/${storeId}/orders`;
const crmCustomerPath = (storeId: string): string =>
  `stores/${storeId}/crmCustomers`;

interface CanonicalCrmOrder {
  orderId: string;
  customerId: string;
  buyerName: string;
  buyerEmail: string;
  occurredAt: string;
  source: string;
}

const parseCanonicalOrder = (
  doc: QueryDocumentSnapshot<DocumentData>,
  storeId: string
): CanonicalCrmOrder | null => {
  const data = doc.data() as Record<string, unknown>;
  const orderId = clean(data.id) || doc.id;
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
    !ORDER_SOURCES.has(source) ||
    !ORDER_STATUSES.has(status) ||
    !Array.isArray(data.items) ||
    data.items.length === 0 ||
    !occurredAt ||
    (source === 'customer' && !buyerEmail)
  ) {
    return null;
  }

  return {
    orderId,
    customerId,
    buyerName,
    buyerEmail,
    occurredAt,
    source,
  };
};

const defaultMarketingConsent = () => ({
  whatsapp: { status: 'unknown' as const },
  email: { status: 'unknown' as const },
  sms: { status: 'unknown' as const },
});

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

  const targetReference = adminDb.doc(`${orderPath(storeId)}/${orderId}`);
  const targetSnapshot = await targetReference.get();
  if (!targetSnapshot.exists) throw new Error('STORE_CRM_ORDER_NOT_FOUND');

  const targetData = targetSnapshot.data() as Record<string, unknown> | undefined;
  const targetBuyerId = clean(targetData?.buyerId);
  if (!targetBuyerId || targetBuyerId !== authenticatedBuyerId) {
    throw new Error('STORE_CRM_ORDER_BUYER_FORBIDDEN');
  }
  if ((clean(targetData?.source) || 'customer') !== 'customer') {
    throw new Error('STORE_CRM_ORDER_SOURCE_FORBIDDEN');
  }

  const orderSnapshot = await adminDb
    .collection(orderPath(storeId))
    .where('buyerId', '==', authenticatedBuyerId)
    .get();
  const orders = orderSnapshot.docs
    .map(doc => parseCanonicalOrder(doc, storeId))
    .filter((order): order is CanonicalCrmOrder => order !== null)
    .sort((left, right) =>
      left.occurredAt.localeCompare(right.occurredAt) ||
      left.orderId.localeCompare(right.orderId)
    );

  const targetOrder = orders.find(order => order.orderId === orderId);
  if (!targetOrder) throw new Error('STORE_CRM_ORDER_INVALID');

  const first = orders[0];
  const last = orders.at(-1) ?? first;
  const now = input.now ?? new Date();
  if (Number.isNaN(now.getTime())) throw new Error('STORE_CRM_NOW_INVALID');
  const nowIso = now.toISOString();
  const crmReference = adminDb.doc(
    `${crmCustomerPath(storeId)}/${authenticatedBuyerId}`
  );
  const existingCrmCustomer = await crmReference.get();

  await crmReference.set({
    schemaVersion: 1,
    storeId,
    customerId: authenticatedBuyerId,
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
    ...(existingCrmCustomer.exists
      ? {}
      : {
          marketingConsent: defaultMarketingConsent(),
          createdAt: nowIso,
        }),
    updatedAt: nowIso,
  }, { merge: true });

  return {
    customerId: authenticatedBuyerId,
    orderCount: orders.length,
  };
};
