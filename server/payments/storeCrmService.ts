import type { DocumentData, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import { deriveStorePointBalance, STORE_POINTS_CURRENCY, type StorePointLedgerEntry } from '../../shared/storePoints.js';
import { normalizeCanonicalPayment, isPaymentAuthoritativelyPaid, type CanonicalPayment } from '../../src/utils/canonicalPayment.js';
import { STORE_CRM_MAX_CUSTOMERS, STORE_CRM_SCHEMA_VERSION, buildStoreCrmCustomerSummary, type StoreCrmSummary } from '../../shared/storeCrm.js';
import type { StoreChallengeProgress } from '../../shared/storeChallenges.js';

const clean = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const finiteIso = (value: unknown): string => {
  const normalized = clean(value);
  return normalized && Number.isFinite(Date.parse(normalized)) ? normalized : '';
};

const ledgerPath = (storeId: string) => `stores/${storeId}/storePointLedger`;
const paymentPath = (storeId: string) => `stores/${storeId}/payments`;
const challengePath = (storeId: string) => `stores/${storeId}/challengeProgress`;
const redemptionPath = (storeId: string) => `stores/${storeId}/rewardRedemptions`;

const parsePayment = (doc: QueryDocumentSnapshot<DocumentData>, storeId: string): CanonicalPayment => {
  const payment = normalizeCanonicalPayment(doc.data() as CanonicalPayment);
  if (payment.storeId !== storeId) throw new Error('STORE_CRM_PAYMENT_SCOPE_INVALID');
  return payment;
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

export const loadStoreCrmSummary = async (input: { storeId: string; now?: Date }): Promise<StoreCrmSummary> => {
  const storeId = clean(input.storeId);
  if (!storeId) throw new Error('STORE_CRM_STORE_REQUIRED');
  const now = input.now ?? new Date();
  if (Number.isNaN(now.getTime())) throw new Error('STORE_CRM_NOW_INVALID');

  const [paymentSnapshot, ledgerSnapshot, challengeSnapshot, redemptionSnapshot] = await Promise.all([
    adminDb.collection(paymentPath(storeId)).get(),
    adminDb.collection(ledgerPath(storeId)).get(),
    adminDb.collection(challengePath(storeId)).get(),
    adminDb.collection(redemptionPath(storeId)).get(),
  ]);

  const customerIds = new Set<string>();
  const paidByCustomer = new Map<string, CanonicalPayment[]>();
  for (const doc of paymentSnapshot.docs) {
    const payment = parsePayment(doc, storeId);
    customerIds.add(payment.buyerId);
    if (!isPaymentAuthoritativelyPaid(payment.status)) continue;
    const list = paidByCustomer.get(payment.buyerId) ?? [];
    list.push(payment);
    paidByCustomer.set(payment.buyerId, list);
  }

  const ledgerByCustomer = new Map<string, StorePointLedgerEntry[]>();
  for (const doc of ledgerSnapshot.docs) {
    const entry = parseLedger(doc, storeId);
    customerIds.add(entry.customerId);
    const list = ledgerByCustomer.get(entry.customerId) ?? [];
    list.push(entry);
    ledgerByCustomer.set(entry.customerId, list);
  }

  const challengeCounts = new Map<string, { active: number; completed: number }>();
  for (const doc of challengeSnapshot.docs) {
    const progress = doc.data() as Partial<StoreChallengeProgress>;
    if (progress.storeId !== storeId || !clean(progress.customerId)) continue;
    customerIds.add(progress.customerId!);
    const current = challengeCounts.get(progress.customerId!) ?? { active: 0, completed: 0 };
    if (progress.status === 'completed') current.completed += 1;
    else current.active += 1;
    challengeCounts.set(progress.customerId!, current);
  }

  const redemptions = new Map<string, number>();
  for (const doc of redemptionSnapshot.docs) {
    const data = doc.data() as Record<string, unknown>;
    const customerId = clean(data.customerId);
    if (!customerId || clean(data.storeId) !== storeId) continue;
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
    const challenge = challengeCounts.get(customerId) ?? { active: 0, completed: 0 };

    return buildStoreCrmCustomerSummary({
      customerId,
      displayName: clean(profile?.displayName) || clean(profile?.name) || `Cliente ${customerId.slice(0, 6)}`,
      photoUrl: clean(profile?.photoURL) || clean(profile?.photoUrl),
      confirmedPurchases: paid.length,
      confirmedSpentMinor: paid.reduce((sum, payment) => sum + Math.round(payment.amount * 100), 0),
      lastActivityAt: lastPaymentAt > lastLedgerAt ? lastPaymentAt : lastLedgerAt,
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
    generatedAt: now.toISOString(),
    customerCount: customers.length,
    customers,
  };
};
