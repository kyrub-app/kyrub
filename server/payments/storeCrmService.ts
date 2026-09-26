import type { DocumentData, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import { deriveStorePointBalance, STORE_POINTS_CURRENCY, type StorePointLedgerEntry } from '../../shared/storePoints.js';
import { isPaymentAuthoritativelyPaid, type CanonicalPayment } from '../../src/utils/canonicalPayment.js';
import { STORE_CRM_MAX_CUSTOMERS, STORE_CRM_SCHEMA_VERSION, buildStoreCrmCustomerSummary, type StoreCrmSummary } from '../../shared/storeCrm.js';
import type { StoreChallengeProgress } from '../../shared/storeChallenges.js';
import { classifyCompatiblePaymentRecord } from './paymentRecordCompatibility.js';

const clean = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
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
      return date instanceof Date && !Number.isNaN(date.getTime()) ? date.toISOString() : '';
    } catch {
      return '';
    }
  }
  return '';
};
const isResolvedCustomerId = (value: unknown): value is string => {
  const customerId = clean(value);
  return Boolean(customerId) && !customerId.startsWith('local-order:');
};

const ledgerPath = (storeId: string) => `stores/${storeId}/storePointLedger`;
const paymentPath = (storeId: string) => `stores/${storeId}/payments`;
const challengePath = (storeId: string) => `stores/${storeId}/challengeProgress`;
const redemptionPath = (storeId: string) => `stores/${storeId}/rewardRedemptions`;
const relationshipPath = (storeId: string) => `stores/${storeId}/customerRelationships`;
const orderPath = (storeId: string) => `stores/${storeId}/orders`;
const crmCustomerPath = (storeId: string) => `stores/${storeId}/crmCustomers`;

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

interface CanonicalCrmOrder {
  orderId: string;
  customerId: string;
  buyerName: string;
  buyerEmail: string;
  occurredAt: string;
}

interface MaterializedCrmCustomer {
  customerId: string;
  displayName: string;
  email: string;
  firstOrderId: string;
  firstOrderAt: string;
  lastOrderId: string;
  lastOrderAt: string;
  orderCount: number;
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
    !isResolvedCustomerId(customerId) ||
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
  };
};

const materializeCanonicalOrders = (
  docs: QueryDocumentSnapshot<DocumentData>[],
  storeId: string
): Map<string, MaterializedCrmCustomer> => {
  const ordersByCustomer = new Map<string, CanonicalCrmOrder[]>();

  for (const doc of docs) {
    const order = parseCanonicalOrder(doc, storeId);
    if (!order) continue;
    const orders = ordersByCustomer.get(order.customerId) ?? [];
    orders.push(order);
    ordersByCustomer.set(order.customerId, orders);
  }

  return new Map(
    Array.from(ordersByCustomer.entries()).map(([customerId, orders]) => {
      const sorted = [...orders].sort((left, right) =>
        left.occurredAt.localeCompare(right.occurredAt) ||
        left.orderId.localeCompare(right.orderId)
      );
      const first = sorted[0];
      const last = sorted.at(-1) ?? first;
      return [customerId, {
        customerId,
        displayName: last.buyerName || first.buyerName,
        email: last.buyerEmail || first.buyerEmail,
        firstOrderId: first.orderId,
        firstOrderAt: first.occurredAt,
        lastOrderId: last.orderId,
        lastOrderAt: last.occurredAt,
        orderCount: sorted.length,
      } satisfies MaterializedCrmCustomer];
    })
  );
};

const defaultMarketingConsent = () => ({
  whatsapp: { status: 'unknown' as const },
  email: { status: 'unknown' as const },
  sms: { status: 'unknown' as const },
});

const reconcileCanonicalOrdersIntoCrm = async (input: {
  storeId: string;
  customers: Map<string, MaterializedCrmCustomer>;
  existingCustomerIds: Set<string>;
  nowIso: string;
}): Promise<void> => {
  const entries = Array.from(input.customers.values());
  const batchSize = 400;

  for (let offset = 0; offset < entries.length; offset += batchSize) {
    const batch = adminDb.batch();
    for (const customer of entries.slice(offset, offset + batchSize)) {
      const exists = input.existingCustomerIds.has(customer.customerId);
      const reference = adminDb.doc(
        `${crmCustomerPath(input.storeId)}/${customer.customerId}`
      );
      batch.set(reference, {
        schemaVersion: 1,
        storeId: input.storeId,
        customerId: customer.customerId,
        orderIdentity: {
          displayName: customer.displayName,
          email: customer.email,
        },
        orderStats: {
          firstOrderId: customer.firstOrderId,
          firstOrderAt: customer.firstOrderAt,
          lastOrderId: customer.lastOrderId,
          lastOrderAt: customer.lastOrderAt,
          orderCount: customer.orderCount,
        },
        ...(exists ? {} : {
          marketingConsent: defaultMarketingConsent(),
          createdAt: input.nowIso,
        }),
        updatedAt: input.nowIso,
      }, { merge: true });
    }
    await batch.commit();
  }
};

const parsePersistedCrmCustomer = (
  doc: QueryDocumentSnapshot<DocumentData>,
  storeId: string
): { customerId: string; displayName: string; lastOrderAt: string } | null => {
  const data = doc.data() as Record<string, unknown>;
  const customerId = clean(data.customerId) || doc.id;
  if (!isResolvedCustomerId(customerId) || clean(data.storeId) !== storeId) return null;
  const orderIdentity = data.orderIdentity && typeof data.orderIdentity === 'object'
    ? data.orderIdentity as Record<string, unknown>
    : {};
  const orderStats = data.orderStats && typeof data.orderStats === 'object'
    ? data.orderStats as Record<string, unknown>
    : {};
  return {
    customerId,
    displayName: clean(orderIdentity.displayName),
    lastOrderAt: timestampIso(orderStats.lastOrderAt),
  };
};

const parsePayment = (
  doc: QueryDocumentSnapshot<DocumentData>,
  storeId: string
): CanonicalPayment | null => {
  const classified = classifyCompatiblePaymentRecord(doc.data(), storeId);
  return classified.kind === 'canonical' ? classified.payment : null;
};

const parseLedger = (doc: QueryDocumentSnapshot<DocumentData>, storeId: string): StorePointLedgerEntry => {
  const entry = doc.data() as Partial<StorePointLedgerEntry>;
  if (
    entry.schemaVersion !== 1 ||
    entry.storeId !== storeId ||
    entry.currency !== STORE_POINTS_CURRENCY ||
    !clean(entry.customerId) ||
    !Number.isSafeInteger(entry.amount) ||
    !finiteIso(entry.occurredAt)
  ) throw new Error('STORE_CRM_LEDGER_INVALID');
  return entry as StorePointLedgerEntry;
};

const parseRelationship = (
  doc: QueryDocumentSnapshot<DocumentData>,
  storeId: string
): { customerId: string; lastActivityAt: string } | null => {
  const data = doc.data() as Record<string, unknown>;
  const customerId = clean(data.customerId);
  if (
    data.schemaVersion !== 1 ||
    clean(data.storeId) !== storeId ||
    data.status !== 'active' ||
    !isResolvedCustomerId(customerId)
  ) {
    return null;
  }
  return {
    customerId,
    lastActivityAt:
      finiteIso(data.lastSeenAt) ||
      finiteIso(data.firstSeenAt) ||
      finiteIso(data.updatedAt) ||
      finiteIso(data.createdAt),
  };
};

export const loadStoreCrmSummary = async (input: { storeId: string; now?: Date }): Promise<StoreCrmSummary> => {
  const storeId = clean(input.storeId);
  if (!storeId) throw new Error('STORE_CRM_STORE_REQUIRED');
  const now = input.now ?? new Date();
  if (Number.isNaN(now.getTime())) throw new Error('STORE_CRM_NOW_INVALID');
  const nowIso = now.toISOString();

  const [
    orderSnapshot,
    crmCustomerSnapshot,
    paymentSnapshot,
    ledgerSnapshot,
    challengeSnapshot,
    redemptionSnapshot,
    relationshipSnapshot,
  ] = await Promise.all([
    adminDb.collection(orderPath(storeId)).get(),
    adminDb.collection(crmCustomerPath(storeId)).get(),
    adminDb.collection(paymentPath(storeId)).get(),
    adminDb.collection(ledgerPath(storeId)).get(),
    adminDb.collection(challengePath(storeId)).get(),
    adminDb.collection(redemptionPath(storeId)).get(),
    adminDb.collection(relationshipPath(storeId)).get(),
  ]);

  const materializedCustomers = materializeCanonicalOrders(orderSnapshot.docs, storeId);
  const existingCrmCustomerIds = new Set<string>();
  const persistedCrmIdentity = new Map<string, string>();
  const persistedCrmActivity = new Map<string, string>();

  for (const doc of crmCustomerSnapshot.docs) {
    const customer = parsePersistedCrmCustomer(doc, storeId);
    if (!customer) continue;
    existingCrmCustomerIds.add(customer.customerId);
    persistedCrmIdentity.set(customer.customerId, customer.displayName);
    persistedCrmActivity.set(customer.customerId, customer.lastOrderAt);
  }

  await reconcileCanonicalOrdersIntoCrm({
    storeId,
    customers: materializedCustomers,
    existingCustomerIds: existingCrmCustomerIds,
    nowIso,
  });

  const customerIds = new Set<string>(existingCrmCustomerIds);
  const orderIdentity = new Map<string, string>(persistedCrmIdentity);
  const orderActivity = new Map<string, string>(persistedCrmActivity);
  for (const customer of materializedCustomers.values()) {
    customerIds.add(customer.customerId);
    orderIdentity.set(customer.customerId, customer.displayName);
    orderActivity.set(customer.customerId, customer.lastOrderAt);
  }

  const relationshipActivity = new Map<string, string>();
  for (const doc of relationshipSnapshot.docs) {
    const relationship = parseRelationship(doc, storeId);
    if (!relationship) continue;
    customerIds.add(relationship.customerId);
    relationshipActivity.set(
      relationship.customerId,
      relationship.lastActivityAt
    );
  }

  const paidByCustomer = new Map<string, CanonicalPayment[]>();
  for (const doc of paymentSnapshot.docs) {
    const payment = parsePayment(doc, storeId);
    if (!payment) continue;
    if (!isResolvedCustomerId(payment.buyerId)) continue;
    customerIds.add(payment.buyerId);
    if (!isPaymentAuthoritativelyPaid(payment.status)) continue;
    const list = paidByCustomer.get(payment.buyerId) ?? [];
    list.push(payment);
    paidByCustomer.set(payment.buyerId, list);
  }

  const ledgerByCustomer = new Map<string, StorePointLedgerEntry[]>();
  for (const doc of ledgerSnapshot.docs) {
    const entry = parseLedger(doc, storeId);
    if (!isResolvedCustomerId(entry.customerId)) continue;
    customerIds.add(entry.customerId);
    const list = ledgerByCustomer.get(entry.customerId) ?? [];
    list.push(entry);
    ledgerByCustomer.set(entry.customerId, list);
  }

  const challengeCounts = new Map<string, { active: number; completed: number }>();
  for (const doc of challengeSnapshot.docs) {
    const progress = doc.data() as Partial<StoreChallengeProgress>;
    if (
      progress.storeId !== storeId ||
      !isResolvedCustomerId(progress.customerId)
    ) continue;
    customerIds.add(progress.customerId);
    const current = challengeCounts.get(progress.customerId) ?? { active: 0, completed: 0 };
    if (progress.status === 'completed') current.completed += 1;
    else current.active += 1;
    challengeCounts.set(progress.customerId, current);
  }

  const redemptions = new Map<string, number>();
  for (const doc of redemptionSnapshot.docs) {
    const data = doc.data() as Record<string, unknown>;
    const customerId = clean(data.customerId);
    if (!isResolvedCustomerId(customerId) || clean(data.storeId) !== storeId) continue;
    customerIds.add(customerId);
    redemptions.set(customerId, (redemptions.get(customerId) ?? 0) + 1);
  }

  const ids = Array.from(customerIds).slice(0, STORE_CRM_MAX_CUSTOMERS);
  const profileRefs = ids.map(customerId => adminDb.doc(`users/${customerId}`));
  const profileSnapshots = profileRefs.length ? await adminDb.getAll(...profileRefs) : [];
  const profileById = new Map(profileSnapshots.map(snapshot => [snapshot.id, snapshot.data() as Record<string, unknown> | undefined]));

  const customers = ids.map(customerId => {
    const paid = paidByCustomer.get(customerId) ?? [];
    const ledger = ledgerByCustomer.get(customerId) ?? [];
    const profile = profileById.get(customerId);
    const lastPaymentAt = paid.reduce((latest, payment) => {
      const value = payment.paidAt || payment.updatedAt || payment.createdAt;
      return value > latest ? value : latest;
    }, '');
    const lastLedgerAt = ledger.reduce((latest, entry) => entry.occurredAt > latest ? entry.occurredAt : latest, '');
    const lastRelationshipAt = relationshipActivity.get(customerId) ?? '';
    const lastOrderAt = orderActivity.get(customerId) ?? '';
    const lastActivityAt = [lastPaymentAt, lastLedgerAt, lastRelationshipAt, lastOrderAt]
      .sort()
      .at(-1) ?? '';
    const challenge = challengeCounts.get(customerId) ?? { active: 0, completed: 0 };

    return buildStoreCrmCustomerSummary({
      customerId,
      displayName:
        clean(profile?.displayName) ||
        clean(profile?.name) ||
        orderIdentity.get(customerId) ||
        `Cliente ${customerId.slice(0, 6)}`,
      photoUrl: clean(profile?.photoURL) || clean(profile?.photoUrl),
      confirmedPurchases: paid.length,
      confirmedSpentMinor: paid.reduce((sum, payment) => sum + Math.round(payment.amount * 100), 0),
      lastActivityAt,
      pointsBalance: deriveStorePointBalance(ledger),
      activeChallenges: challenge.active,
      completedChallenges: challenge.completed,
      rewardRedemptions: redemptions.get(customerId) ?? 0,
    });
  }).sort((left, right) =>
    right.confirmedPurchases - left.confirmedPurchases ||
    right.pointsBalance - left.pointsBalance ||
    right.lastActivityAt.localeCompare(left.lastActivityAt)
  );

  return {
    schemaVersion: STORE_CRM_SCHEMA_VERSION,
    storeId,
    generatedAt: nowIso,
    customerCount: customers.length,
    customers,
  };
};
