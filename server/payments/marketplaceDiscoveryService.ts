import type { DocumentData, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import {
  MARKETPLACE_DISCOVERY_SCHEMA_VERSION,
  buildMarketplaceStoreDiscoverySignal,
  compareMarketplaceForYouSignals,
  type MarketplaceDiscoveryResponse,
  type MarketplaceStoreDiscoverySignal,
} from '../../shared/marketplaceDiscovery.js';
import {
  STORE_POINTS_CURRENCY,
  deriveStorePointBalance,
  type StorePointLedgerEntry,
} from '../../shared/storePoints.js';
import {
  isPaymentAuthoritativelyPaid,
  normalizeCanonicalPayment,
  type CanonicalPayment,
} from '../../src/utils/canonicalPayment.js';
import { listPublicStorePromotions } from './storePromotionService.js';

const MAX_DISCOVERY_STORES = 24;

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const uniqueStoreIds = (values: readonly string[]): string[] =>
  Array.from(new Set(values.map(clean).filter(Boolean))).slice(
    0,
    MAX_DISCOVERY_STORES
  );

const paymentCollectionPath = (storeId: string): string =>
  `stores/${storeId}/payments`;

const ledgerCollectionPath = (storeId: string): string =>
  `stores/${storeId}/storePointLedger`;

const countConfirmedPurchases = (
  docs: readonly QueryDocumentSnapshot<DocumentData>[],
  storeId: string,
  customerId: string
): number => {
  let count = 0;
  for (const document of docs) {
    let payment: CanonicalPayment;
    try {
      payment = normalizeCanonicalPayment(document.data() as CanonicalPayment);
    } catch {
      throw new Error('MARKETPLACE_DISCOVERY_PAYMENT_INVALID');
    }
    if (payment.storeId !== storeId || payment.buyerId !== customerId) {
      throw new Error('MARKETPLACE_DISCOVERY_PAYMENT_SCOPE_INVALID');
    }
    if (isPaymentAuthoritativelyPaid(payment.status)) count += 1;
  }
  return count;
};

const deriveCustomerStorePointsBalance = (
  docs: readonly QueryDocumentSnapshot<DocumentData>[],
  storeId: string,
  customerId: string
): number => {
  const entries = docs.map(document => {
    const entry = document.data() as Partial<StorePointLedgerEntry>;
    if (
      entry.schemaVersion !== 1 ||
      entry.currency !== STORE_POINTS_CURRENCY ||
      entry.storeId !== storeId ||
      entry.customerId !== customerId ||
      !Number.isSafeInteger(entry.amount)
    ) {
      throw new Error('MARKETPLACE_DISCOVERY_LEDGER_INVALID');
    }
    return { amount: entry.amount as number };
  });
  return deriveStorePointBalance(entries);
};

const loadStoreDiscoverySignal = async (input: {
  storeId: string;
  customerId: string;
  now: Date;
}): Promise<MarketplaceStoreDiscoverySignal> => {
  const paymentQuery = adminDb
    .collection(paymentCollectionPath(input.storeId))
    .where('buyerId', '==', input.customerId);
  const ledgerQuery = adminDb
    .collection(ledgerCollectionPath(input.storeId))
    .where('customerId', '==', input.customerId);

  const [payments, ledger, promotions] = await Promise.all([
    paymentQuery.get(),
    ledgerQuery.get(),
    listPublicStorePromotions(input.storeId, input.now),
  ]);

  return buildMarketplaceStoreDiscoverySignal({
    storeId: input.storeId,
    inPromotion: promotions.length > 0,
    confirmedPurchases: countConfirmedPurchases(
      payments.docs,
      input.storeId,
      input.customerId
    ),
    pointsBalance: deriveCustomerStorePointsBalance(
      ledger.docs,
      input.storeId,
      input.customerId
    ),
  });
};

export const loadMarketplaceDiscovery = async (input: {
  storeIds: readonly string[];
  customerId: string;
  now?: Date;
}): Promise<MarketplaceDiscoveryResponse> => {
  const customerId = clean(input.customerId);
  if (!customerId) throw new Error('MARKETPLACE_DISCOVERY_CUSTOMER_REQUIRED');
  const storeIds = uniqueStoreIds(input.storeIds);
  if (storeIds.length === 0) {
    return {
      schemaVersion: MARKETPLACE_DISCOVERY_SCHEMA_VERSION,
      customerId,
      generatedAt: (input.now ?? new Date()).toISOString(),
      signals: [],
    };
  }
  if (input.storeIds.map(clean).filter(Boolean).length > MAX_DISCOVERY_STORES) {
    throw new Error('MARKETPLACE_DISCOVERY_STORE_LIMIT');
  }

  const now = input.now ?? new Date();
  if (Number.isNaN(now.getTime())) throw new Error('MARKETPLACE_DISCOVERY_NOW_INVALID');

  const signals = await Promise.all(
    storeIds.map(storeId =>
      loadStoreDiscoverySignal({ storeId, customerId, now })
    )
  );

  return {
    schemaVersion: MARKETPLACE_DISCOVERY_SCHEMA_VERSION,
    customerId,
    generatedAt: now.toISOString(),
    signals: signals.sort(compareMarketplaceForYouSignals),
  };
};

export const MARKETPLACE_DISCOVERY_STORE_LIMIT = MAX_DISCOVERY_STORES;
