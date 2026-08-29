import type {
  DocumentData,
  QueryDocumentSnapshot,
} from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import {
  STORE_POINTS_CURRENCY,
  deriveStorePointBalance,
  type StorePointLedgerEntry,
} from '../../shared/storePoints.js';
import {
  isStoreRewardAvailableAt,
  normalizeStoreRewardDefinitions,
} from '../../shared/storeRewards.js';
import {
  STORE_CRM_SCHEMA_VERSION,
  deriveStoreCrmSegments,
  type StoreCrmCustomer,
  type StoreCrmSummary,
} from '../../shared/storeCrm.js';
import { deriveStoreRelationshipLevel } from '../../shared/storeRelationship.js';
import {
  isPaymentAuthoritativelyPaid,
  normalizeCanonicalPayment,
  type CanonicalPayment,
} from '../../src/utils/canonicalPayment.js';

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const finiteIso = (value: unknown): string => {
  const normalized = clean(value);
  return normalized && Number.isFinite(Date.parse(normalized)) ? normalized : '';
};

const latestIso = (...values: string[]): string =>
  values
    .filter(value => value && Number.isFinite(Date.parse(value)))
    .sort((left, right) => right.localeCompare(left))[0] ?? '';

const money = (value: number): number => Number(value.toFixed(2));

const paymentCollectionPath = (storeId: string): string =>
  `stores/${storeId}/payments`;

const ledgerCollectionPath = (storeId: string): string =>
  `stores/${storeId}/storePointLedger`;

const challengeProgressCollectionPath = (storeId: string): string =>
  `stores/${storeId}/challengeProgress`;

const rewardRedemptionCollectionPath = (storeId: string): string =>
  `stores/${storeId}/rewardRedemptions`;

const orderCollectionPath = (storeId: string): string =>
  `stores/${storeId}/orders`;

interface CrmChallengeProgress {
  customerId: string;
  progress: number;
  status: 'in_progress' | 'completed';
  completedAt: string;
}

interface CrmRewardRedemption {
  customerId: string;
  rewardId: string;
  voucherPromotionId: string;
  redeemedAt: string;
}

interface CrmOrderIdentity {
  customerId: string;
  name: string;
  email: string;
  updatedAt: string;
}

interface CrmUserProfile {
  name: string;
  email: string;
  avatarUrl: string;
}

const groupByCustomer = <T extends { customerId: string }>(
  values: readonly T[]
): Map<string, T[]> => {
  const grouped = new Map<string, T[]>();
  for (const value of values) {
    const current = grouped.get(value.customerId) ?? [];
    current.push(value);
    grouped.set(value.customerId, current);
  }
  return grouped;
};

const parsePayments = (
  docs: readonly QueryDocumentSnapshot<DocumentData>[],
  storeId: string
): CanonicalPayment[] =>
  docs.map(document => {
    let payment: CanonicalPayment;
    try {
      payment = normalizeCanonicalPayment(document.data() as CanonicalPayment);
    } catch {
      throw new Error('STORE_CRM_PAYMENT_INVALID');
    }
    if (payment.storeId !== storeId) {
      throw new Error('STORE_CRM_PAYMENT_SCOPE_INVALID');
    }
    return payment;
  });

const parseLedgerEntries = (
  docs: readonly QueryDocumentSnapshot<DocumentData>[],
  storeId: string
): StorePointLedgerEntry[] =>
  docs.map(document => {
    const entry = document.data() as Partial<StorePointLedgerEntry>;
    if (
      entry.schemaVersion !== 1 ||
      entry.currency !== STORE_POINTS_CURRENCY ||
      entry.storeId !== storeId ||
      !clean(entry.customerId) ||
      !clean(entry.id) ||
      !Number.isSafeInteger(entry.amount) ||
      !finiteIso(entry.occurredAt) ||
      (entry.kind !== 'purchase_base' &&
        entry.kind !== 'bonus' &&
        entry.kind !== 'redemption' &&
        entry.kind !== 'reversal')
    ) {
      throw new Error('STORE_CRM_LEDGER_INVALID');
    }
    return entry as StorePointLedgerEntry;
  });

const parseChallengeProgress = (
  docs: readonly QueryDocumentSnapshot<DocumentData>[],
  storeId: string
): CrmChallengeProgress[] =>
  docs.flatMap(document => {
    const value = document.data() as Record<string, unknown>;
    const customerId = clean(value.customerId);
    const progress = Number(value.progress);
    const status = value.status;
    if (
      value.storeId !== storeId ||
      !customerId ||
      !Number.isSafeInteger(progress) ||
      progress < 0 ||
      (status !== 'in_progress' && status !== 'completed')
    ) {
      return [];
    }
    return [{
      customerId,
      progress,
      status,
      completedAt: finiteIso(value.completedAt),
    } satisfies CrmChallengeProgress];
  });

const parseRewardRedemptions = (
  docs: readonly QueryDocumentSnapshot<DocumentData>[],
  storeId: string
): CrmRewardRedemption[] =>
  docs.flatMap(document => {
    const value = document.data() as Record<string, unknown>;
    const customerId = clean(value.customerId);
    const rewardId = clean(value.rewardId);
    const voucherPromotionId = clean(value.voucherPromotionId);
    if (value.storeId !== storeId || !customerId || !rewardId) return [];
    return [{
      customerId,
      rewardId,
      voucherPromotionId,
      redeemedAt: finiteIso(value.redeemedAt),
    } satisfies CrmRewardRedemption];
  });

const parseOrderIdentities = (
  docs: readonly QueryDocumentSnapshot<DocumentData>[],
  storeId: string
): Map<string, CrmOrderIdentity> => {
  const latestByCustomer = new Map<string, CrmOrderIdentity>();
  for (const document of docs) {
    const value = document.data() as Record<string, unknown>;
    const customerId = clean(value.buyerId);
    if (value.storeId !== storeId || !customerId) continue;
    const identity: CrmOrderIdentity = {
      customerId,
      name: clean(value.buyerName),
      email: clean(value.buyerEmail),
      updatedAt: latestIso(finiteIso(value.updatedAt), finiteIso(value.createdAt)),
    };
    const current = latestByCustomer.get(customerId);
    if (!current || identity.updatedAt > current.updatedAt) {
      latestByCustomer.set(customerId, identity);
    }
  }
  return latestByCustomer;
};

const readUserProfiles = async (
  customerIds: readonly string[]
): Promise<Map<string, CrmUserProfile>> => {
  if (customerIds.length === 0) return new Map();
  const refs = customerIds.map(customerId => adminDb.doc(`users/${customerId}`));
  const snapshots = await adminDb.getAll(...refs);
  const profiles = new Map<string, CrmUserProfile>();
  for (const snapshot of snapshots) {
    if (!snapshot.exists) continue;
    const value = snapshot.data() as Record<string, unknown>;
    const profileVisible = value.isProfileVisible !== false;
    profiles.set(snapshot.id, {
      name: profileVisible ? clean(value.name) : '',
      email: profileVisible ? clean(value.email) : '',
      avatarUrl: profileVisible ? clean(value.photoUrl) : '',
    });
  }
  return profiles;
};

const readVoucherAvailability = async (
  storeId: string,
  redemptions: readonly CrmRewardRedemption[],
  now: Date
): Promise<Map<string, boolean>> => {
  const promotionIds = Array.from(new Set(
    redemptions.map(redemption => redemption.voucherPromotionId).filter(Boolean)
  ));
  if (promotionIds.length === 0) return new Map();
  const refs = promotionIds.map(id => adminDb.doc(`stores/${storeId}/promotions/${id}`));
  const snapshots = await adminDb.getAll(...refs);
  const availability = new Map<string, boolean>();
  for (const snapshot of snapshots) {
    if (!snapshot.exists) {
      availability.set(snapshot.id, false);
      continue;
    }
    const value = snapshot.data() as Record<string, unknown>;
    const startsAt = finiteIso(value.startsAt);
    const endsAt = finiteIso(value.endsAt);
    const redemptionCount = Number(value.redemptionCount ?? 0);
    const active = value.active !== false;
    const available =
      active &&
      (!startsAt || Date.parse(startsAt) <= now.getTime()) &&
      (!endsAt || Date.parse(endsAt) > now.getTime()) &&
      Number.isFinite(redemptionCount) &&
      redemptionCount <= 0;
    availability.set(snapshot.id, available);
  }
  return availability;
};

export const loadStoreCrmSummary = async (input: {
  storeId: string;
  now?: Date;
}): Promise<StoreCrmSummary> => {
  const storeId = clean(input.storeId);
  if (!storeId) throw new Error('STORE_CRM_STORE_REQUIRED');
  const now = input.now ?? new Date();
  if (Number.isNaN(now.getTime())) throw new Error('STORE_CRM_NOW_INVALID');
  const generatedAt = now.toISOString();

  const [
    paymentSnapshot,
    ledgerSnapshot,
    progressSnapshot,
    redemptionSnapshot,
    orderSnapshot,
    tenantSnapshot,
  ] = await Promise.all([
    adminDb.collection(paymentCollectionPath(storeId)).get(),
    adminDb.collection(ledgerCollectionPath(storeId)).get(),
    adminDb.collection(challengeProgressCollectionPath(storeId)).get(),
    adminDb.collection(rewardRedemptionCollectionPath(storeId)).get(),
    adminDb.collection(orderCollectionPath(storeId)).get(),
    adminDb.doc(`tenants/${storeId}`).get(),
  ]);

  const payments = parsePayments(paymentSnapshot.docs, storeId);
  const ledgerEntries = parseLedgerEntries(ledgerSnapshot.docs, storeId);
  const progress = parseChallengeProgress(progressSnapshot.docs, storeId);
  const redemptions = parseRewardRedemptions(redemptionSnapshot.docs, storeId);
  const orderIdentityByCustomer = parseOrderIdentities(orderSnapshot.docs, storeId);

  const paymentsByCustomer = new Map<string, CanonicalPayment[]>();
  for (const payment of payments) {
    const current = paymentsByCustomer.get(payment.buyerId) ?? [];
    current.push(payment);
    paymentsByCustomer.set(payment.buyerId, current);
  }
  const ledgerByCustomer = groupByCustomer(ledgerEntries);
  const progressByCustomer = groupByCustomer(progress);
  const redemptionsByCustomer = groupByCustomer(redemptions);

  const customerIds = Array.from(new Set([
    ...payments.map(payment => payment.buyerId),
    ...ledgerEntries.map(entry => entry.customerId),
    ...progress.map(item => item.customerId),
    ...redemptions.map(item => item.customerId),
  ])).filter(Boolean);

  const [profiles, voucherAvailability] = await Promise.all([
    readUserProfiles(customerIds),
    readVoucherAvailability(storeId, redemptions, now),
  ]);

  const rewardDefinitions = normalizeStoreRewardDefinitions(
    tenantSnapshot.data()?.storeRewards
  ).filter(reward => reward.storeId === storeId);

  const customers: StoreCrmCustomer[] = customerIds.map(customerId => {
    const customerPayments = paymentsByCustomer.get(customerId) ?? [];
    const confirmedPayments = customerPayments.filter(payment =>
      isPaymentAuthoritativelyPaid(payment.status)
    );
    const confirmedPurchases = confirmedPayments.length;
    const totalPaid = money(
      confirmedPayments.reduce((total, payment) => total + payment.amount, 0)
    );
    const latestPayment = [...confirmedPayments].sort((left, right) =>
      latestIso(right.paidAt, right.updatedAt, right.createdAt).localeCompare(
        latestIso(left.paidAt, left.updatedAt, left.createdAt)
      )
    )[0];
    const lastPurchaseAt = latestPayment
      ? latestIso(latestPayment.paidAt, latestPayment.updatedAt, latestPayment.createdAt)
      : '';

    const customerLedger = ledgerByCustomer.get(customerId) ?? [];
    const pointsBalance = deriveStorePointBalance(customerLedger);
    const customerProgress = progressByCustomer.get(customerId) ?? [];
    const challengeProgressCount = customerProgress.filter(item =>
      item.progress > 0 || item.status === 'completed'
    ).length;
    const completedChallengeCount = customerProgress.filter(
      item => item.status === 'completed'
    ).length;
    const customerRedemptions = redemptionsByCustomer.get(customerId) ?? [];
    const redeemedRewardIds = new Set(
      customerRedemptions.map(redemption => redemption.rewardId)
    );
    const rewardRedemptionCount = customerRedemptions.length;
    const availableRewardCount = rewardDefinitions.filter(reward =>
      isStoreRewardAvailableAt(reward, generatedAt) &&
      !redeemedRewardIds.has(reward.id) &&
      pointsBalance >= reward.costPoints
    ).length;
    const availableVoucherCount = customerRedemptions.filter(redemption =>
      redemption.voucherPromotionId &&
      voucherAvailability.get(redemption.voucherPromotionId) === true
    ).length;

    const orderIdentity = orderIdentityByCustomer.get(customerId);
    const profile = profiles.get(customerId);
    const ledgerActivity = customerLedger.reduce(
      (latest, entry) => latestIso(latest, entry.occurredAt),
      ''
    );
    const challengeActivity = customerProgress.reduce(
      (latest, item) => latestIso(latest, item.completedAt),
      ''
    );
    const redemptionActivity = customerRedemptions.reduce(
      (latest, redemption) => latestIso(latest, redemption.redeemedAt),
      ''
    );

    return {
      customerId,
      name: orderIdentity?.name || profile?.name || 'Cliente Kyrub',
      email: orderIdentity?.email || profile?.email || '',
      avatarUrl: profile?.avatarUrl || '',
      confirmedPurchases,
      totalPaid,
      averageTicket:
        confirmedPurchases > 0 ? money(totalPaid / confirmedPurchases) : 0,
      lastPurchaseAt,
      lastActivityAt: latestIso(
        lastPurchaseAt,
        ledgerActivity,
        challengeActivity,
        redemptionActivity
      ),
      lastOrderId: latestPayment?.orderId ?? '',
      pointsBalance,
      relationshipLevel: deriveStoreRelationshipLevel(confirmedPurchases),
      challengeProgressCount,
      completedChallengeCount,
      availableRewardCount,
      rewardRedemptionCount,
      availableVoucherCount,
      segments: deriveStoreCrmSegments({
        confirmedPurchases,
        pointsBalance,
        challengeProgressCount,
        rewardRedemptionCount,
      }),
    } satisfies StoreCrmCustomer;
  }).sort((left, right) =>
    right.lastActivityAt.localeCompare(left.lastActivityAt) ||
    right.confirmedPurchases - left.confirmedPurchases ||
    left.name.localeCompare(right.name, 'pt-BR')
  );

  return {
    schemaVersion: STORE_CRM_SCHEMA_VERSION,
    storeId,
    generatedAt,
    totals: {
      customers: customers.length,
      recurringCustomers: customers.filter(customer => customer.confirmedPurchases >= 3).length,
      loyalCustomers: customers.filter(customer => customer.confirmedPurchases >= 25).length,
      outstandingStorePoints: customers.reduce(
        (total, customer) => total + Math.max(0, customer.pointsBalance),
        0
      ),
      confirmedRevenue: money(
        customers.reduce((total, customer) => total + customer.totalPaid, 0)
      ),
    },
    customers,
  };
};
