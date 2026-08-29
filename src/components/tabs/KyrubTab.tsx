import { useEffect, useMemo, useState } from 'react';
import type React from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import {
  collection,
  onSnapshot,
  query,
  where,
} from 'firebase/firestore';
import { ConnectedContactsPanel } from '../ConnectedContactsPanel';
import { MarketplaceOfferFilterLabelBridge } from '../MarketplaceOfferFilterLabelBridge';
import { PublicSocialFeedPanel } from '../PublicSocialFeedPanel';
import { StoreOfferCardPresentationBridge } from '../StoreOfferCardPresentationBridge';
import { KyrubTab as LegacyKyrubTab } from './LegacyKyrubTab';
import { usePublicSocialFeed } from '../../hooks/usePublicSocialFeed';
import type {
  MarketplaceListingDocument,
  MarketplaceStoreListingDocument,
  Order,
  Store,
} from '../../types';
import { auth, db } from '../../utils/firebase';
import { getMarketplaceListingsCollectionPath } from '../../utils/marketplacePaths';
import { loadMarketplaceOfferSegments } from '../../utils/marketplaceOfferSegments';

type KyrubTabProps = React.ComponentProps<
  typeof LegacyKyrubTab
>;

const CANONICAL_MARKETPLACE_READ_ENABLED =
  import.meta.env.VITE_ENABLE_CANONICAL_MARKETPLACE_READ ===
  'true';

const SEGMENT_BATCH_SIZE = 100;

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

const segmentPlaceholderOrder = (storeId: string): Order => ({
  id: `marketplace-segment:${storeId}`,
  storeId,
  buyerName: '',
  buyerEmail: '',
  items: [],
  total: 0,
  status: 'delivered',
  createdAt: '',
  type: 'retail',
});

export function KyrubTab(props: KyrubTabProps) {
  const [canonicalStores, setCanonicalStores] = useState<Store[]>([]);
  const [fallbackStores, setFallbackStores] = useState<Store[]>([]);
  const [promotionStoreIds, setPromotionStoreIds] = useState<string[]>([]);
  const [forYouStoreIds, setForYouStoreIds] = useState<string[]>([]);
  const socialFeed = usePublicSocialFeed();

  useEffect(() => {
    props.setPosts(socialFeed.posts);
  }, [props.setPosts, socialFeed.posts]);

  useEffect(() => {
    let unsubscribeCanonical = () => undefined;
    let unsubscribeFallback = () => undefined;

    const unsubscribeAuth = onAuthStateChanged(auth, user => {
      unsubscribeCanonical();
      unsubscribeFallback();
      setCanonicalStores([]);
      setFallbackStores([]);
      setPromotionStoreIds([]);
      setForYouStoreIds([]);

      if (!user) return;

      if (CANONICAL_MARKETPLACE_READ_ENABLED) {
        const canonicalQuery = query(
          collection(db, getMarketplaceListingsCollectionPath()),
          where('publicationStatus', '==', 'published')
        );
        unsubscribeCanonical = onSnapshot(
          canonicalQuery,
          snapshot => {
            setCanonicalStores(
              snapshot.docs.flatMap(snapshotDocument => {
                const listing =
                  snapshotDocument.data() as MarketplaceListingDocument;
                return listing.listingType === 'store'
                  ? [canonicalListingToStore(listing)]
                  : [];
              })
            );
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
                snapshotDocument.data() as Record<string, unknown>
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
    });

    return () => {
      unsubscribeAuth();
      unsubscribeCanonical();
      unsubscribeFallback();
    };
  }, []);

  const marketplaceStores = useMemo(() => {
    const storesById = new Map<string, Store>();
    for (const store of fallbackStores) storesById.set(store.id, store);
    for (const store of canonicalStores) storesById.set(store.id, store);
    return Array.from(storesById.values());
  }, [canonicalStores, fallbackStores]);

  const storeIdFingerprint = useMemo(
    () => marketplaceStores.map(store => store.id).sort().join('|'),
    [marketplaceStores]
  );

  useEffect(() => {
    let cancelled = false;
    const storeIds = storeIdFingerprint ? storeIdFingerprint.split('|') : [];
    if (!auth.currentUser || storeIds.length === 0) {
      setPromotionStoreIds([]);
      setForYouStoreIds([]);
      return;
    }

    const batches: string[][] = [];
    for (let index = 0; index < storeIds.length; index += SEGMENT_BATCH_SIZE) {
      batches.push(storeIds.slice(index, index + SEGMENT_BATCH_SIZE));
    }

    void Promise.all(batches.map(batch => loadMarketplaceOfferSegments(batch)))
      .then(results => {
        if (cancelled) return;
        setPromotionStoreIds(
          Array.from(new Set(results.flatMap(result => result.promotionStoreIds)))
        );
        setForYouStoreIds(
          Array.from(new Set(results.flatMap(result => result.forYouStoreIds)))
        );
      })
      .catch(error => {
        if (cancelled) return;
        console.warn('Marketplace offer segmentation is unavailable.', error);
        setPromotionStoreIds([]);
        setForYouStoreIds([]);
      });

    return () => {
      cancelled = true;
    };
  }, [storeIdFingerprint]);

  const publishedStores = useMemo(() => {
    const promotionSet = new Set(promotionStoreIds);
    return marketplaceStores.map(store => ({
      ...store,
      // Compatibility: LegacyKyrubTab's internal `novas` filter reads only
      // `isNew`. The visible label is `Em promoção`, and this marker comes
      // exclusively from the canonical public-promotion segment.
      isNew: promotionSet.has(store.id),
    }));
  }, [promotionStoreIds, marketplaceStores]);

  const legacyForYouOrders = useMemo(() => {
    const forYouSet = new Set(forYouStoreIds);
    const existingByStoreId = new Map(
      props.orders
        .filter(order => order.storeId && forYouSet.has(order.storeId))
        .map(order => [order.storeId as string, order])
    );
    return forYouStoreIds.map(
      storeId => existingByStoreId.get(storeId) ?? segmentPlaceholderOrder(storeId)
    );
  }, [forYouStoreIds, props.orders]);

  const isConnectedContactsActive =
    props.socialSubTab === 'usuarios' &&
    props.pracaFilter === 'conectados';
  const isPublicFeedActive =
    props.socialSubTab === 'usuarios' &&
    (props.pracaFilter === 'recentes' ||
      props.pracaFilter === 'favoritos');

  const wrapperClassName = [
    isConnectedContactsActive
      ? 'connected-contacts-redesign-active'
      : '',
    isPublicFeedActive ? 'public-social-feed-active' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={wrapperClassName || undefined}>
      <LegacyKyrubTab
        {...props}
        posts={socialFeed.posts}
        storesWithCoords={publishedStores}
        orders={legacyForYouOrders}
      />

      <MarketplaceOfferFilterLabelBridge
        enabled={props.socialSubTab === 'lojas'}
      />

      <StoreOfferCardPresentationBridge
        stores={publishedStores}
        enabled={props.socialSubTab === 'lojas'}
      />

      {isPublicFeedActive && (
        <PublicSocialFeedPanel
          posts={socialFeed.posts}
          loading={socialFeed.loading}
          currentUserId={socialFeed.currentUserId}
          likedPostIds={socialFeed.likedPostIds}
          commentsByPost={socialFeed.commentsByPost}
          friends={props.friends}
          searchQuery={props.searchQuery}
          filter={props.pracaFilter as 'recentes' | 'favoritos'}
          onToggleLike={socialFeed.toggleLike}
          onAddComment={socialFeed.addComment}
          onDeleteComment={socialFeed.deleteComment}
          triggerToast={props.triggerToast}
        />
      )}

      {isConnectedContactsActive && (
        <ConnectedContactsPanel
          searchQuery={props.searchQuery}
          friends={props.friends}
          posts={socialFeed.posts}
          getSuggestions={props.getSuggestions}
          connectionRequests={props.connectionRequests}
          setConectadosSubTab={props.setConectadosSubTab}
          handleToggleFriend={props.handleToggleFriend}
          handleToggleFavoriteFriend={props.handleToggleFavoriteFriend}
          setSelectedChatUser={props.setSelectedChatUser}
          setShowChatModal={props.setShowChatModal}
          handleAcceptRequest={props.handleAcceptRequest}
          handleDeclineRequest={props.handleDeclineRequest}
          triggerToast={props.triggerToast}
        />
      )}
    </div>
  );
}
