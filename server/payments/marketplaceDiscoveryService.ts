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
const MAX_PUBLIC_STOREFRONT_OFFERS = 250;

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const normalizePublicSlug = (value: unknown): string =>
  clean(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');

const finiteNumber = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const stringList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.map(clean).filter(Boolean)
    : [];

const uniqueStoreIds = (values: readonly string[]): string[] =>
  Array.from(new Set(values.map(clean).filter(Boolean))).slice(
    0,
    MAX_DISCOVERY_STORES
  );

const paymentCollectionPath = (storeId: string): string =>
  `stores/${storeId}/payments`;

const ledgerCollectionPath = (storeId: string): string =>
  `stores/${storeId}/storePointLedger`;

export type PublicStorefrontSnapshot = {
  store: {
    id: string;
    name: string;
    slug: string;
    description: string;
    logo: string;
    banner: string;
    primaryColor: string;
    address: string;
    keywords: string[];
    status: 'open' | 'delayed' | 'closed';
  };
  offers: Array<{
    id: string;
    name: string;
    description: string;
    price: number;
    image: string;
    stock: number;
    isService: boolean;
    category: string;
    supplierId: string;
  }>;
};

const storefrontStatus = (
  value: unknown
): PublicStorefrontSnapshot['store']['status'] =>
  value === 'open' || value === 'delayed' || value === 'closed'
    ? value
    : 'closed';

const projectLegacyPublicOffers = (
  value: unknown,
  storeId: string
): PublicStorefrontSnapshot['offers'] => {
  if (!Array.isArray(value)) return [];

  return value.slice(0, MAX_PUBLIC_STOREFRONT_OFFERS).flatMap(candidate => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      return [];
    }

    const data = candidate as Record<string, unknown>;
    const id = clean(data.id);
    const name = clean(data.name);
    const category = clean(data.category);
    const price = data.price;
    const stock = data.stock;

    if (
      !id ||
      !name ||
      typeof price !== 'number' ||
      !Number.isFinite(price) ||
      price < 0 ||
      typeof stock !== 'number' ||
      !Number.isFinite(stock) ||
      stock < 0
    ) {
      return [];
    }

    return [{
      id,
      name,
      description: clean(data.description),
      price,
      image: clean(data.image),
      stock: data.isService === true ? 0 : Math.floor(stock),
      isService: data.isService === true,
      category,
      supplierId: storeId,
    }];
  });
};

const projectCanonicalOffers = (
  docs: readonly QueryDocumentSnapshot<DocumentData>[],
  storeId: string
): PublicStorefrontSnapshot['offers'] =>
  docs.flatMap(document => {
    const data = document.data();
    if (
      data.listingType !== 'offer' ||
      data.publicationStatus !== 'published' ||
      clean(data.storeId) !== storeId
    ) {
      return [];
    }

    const offerId = clean(data.offerId) || clean(data.productId) || document.id;
    const name = clean(data.name);
    if (!offerId || !name) return [];

    const imageUrls = stringList(data.imageUrls);
    return [{
      id: offerId,
      name,
      description: clean(data.description),
      price: Math.max(0, finiteNumber(data.price)),
      image: imageUrls[0] ?? clean(data.image),
      stock: Math.max(0, Math.floor(finiteNumber(data.stock))),
      isService: data.isService === true,
      category: clean(data.category),
      supplierId: storeId,
    }];
  });

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

export const loadPublicStorefrontBySlug = async (
  requestedSlug: string
): Promise<PublicStorefrontSnapshot | null> => {
  const slug = normalizePublicSlug(requestedSlug);
  if (!slug) return null;

  // Canonical marketplace listings are authoritative whenever they exist.
  // The tenant fallback is only for stores that were published before the
  // canonical marketplace projection existed.
  const storeCandidates = await adminDb
    .collection('marketplace_listings')
    .where('slug', '==', slug)
    .limit(8)
    .get();

  const canonicalStoreDocument = storeCandidates.docs.find(document => {
    const data = document.data();
    return (
      data.listingType === 'store' &&
      normalizePublicSlug(data.slug) === slug &&
      clean(data.storeId)
    );
  });

  if (canonicalStoreDocument) {
    const storeData = canonicalStoreDocument.data();
    if (storeData.publicationStatus !== 'published') return null;

    const storeId = clean(storeData.storeId);
    if (!storeId) return null;

    const offerCandidates = await adminDb
      .collection('marketplace_listings')
      .where('storeId', '==', storeId)
      .limit(MAX_PUBLIC_STOREFRONT_OFFERS)
      .get();

    return {
      store: {
        id: storeId,
        name: clean(storeData.name),
        slug,
        description: clean(storeData.description),
        logo: clean(storeData.logo),
        banner: clean(storeData.banner),
        primaryColor: clean(storeData.primaryColor),
        address: clean(storeData.address),
        keywords: stringList(storeData.keywords),
        status: storefrontStatus(storeData.status),
      },
      offers: projectCanonicalOffers(offerCandidates.docs, storeId),
    };
  }

  const legacyCandidates = await adminDb
    .collection('tenants')
    .where('slug', '==', slug)
    .limit(8)
    .get();

  const legacyStoreDocument = legacyCandidates.docs.find(document => {
    const data = document.data();
    return (
      data.publicationStatus === 'published' &&
      normalizePublicSlug(data.slug) === slug &&
      (clean(data.id) || document.id)
    );
  });

  if (!legacyStoreDocument) return null;

  const legacyData = legacyStoreDocument.data();
  const legacyStoreId = clean(legacyData.id) || legacyStoreDocument.id;
  if (!legacyStoreId) return null;

  // If this store already has any canonical store projection, that projection
  // owns publication and slug state. Never let stale tenant data override a
  // canonical pause, rename or migration.
  const canonicalAuthority = await adminDb
    .collection('marketplace_listings')
    .where('storeId', '==', legacyStoreId)
    .limit(8)
    .get();
  const hasCanonicalStoreAuthority = canonicalAuthority.docs.some(
    document => document.data().listingType === 'store'
  );
  if (hasCanonicalStoreAuthority) return null;

  return {
    store: {
      id: legacyStoreId,
      name: clean(legacyData.name),
      slug,
      description: clean(legacyData.description),
      logo: clean(legacyData.logo),
      banner: clean(legacyData.banner),
      primaryColor: clean(legacyData.primaryColor),
      address: clean(legacyData.address),
      keywords: stringList(legacyData.keywords),
      status: storefrontStatus(legacyData.status),
    },
    offers: projectLegacyPublicOffers(legacyData.publicProducts, legacyStoreId),
  };
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