import { useEffect, useMemo, useState } from 'react';
import type React from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import {
  collection,
  onSnapshot,
  query,
  where,
} from 'firebase/firestore';
import { KyrubTab as LegacyKyrubTab } from './LegacyKyrubTab';
import type {
  MarketplaceListingDocument,
  MarketplaceStoreListingDocument,
  Store,
} from '../../types';
import { auth, db } from '../../utils/firebase';
import { getMarketplaceListingsCollectionPath } from '../../utils/marketplacePaths';

type KyrubTabProps = React.ComponentProps<typeof LegacyKyrubTab>;

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

const tenantListingToStore = (data: Record<string, unknown>): Store | null => {
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
    description:
      typeof data.description === 'string' ? data.description : '',
    logo: typeof data.logo === 'string' ? data.logo : '',
    banner: typeof data.banner === 'string' ? data.banner : '',
    primaryColor:
      typeof data.primaryColor === 'string' ? data.primaryColor : '',
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

export function KyrubTab(props: KyrubTabProps) {
  const [canonicalStores, setCanonicalStores] = useState<Store[]>([]);
  const [fallbackStores, setFallbackStores] = useState<Store[]>([]);

  useEffect(() => {
    let unsubscribeCanonical = () => undefined;
    let unsubscribeFallback = () => undefined;

    const unsubscribeAuth = onAuthStateChanged(auth, user => {
      unsubscribeCanonical();
      unsubscribeFallback();
      setCanonicalStores([]);
      setFallbackStores([]);

      if (!user) return;

      const canonicalQuery = query(
        collection(db, getMarketplaceListingsCollectionPath()),
        where('publicationStatus', '==', 'published')
      );
      unsubscribeCanonical = onSnapshot(
        canonicalQuery,
        snapshot => {
          const stores = snapshot.docs.flatMap(snapshotDocument => {
            const listing = snapshotDocument.data() as MarketplaceListingDocument;
            return listing.listingType === 'store'
              ? [canonicalListingToStore(listing)]
              : [];
          });
          setCanonicalStores(stores);
        },
        error => {
          console.warn('Canonical marketplace listings are unavailable.', error);
          setCanonicalStores([]);
        }
      );

      const fallbackQuery = query(
        collection(db, 'tenants'),
        where('publicationStatus', '==', 'published')
      );
      unsubscribeFallback = onSnapshot(
        fallbackQuery,
        snapshot => {
          setFallbackStores(
            snapshot.docs.flatMap(snapshotDocument => {
              const store = tenantListingToStore(
                snapshotDocument.data() as Record<string, unknown>
              );
              return store ? [store] : [];
            })
          );
        },
        error => {
          console.warn('Marketplace fallback listings are unavailable.', error);
          setFallbackStores([]);
        }
      );
    });

    return () => {
      unsubscribeAuth();
      unsubscribeCanonical();
      unsubscribeFallback();
    };
  }, []);

  const publishedStores = useMemo(() => {
    const storesById = new Map<string, Store>();

    for (const store of fallbackStores) {
      storesById.set(store.id, store);
    }
    for (const store of canonicalStores) {
      storesById.set(store.id, store);
    }

    return Array.from(storesById.values());
  }, [canonicalStores, fallbackStores]);

  return (
    <LegacyKyrubTab
      {...props}
      storesWithCoords={publishedStores}
    />
  );
}
