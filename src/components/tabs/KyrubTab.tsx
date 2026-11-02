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
  MarketplaceOfferListingDocument,
  MarketplaceStoreListingDocument,
  Store,
} from '../../types';
import { auth, db } from '../../utils/firebase';
import { loadMarketplaceDiscovery } from '../../utils/marketplaceDiscovery';
import { loadStoreRelationshipForCurrentUser } from '../../utils/storeRelationship';
import type { StoreRelationshipSummary } from '../../../shared/storeRelationship';
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
  offerImages: [listing.banner, listing.logo].filter((image): image is string => Boolean(image?.trim())),
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
    offerImages: [data.banner, data.logo].filter((image): image is string => typeof image === 'string' && Boolean(image.trim())),
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
  const [publishedOffers, setPublishedOffers] = useState<MarketplaceOfferListingDocument[]>([]);
  const [fallbackStores, setFallbackStores] = useState<Store[]>([]);
  const [discoveryFilter, setDiscoveryFilter] = useState<DiscoveryFilter>('none');
  const [discoverySignals, setDiscoverySignals] = useState<MarketplaceStoreDiscoverySignal[]>([]);
  const [discoveryLoading, setDiscoveryLoading] = useState(false);
  const [clubSummaries, setClubSummaries] = useState<Array<{ storeId: string; summary: StoreRelationshipSummary }>>([]);
  const [clubsLoading, setClubsLoading] = useState(false);
  const [clubsError, setClubsError] = useState(false);
  const [selosBalance, setSelosBalance] = useState<number | null>(null);
  const [selosLoading, setSelosLoading] = useState(false);
  const [selosError, setSelosError] = useState(false);
  const socialFeed = usePublicSocialFeed();

  useEffect(() => {
    props.setPosts(socialFeed.posts);
  }, [props.setPosts, socialFeed.posts]);

  useEffect(() => {
    let unsubscribeCanonical = () => undefined;
    let unsubscribeOffers = () => undefined;
    let unsubscribeFallback = () => undefined;
    const unsubscribeAuth = onAuthStateChanged(auth, user => {
      unsubscribeCanonical();
      unsubscribeOffers();
      unsubscribeFallback();
      setCanonicalStores([]);
      setPublishedOffers([]);
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
            const listings = snapshot.docs.map(doc => doc.data() as MarketplaceListingDocument);
            setCanonicalStores(listings.filter((listing): listing is MarketplaceStoreListingDocument => listing.listingType === 'store').map(canonicalListingToStore));
          },
          error => {
            console.warn('Canonical marketplace listings are unavailable.', error);
            setCanonicalStores([]);
          }
        );
      }

      // Published offer images are read independently of the store-source rollout flag.
      const offersQuery = query(
        collection(db, getMarketplaceListingsCollectionPath()),
        where('publicationStatus', '==', 'published')
      );
      unsubscribeOffers = onSnapshot(
        offersQuery,
        snapshot => setPublishedOffers(
          snapshot.docs.map(doc => doc.data() as MarketplaceListingDocument)
            .filter((listing): listing is MarketplaceOfferListingDocument => listing.listingType === 'offer')
        ),
        error => {
          console.warn('Published marketplace offer images are unavailable.', error);
          setPublishedOffers([]);
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
      unsubscribeOffers();
      unsubscribeFallback();
    };
  }, []);

  const allPublishedStores = useMemo(() => {
    const imagesByStore = new Map<string, string[]>();
    for (const offer of publishedOffers) {
      const images = imagesByStore.get(offer.storeId) ?? [];
      images.push(...offer.imageUrls.filter(url => typeof url === 'string' && url.trim()));
      imagesByStore.set(offer.storeId, images);
    }
    const storesById = new Map<string, Store>();
    for (const store of fallbackStores) storesById.set(store.id, store);
    for (const store of canonicalStores) storesById.set(store.id, store);
    return Array.from(storesById.values()).map(store => ({
      ...store,
      offerImages: Array.from(new Set([...(imagesByStore.get(store.id) ?? []).slice(0, 6), ...(store.offerImages ?? [])])),
    }));
  }, [canonicalStores, fallbackStores, publishedOffers]);

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

  const purchasedStoreIds = useMemo(() => {
    const ids = new Set(props.orders.map(order => order.storeId));
    return allPublishedStores.filter(store => ids.has(store.id)).map(store => store.id);
  }, [allPublishedStores, props.orders]);

  useEffect(() => {
    let cancelled = false;
    setClubSummaries([]);
    setClubsError(false);
    if (props.socialSubTab !== 'lojas' || props.ofertasFilter !== 'cliente' || purchasedStoreIds.length === 0) {
      setClubsLoading(false);
      return;
    }
    setClubsLoading(true);
    void Promise.allSettled(purchasedStoreIds.map(storeId => loadStoreRelationshipForCurrentUser(storeId)))
      .then(results => {
        if (cancelled) return;
        setClubSummaries(results.flatMap((result, index) =>
          result.status === 'fulfilled' ? [{ storeId: purchasedStoreIds[index], summary: result.value }] : []
        ));
        setClubsError(results.some(result => result.status === 'rejected'));
      })
      .finally(() => {
        if (!cancelled) setClubsLoading(false);
      });
    return () => { cancelled = true; };
  }, [props.socialSubTab, props.ofertasFilter, purchasedStoreIds]);

  useEffect(() => {
    let cancelled = false;
    setSelosBalance(null);
    setSelosError(false);
    if (props.socialSubTab !== 'lojas' || props.ofertasFilter !== 'cliente') {
      setSelosLoading(false);
      return;
    }
    const user = auth.currentUser;
    if (!user) {
      setSelosLoading(false);
      setSelosError(true);
      return;
    }
    setSelosLoading(true);
    void user.getIdToken()
      .then(token => fetch('/api/selos-kairubi', {
        headers: { authorization: `Bearer ${token}` },
        cache: 'no-store',
      }))
      .then(async response => {
        if (!response.ok) throw new Error('SELOS_BALANCE_UNAVAILABLE');
        const data = await response.json() as { balance?: unknown; unit?: unknown };
        if (data.unit !== 'selos_kairubi' || !Number.isSafeInteger(data.balance) || (data.balance as number) < 0) {
          throw new Error('SELOS_BALANCE_INVALID');
        }
        return data.balance as number;
      })
      .then(balance => { if (!cancelled) setSelosBalance(balance); })
      .catch(() => { if (!cancelled) setSelosError(true); })
      .finally(() => { if (!cancelled) setSelosLoading(false); });
    return () => { cancelled = true; };
  }, [props.socialSubTab, props.ofertasFilter]);

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

      {props.socialSubTab === 'lojas' && props.ofertasFilter === 'cliente' && (
        <section aria-label="Recompensas" className="mb-3 rounded-2xl border border-slate-800 bg-slate-950 p-4 text-slate-100">
          <h2 className="mb-4 text-xl font-bold">Recompensas</h2>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-slate-800 p-4">
              <h3 className="text-sm text-slate-300">Selos Kairubi</h3>
              <p className="mt-3 text-2xl font-bold" aria-live="polite">
                {selosLoading ? '…' : selosError || selosBalance === null ? '—' : selosBalance.toLocaleString('pt-BR')}
              </p>
              <p className="mt-2 text-xs text-slate-400">Saldo global</p>
              {selosError && <p className="mt-2 text-xs text-amber-300" role="status">Saldo indisponível</p>}
            </div>
            <div className="rounded-2xl bg-slate-800 p-4">
              <h3 className="text-sm text-slate-300">Experiência</h3>
              <p className="mt-3 text-2xl font-bold">— XP</p>
              <p className="mt-2 text-xs text-slate-400">Nível e conquistas</p>
              <p className="mt-1 text-xs text-slate-500">Consulta de XP ainda não integrada</p>
            </div>
          </div>

          <div className="mt-5 border-t border-slate-800 pt-5">
            <h3 className="text-lg font-bold">Desafios e conquistas</h3>
            <div className="mt-3 rounded-2xl bg-slate-800 p-4 text-sm text-slate-300">
              Campanhas, objetivos, progresso e recompensas disponíveis.
              <p className="mt-2 text-xs text-slate-400">Desafios personalizados ainda não conectados nesta tela.</p>
            </div>
          </div>

          <div className="mt-5 border-t border-slate-800 pt-5">
            <h3 className="text-lg font-bold">Meus clubes</h3>
            <p className="mt-1 text-xs text-slate-400">Pontos próprios, benefícios e vouchers de cada estabelecimento.</p>
            {clubsLoading && <p className="mt-3 text-sm" role="status">Consultando seus clubes…</p>}
            {clubsError && <p className="mt-3 text-xs text-amber-300" role="status">Não foi possível consultar todos os relacionamentos.</p>}
            {!clubsLoading && purchasedStoreIds.length === 0 && (
              <p className="mt-3 text-sm text-slate-400">Clubes com histórico de compras aparecerão aqui. Outros vínculos ainda precisam ser integrados.</p>
            )}
            {clubSummaries.length > 0 && (
              <div className="mt-3 max-h-[min(55dvh,36rem)] overflow-y-auto overscroll-contain pr-1" role="region" aria-label="Lista rolável dos meus clubes" tabIndex={0}>
                <div className="grid gap-3">
                {clubSummaries.map(({ storeId, summary }) => (
                  <button type="button" key={storeId} onClick={() => {
                    const store = allPublishedStores.find(item => item.id === storeId);
                    if (store) props.setVisitingStore(store);
                  }} className="w-full rounded-xl border border-slate-700 p-4 text-left transition hover:border-slate-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400" aria-label={`Abrir vitrine de ${allPublishedStores.find(store => store.id === storeId)?.name ?? 'loja'}`}>
                    <div className="flex items-start justify-between gap-3">
                      <h4 className="text-sm font-bold">{allPublishedStores.find(store => store.id === storeId)?.name ?? 'Loja'}</h4>
                      <span className="text-xs text-slate-400">Pontos próprios</span>
                    </div>
                    <p className="mt-2 text-lg font-bold">{summary.points.balance.toLocaleString('pt-BR')} <span className="text-xs font-normal text-slate-400">pontos</span></p>
                    <p className="text-xs text-slate-400">{summary.vouchers.filter(voucher => voucher.status === 'available').length} vouchers disponíveis · Toque para visitar a vitrine</p>
                  </button>
                ))}
                </div>
              </div>
            )}
          </div>
        </section>
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
