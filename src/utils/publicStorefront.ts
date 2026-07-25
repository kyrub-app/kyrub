import {
  collection,
  onSnapshot,
  query,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import type {
  MarketplaceListingDocument,
  MarketplaceStoreListingDocument,
  Store,
} from '../types';
import { db } from './firebase';
import { getMarketplaceListingsCollectionPath } from './marketplacePaths';
import { normalizeStorefrontSlug } from './appRoutes';

const canonicalListingToStore = (
  listing: MarketplaceStoreListingDocument
): Store => ({
  id: listing.storeId,
  name: listing.name,
  slug: listing.slug,
  description: listing.description,
  logo: listing.logo,
  banner: listing.banner,
  primaryColor: listing.primaryColor,
  plan: 'free',
  ownerEmail: '',
  address: listing.address,
  contact: '',
  keywords: [...listing.keywords],
  offerImages: [],
  status: listing.status,
  lat: listing.geoPosition?.latitude,
  lng: listing.geoPosition?.longitude,
  isNew: false,
});

const tenantListingToStore = (
  data: Record<string, unknown>
): Store | null => {
  if (
    data.publicationStatus !== 'published' ||
    typeof data.id !== 'string' ||
    typeof data.name !== 'string'
  ) {
    return null;
  }

  return {
    id: data.id,
    name: data.name,
    slug: typeof data.slug === 'string' ? data.slug : '',
    description: typeof data.description === 'string' ? data.description : '',
    logo: typeof data.logo === 'string' ? data.logo : '',
    banner: typeof data.banner === 'string' ? data.banner : '',
    primaryColor: typeof data.primaryColor === 'string' ? data.primaryColor : '',
    plan: data.plan === 'business' ? 'business' : 'free',
    ownerEmail: '',
    address: typeof data.address === 'string' ? data.address : '',
    contact: '',
    keywords: Array.isArray(data.keywords)
      ? data.keywords.filter(
          (keyword): keyword is string => typeof keyword === 'string'
        )
      : [],
    offerImages: [],
    status:
      data.status === 'open' ||
      data.status === 'delayed' ||
      data.status === 'closed'
        ? data.status
        : 'closed',
    lat:
      typeof data.lat === 'number' && Number.isFinite(data.lat)
        ? data.lat
        : undefined,
    lng:
      typeof data.lng === 'number' && Number.isFinite(data.lng)
        ? data.lng
        : undefined,
    isNew: false,
  };
};

export const findPublishedStorefrontBySlug = (
  stores: Store[],
  slug: string
): Store | null => {
  const expectedSlug = normalizeStorefrontSlug(slug);
  if (!expectedSlug) return null;

  return (
    stores.find(
      store => normalizeStorefrontSlug(store.slug) === expectedSlug
    ) ?? null
  );
};

export const subscribeToPublishedStorefrontBySlug = (
  slug: string,
  onStore: (store: Store | null) => void,
  onError?: (error: Error) => void
): Unsubscribe => {
  const normalizedSlug = normalizeStorefrontSlug(slug);
  if (!normalizedSlug) {
    onStore(null);
    return () => undefined;
  }

  let canonicalStores: Store[] = [];
  let fallbackStores: Store[] = [];

  const publish = (): void => {
    const storesById = new Map<string, Store>();
    for (const store of fallbackStores) storesById.set(store.id, store);
    for (const store of canonicalStores) storesById.set(store.id, store);
    onStore(findPublishedStorefrontBySlug([...storesById.values()], normalizedSlug));
  };

  const canonicalQuery = query(
    collection(db, getMarketplaceListingsCollectionPath()),
    where('publicationStatus', '==', 'published')
  );
  const fallbackQuery = query(
    collection(db, 'tenants'),
    where('publicationStatus', '==', 'published')
  );

  const unsubscribeCanonical = onSnapshot(
    canonicalQuery,
    snapshot => {
      canonicalStores = snapshot.docs.flatMap(snapshotDocument => {
        const listing = snapshotDocument.data() as MarketplaceListingDocument;
        return listing.listingType === 'store'
          ? [canonicalListingToStore(listing)]
          : [];
      });
      publish();
    },
    error => {
      canonicalStores = [];
      publish();
      onError?.(error);
    }
  );

  const unsubscribeFallback = onSnapshot(
    fallbackQuery,
    snapshot => {
      fallbackStores = snapshot.docs.flatMap(snapshotDocument => {
        const store = tenantListingToStore(
          snapshotDocument.data() as Record<string, unknown>
        );
        return store ? [store] : [];
      });
      publish();
    },
    error => {
      fallbackStores = [];
      publish();
      onError?.(error);
    }
  );

  return () => {
    unsubscribeCanonical();
    unsubscribeFallback();
  };
};
