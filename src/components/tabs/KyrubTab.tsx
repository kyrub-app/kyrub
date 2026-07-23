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
  SocialPost,
  Store,
} from '../../types';
import { auth, db } from '../../utils/firebase';
import { getMarketplaceListingsCollectionPath } from '../../utils/marketplacePaths';

type KyrubTabProps = React.ComponentProps<
  typeof LegacyKyrubTab
>;

const CANONICAL_MARKETPLACE_READ_ENABLED =
  import.meta.env.VITE_ENABLE_CANONICAL_MARKETPLACE_READ ===
  'true';

const LEGACY_POSTS_KEY = 'kyrub_posts';
const getUserPostsKey = (uid: string) =>
  `kyrub_posts_${uid}`;

const readStoredPosts = (
  rawValue: string | null
): SocialPost[] => {
  if (!rawValue) return [];

  try {
    const parsedValue = JSON.parse(rawValue);
    return Array.isArray(parsedValue)
      ? (parsedValue as SocialPost[])
      : [];
  } catch (error) {
    console.warn(
      'Não foi possível ler as publicações salvas.',
      error
    );
    return [];
  }
};

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
    description:
      typeof data.description === 'string'
        ? data.description
        : '',
    logo: typeof data.logo === 'string' ? data.logo : '',
    banner:
      typeof data.banner === 'string' ? data.banner : '',
    primaryColor:
      typeof data.primaryColor === 'string'
        ? data.primaryColor
        : '',
    plan: data.plan === 'business' ? 'business' : 'free',
    ownerEmail: '',
    address:
      typeof data.address === 'string' ? data.address : '',
    contact: '',
    keywords: Array.isArray(data.keywords)
      ? data.keywords.filter(
          (keyword): keyword is string =>
            typeof keyword === 'string'
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
      typeof data.lat === 'number' &&
      Number.isFinite(data.lat)
        ? data.lat
        : undefined,
    lng:
      typeof data.lng === 'number' &&
      Number.isFinite(data.lng)
        ? data.lng
        : undefined,
    isNew: false,
  };
};

export function KyrubTab(props: KyrubTabProps) {
  const [canonicalStores, setCanonicalStores] = useState<
    Store[]
  >([]);
  const [fallbackStores, setFallbackStores] = useState<
    Store[]
  >([]);
  const [activePostsUserId, setActivePostsUserId] =
    useState<string | null>(null);
  const [postsHydrated, setPostsHydrated] =
    useState(false);

  const { posts, setPosts } = props;

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, user => {
      if (!user) {
        setActivePostsUserId(null);
        setPostsHydrated(false);
        return;
      }

      const userPostsKey = getUserPostsKey(user.uid);
      const storedForUser =
        localStorage.getItem(userPostsKey);
      const legacyStoredPosts =
        localStorage.getItem(LEGACY_POSTS_KEY);
      const hydratedPosts = readStoredPosts(
        storedForUser ?? legacyStoredPosts
      );

      if (
        !storedForUser &&
        legacyStoredPosts &&
        hydratedPosts.length > 0
      ) {
        try {
          localStorage.setItem(
            userPostsKey,
            JSON.stringify(hydratedPosts)
          );
        } catch (error) {
          console.warn(
            'Não foi possível migrar as publicações locais.',
            error
          );
        }
      }

      setActivePostsUserId(user.uid);
      setPosts(hydratedPosts);
      setPostsHydrated(true);
    });

    return unsubscribe;
  }, [setPosts]);

  useEffect(() => {
    if (!activePostsUserId || !postsHydrated) return;

    try {
      localStorage.setItem(
        getUserPostsKey(activePostsUserId),
        JSON.stringify(posts)
      );
    } catch (error) {
      console.warn(
        'Não foi possível salvar as publicações localmente.',
        error
      );
    }
  }, [activePostsUserId, posts, postsHydrated]);

  useEffect(() => {
    let unsubscribeCanonical = () => undefined;
    let unsubscribeFallback = () => undefined;

    const unsubscribeAuth = onAuthStateChanged(
      auth,
      user => {
        unsubscribeCanonical();
        unsubscribeFallback();
        setCanonicalStores([]);
        setFallbackStores([]);

        if (!user) return;

        if (CANONICAL_MARKETPLACE_READ_ENABLED) {
          const canonicalQuery = query(
            collection(
              db,
              getMarketplaceListingsCollectionPath()
            ),
            where('publicationStatus', '==', 'published')
          );
          unsubscribeCanonical = onSnapshot(
            canonicalQuery,
            snapshot => {
              const stores = snapshot.docs.flatMap(
                snapshotDocument => {
                  const listing =
                    snapshotDocument.data() as MarketplaceListingDocument;
                  return listing.listingType === 'store'
                    ? [canonicalListingToStore(listing)]
                    : [];
                }
              );
              setCanonicalStores(stores);
            },
            error => {
              console.warn(
                'Canonical marketplace listings are unavailable.',
                error
              );
              setCanonicalStores([]);
            }
          );
        }

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
                  snapshotDocument.data() as Record<
                    string,
                    unknown
                  >
                );
                return store ? [store] : [];
              })
            );
          },
          error => {
            console.warn(
              'Marketplace fallback listings are unavailable.',
              error
            );
            setFallbackStores([]);
          }
        );
      }
    );

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
