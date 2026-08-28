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
import { PublicSocialFeedPanel } from '../PublicSocialFeedPanel';
import { StoreOfferCardPresentationBridge } from '../StoreOfferCardPresentationBridge';
import { CustomerRelationshipsShoppingBridge } from '../store/CustomerRelationshipsShoppingBridge';
import { KyrubTab as LegacyKyrubTab } from './LegacyKyrubTab';
import { usePublicSocialFeed } from '../../hooks/usePublicSocialFeed';
import type {
  MarketplaceListingDocument,
  MarketplaceStoreListingDocument,
  Store,
} from '../../types';
import { auth, db } from '../../utils/firebase';
import { getMarketplaceListingsCollectionPath } from '../../utils/marketplacePaths';
import type { OpenCustomerRelationshipDetail } from '../../utils/relationshipNotifications';

type KyrubTabProps = React.ComponentProps<typeof LegacyKyrubTab>;

const CANONICAL_MARKETPLACE_READ_ENABLED =
  import.meta.env.VITE_ENABLE_CANONICAL_MARKETPLACE_READ === 'true';

const canonicalListingToStore = (listing: MarketplaceStoreListingDocument): Store => ({
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
  if (data.publicationStatus !== 'published' || typeof data.id !== 'string' || typeof data.name !== 'string') return null;
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
    status: data.status === 'open' || data.status === 'delayed' || data.status === 'closed' ? data.status : 'closed',
    lat: typeof data.lat === 'number' && Number.isFinite(data.lat) ? data.lat : undefined,
    lng: typeof data.lng === 'number' && Number.isFinite(data.lng) ? data.lng : undefined,
    isNew: false,
  };
};

export function KyrubTab(props: KyrubTabProps) {
  const [canonicalStores, setCanonicalStores] = useState<Store[]>([]);
  const [fallbackStores, setFallbackStores] = useState<Store[]>([]);
  const [relationshipTargetStoreId, setRelationshipTargetStoreId] = useState('');
  const socialFeed = usePublicSocialFeed();

  useEffect(() => {
    props.setPosts(socialFeed.posts);
  }, [props.setPosts, socialFeed.posts]);

  useEffect(() => {
    const openRelationship = (event: Event) => {
      const detail = (event as CustomEvent<OpenCustomerRelationshipDetail>).detail;
      if (!detail?.storeId) return;
      setRelationshipTargetStoreId(detail.storeId);
      props.setSocialSubTab('lojas');
      props.setOfertasFilter('cliente');
    };
    window.addEventListener('kyrub:open-customer-relationship', openRelationship);
    return () => window.removeEventListener('kyrub:open-customer-relationship', openRelationship);
  }, [props.setOfertasFilter, props.setSocialSubTab]);

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
            setCanonicalStores(snapshot.docs.flatMap(snapshotDocument => {
              const listing = snapshotDocument.data() as MarketplaceListingDocument;
              return listing.listingType === 'store' ? [canonicalListingToStore(listing)] : [];
            }));
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
          setFallbackStores(snapshot.docs.flatMap(snapshotDocument => {
            const store = tenantListingToStore(snapshotDocument.data() as Record<string, unknown>);
            return store ? [store] : [];
          }));
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
    for (const store of fallbackStores) storesById.set(store.id, store);
    for (const store of canonicalStores) storesById.set(store.id, store);
    return Array.from(storesById.values());
  }, [canonicalStores, fallbackStores]);

  const isConnectedContactsActive = props.socialSubTab === 'usuarios' && props.pracaFilter === 'conectados';
  const isPublicFeedActive = props.socialSubTab === 'usuarios' && (props.pracaFilter === 'recentes' || props.pracaFilter === 'favoritos');
  const isCustomerRelationshipsActive = props.socialSubTab === 'lojas' && props.ofertasFilter === 'cliente';

  const wrapperClassName = [
    isConnectedContactsActive ? 'connected-contacts-redesign-active' : '',
    isPublicFeedActive ? 'public-social-feed-active' : '',
    isCustomerRelationshipsActive ? 'customer-relationships-active' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={wrapperClassName || undefined}>
      <LegacyKyrubTab {...props} posts={socialFeed.posts} storesWithCoords={publishedStores} />

      <StoreOfferCardPresentationBridge
        stores={publishedStores}
        enabled={props.socialSubTab === 'lojas' && !isCustomerRelationshipsActive}
      />

      <CustomerRelationshipsShoppingBridge
        enabled={isCustomerRelationshipsActive}
        stores={publishedStores}
        orders={props.orders}
        onEnterStore={props.setVisitingStore}
        initialStoreId={relationshipTargetStoreId}
        onInitialStoreHandled={() => setRelationshipTargetStoreId('')}
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
