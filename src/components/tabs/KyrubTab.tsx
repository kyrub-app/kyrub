import { useEffect, useMemo, useState } from 'react';
import type React from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import {
  collection,
  onSnapshot,
  query,
  where,
} from 'firebase/firestore';
import { BadgePercent, Sparkles } from 'lucide-react';
import { ConnectedContactsPanel } from '../ConnectedContactsPanel';
import { PublicSocialFeedPanel } from '../PublicSocialFeedPanel';
import { StoreOfferCardPresentationBridge } from '../StoreOfferCardPresentationBridge';
import { KyrubTab as LegacyKyrubTab } from './LegacyKyrubTab';
import { usePublicSocialFeed } from '../../hooks/usePublicSocialFeed';
import type {
  MarketplaceListingDocument,
  MarketplaceStoreListingDocument,
  Store,
} from '../../types';
import { auth, db } from '../../utils/firebase';
import { loadMarketplaceDiscovery } from '../../utils/marketplaceDiscovery';
import { getMarketplaceListingsCollectionPath } from '../../utils/marketplacePaths';
import type { MarketplaceStoreDiscoverySignal } from '../../../shared/marketplaceDiscovery';

type KyrubTabProps = React.ComponentProps<typeof LegacyKyrubTab>;
type DiscoveryFilter = 'none' | 'promotion' | 'for_you';

const CANONICAL_MARKETPLACE_READ_ENABLED =
  import.meta.env.VITE_ENABLE_CANONICAL_MARKETPLACE_READ === 'true';

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
      ? data.keywords.filter((keyword): keyword is string => typeof keyword === 'string')
      : [],
    offerImages: [],
    status:
      data.status === 'open' || data.status === 'delayed' || data.status === 'closed'
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
  const [discoveryFilter, setDiscoveryFilter] = useState<DiscoveryFilter>('none');
  const [discoverySignals, setDiscoverySignals] = useState<MarketplaceStoreDiscoverySignal[]>([]);
  const [discoveryLoading, setDiscoveryLoading] = useState(false);
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
                const listing = snapshotDocument.data() as MarketplaceListingDocument;
                return listing.listingType === 'store'
                  ? [canonicalListingToStore(listing)]
                  : [];
              })
            );
          },
          error => {
            console.warn('Canonical marketplace listings are unavailable.', error);
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

  const allPublishedStores = useMemo(() => {
    const storesById = new Map<string, Store>();
    for (const store of fallbackStores) storesById.set(store.id, store);
    for (const store of canonicalStores) storesById.set(store.id, store);
    return Array.from(storesById.values());
  }, [canonicalStores, fallbackStores]);

  useEffect(() => {
    let cancelled = false;
    const user = auth.currentUser;
    const storeIds = allPublishedStores.slice(0, 24).map(store => store.id);
    setDiscoverySignals([]);
    if (!user || storeIds.length === 0) return;

    setDiscoveryLoading(true);
    void loadMarketplaceDiscovery(user, storeIds)
      .then(result => {
        if (!cancelled) setDiscoverySignals(result.signals);
      })
      .catch(error => {
        if (!cancelled) {
          console.warn('Marketplace discovery signals are unavailable.', error);
          setDiscoverySignals([]);
        }
      })
      .finally(() => {
        if (!cancelled) setDiscoveryLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [allPublishedStores]);

  useEffect(() => {
    if (props.ofertasFilter !== 'todas') setDiscoveryFilter('none');
  }, [props.ofertasFilter]);

  const signalByStoreId = useMemo(
    () => new Map(discoverySignals.map(signal => [signal.storeId, signal])),
    [discoverySignals]
  );

  const publishedStores = useMemo(() => {
    if (discoveryFilter === 'promotion') {
      return allPublishedStores.filter(
        store => signalByStoreId.get(store.id)?.inPromotion === true
      );
    }
    if (discoveryFilter === 'for_you') {
      return allPublishedStores
        .filter(store => signalByStoreId.get(store.id)?.forYou === true)
        .sort((left, right) => {
          const leftSignal = signalByStoreId.get(left.id);
          const rightSignal = signalByStoreId.get(right.id);
          return (
            (rightSignal?.confirmedPurchases ?? 0) -
              (leftSignal?.confirmedPurchases ?? 0) ||
            (rightSignal?.pointsBalance ?? 0) -
              (leftSignal?.pointsBalance ?? 0)
          );
        });
    }
    return allPublishedStores;
  }, [allPublishedStores, discoveryFilter, signalByStoreId]);

  const selectDiscoveryFilter = (
    next: Exclude<DiscoveryFilter, 'none'>
  ): void => {
    props.setOfertasFilter('todas');
    setDiscoveryFilter(current => (current === next ? 'none' : next));
  };

  const isConnectedContactsActive =
    props.socialSubTab === 'usuarios' && props.pracaFilter === 'conectados';
  const isPublicFeedActive =
    props.socialSubTab === 'usuarios' &&
    (props.pracaFilter === 'recentes' || props.pracaFilter === 'favoritos');

  const wrapperClassName = [
    isConnectedContactsActive ? 'connected-contacts-redesign-active' : '',
    isPublicFeedActive ? 'public-social-feed-active' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={wrapperClassName || undefined}>
      {props.socialSubTab === 'lojas' && (
        <div
          className="mb-3 grid grid-cols-2 gap-2"
          id="marketplace-discovery-filters"
        >
          <button
            type="button"
            onClick={() => selectDiscoveryFilter('promotion')}
            className={`flex min-h-10 items-center justify-center gap-2 rounded-2xl border px-3 text-[10px] font-black uppercase ${
              discoveryFilter === 'promotion'
                ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300'
                : 'border-slate-800 bg-slate-900 text-slate-400'
            }`}
          >
            <BadgePercent className="h-4 w-4" />
            Em promoção
          </button>
          <button
            type="button"
            onClick={() => selectDiscoveryFilter('for_you')}
            className={`flex min-h-10 items-center justify-center gap-2 rounded-2xl border px-3 text-[10px] font-black uppercase ${
              discoveryFilter === 'for_you'
                ? 'border-violet-500/50 bg-violet-500/10 text-violet-300'
                : 'border-slate-800 bg-slate-900 text-slate-400'
            }`}
          >
            <Sparkles className="h-4 w-4" />
            {discoveryLoading ? 'Personalizando…' : 'Para você'}
          </button>
        </div>
      )}

      <LegacyKyrubTab
        {...props}
        posts={socialFeed.posts}
        storesWithCoords={publishedStores}
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
