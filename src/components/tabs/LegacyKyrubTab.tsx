import React, { useEffect, useMemo, useState } from 'react';
import {
  AtSign,
  CircleUserRound,
  Clock3,
  Heart,
  ImagePlus,
  LoaderCircle,
  LocateFixed,
  MapPin,
  MessageCircle,
  Search,
  SearchX,
  Send,
  Star,
  Store as StoreIcon,
  ThumbsUp,
  UserMinus,
  Users,
  X,
} from 'lucide-react';
import { StoreOfferCarousel } from '../StoreOfferCarousel';
import { MediaCarousel } from '../MediaCarousel';
import { Friend, Order, SocialPost, Store } from '../../types';
import { auth } from '../../utils/firebase';

interface KyrubTabProps {
  searchQuery: string;
  setSearchQuery: (val: string) => void;
  radiusKm: number;
  setRadiusKm: (val: number) => void;
  socialSubTab: 'lojas' | 'usuarios';
  setSocialSubTab: (val: 'lojas' | 'usuarios') => void;
  ofertasFilter: string;
  setOfertasFilter: React.Dispatch<
    React.SetStateAction<'todas' | 'novas' | 'favoritas' | 'cliente'>
  >;
  favoriteStoreIds: string[];
  handleToggleFavoriteStore: (id: string) => void;
  storesWithCoords: Store[];
  userCoords: { lat: number; lng: number } | null;
  orders: Order[];
  setSelectedStoreForMoments: (val: Store | null) => void;
  setShowMomentsModal: (val: boolean) => void;
  setVisitingStore: (val: Store | null) => void;
  pracaFilter: 'recentes' | 'favoritos' | 'conectados';
  setPracaFilter: (val: 'recentes' | 'favoritos' | 'conectados') => void;
  newPostText: string;
  setNewPostText: (val: string) => void;
  handlePublishPost: (e: React.FormEvent) => void;
  posts: SocialPost[];
  setPosts: React.Dispatch<React.SetStateAction<SocialPost[]>>;
  friends: Friend[];
  handleToggleFriend: (id: string) => void;
  handleToggleFavoriteFriend: (id: string) => void;
  setSelectedChatUser: (val: Friend | null) => void;
  setShowChatModal: (val: boolean) => void;
  conectadosSubTab: 'sugestoes' | 'solicitacoes';
  setConectadosSubTab: (val: 'sugestoes' | 'solicitacoes') => void;
  getSuggestions: () => Friend[];
  connectionRequests: Array<{
    id: string;
    name: string;
    avatar?: string;
    role?: string;
    bio?: string;
  }>;
  handleAcceptRequest: (req: unknown) => void;
  handleDeclineRequest: (id: string, name: string) => void;
  triggerToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
  getDistance: (
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
  ) => number;
}

type ExtendedSocialPost = SocialPost & {
  authorId?: string;
  publicationType?: 'feed' | 'status';
  taggedUsers?: string[];
  createdAt?: string;
};

interface RegisterTarget {
  id: string;
  name: string;
  avatar: string;
}

interface MarketplaceEmptyStateProps {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}

function MarketplaceEmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
}: MarketplaceEmptyStateProps) {
  return (
    <div
      role="status"
      className="rounded-3xl border border-dashed border-slate-800 bg-slate-900/45 px-5 py-10 text-center"
    >
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-800 bg-slate-950 text-orange-400">
        <Icon className="h-5 w-5" />
      </div>
      <h3 className="text-sm font-black uppercase tracking-wide text-slate-100">
        {title}
      </h3>
      <p className="mx-auto mt-2 max-w-sm text-xs leading-relaxed text-slate-500">
        {description}
      </p>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="mt-5 rounded-xl border border-orange-500/40 bg-orange-500/10 px-4 py-2 text-[10px] font-black uppercase tracking-wider text-orange-300 transition-colors hover:bg-orange-500/20"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}

function Avatar({
  src,
  name,
  className,
}: {
  src?: string;
  name: string;
  className: string;
}) {
  if (src) {
    return (
      <img
        src={src}
        alt={name}
        className={className}
        referrerPolicy="no-referrer"
      />
    );
  }

  return (
    <div
      className={`${className} flex items-center justify-center bg-slate-950 text-slate-500`}
      role="img"
      aria-label={`Foto de ${name} não informada`}
    >
      <CircleUserRound className="h-1/2 w-1/2" />
    </div>
  );
}

const matchesSearch = (value: string | undefined, search: string) =>
  Boolean(value?.toLocaleLowerCase('pt-BR').includes(search));

export function KyrubTab({
  searchQuery,
  setSearchQuery,
  radiusKm,
  setRadiusKm,
  socialSubTab,
  setSocialSubTab,
  ofertasFilter,
  setOfertasFilter,
  favoriteStoreIds,
  handleToggleFavoriteStore,
  storesWithCoords,
  userCoords,
  orders,
  setSelectedStoreForMoments,
  setShowMomentsModal,
  setVisitingStore,
  pracaFilter,
  setPracaFilter,
  newPostText,
  setNewPostText,
  posts,
  setPosts,
  friends,
  handleToggleFriend,
  handleToggleFavoriteFriend,
  setSelectedChatUser,
  setShowChatModal,
  conectadosSubTab,
  setConectadosSubTab,
  getSuggestions,
  connectionRequests,
  handleAcceptRequest,
  handleDeclineRequest,
  triggerToast,
  getDistance,
}: KyrubTabProps) {
  const [effectiveUserCoords, setEffectiveUserCoords] = useState(userCoords);
  const [isDistancePanelOpen, setIsDistancePanelOpen] = useState(false);
  const [locationStatus, setLocationStatus] = useState<
    'idle' | 'loading' | 'ready' | 'error'
  >(userCoords ? 'ready' : 'idle');
  const [postMediaUrls, setPostMediaUrls] = useState<string[]>([]);
  const [taggedUsers, setTaggedUsers] = useState<string[]>([]);
  const [isTagPickerOpen, setIsTagPickerOpen] = useState(false);
  const [selectedRegister, setSelectedRegister] =
    useState<RegisterTarget | null>(null);

  useEffect(() => {
    if (!userCoords) return;
    setEffectiveUserCoords(userCoords);
    setLocationStatus('ready');
  }, [userCoords]);

  const normalizedSearch = searchQuery.trim().toLocaleLowerCase('pt-BR');
  const currentUser = auth.currentUser;
  const currentUserName =
    currentUser?.displayName || currentUser?.email?.split('@')[0] || 'Você';
  const currentUserAvatar = currentUser?.photoURL || '';

  const requestActualLocation = () => {
    setIsDistancePanelOpen(true);

    if (!navigator.geolocation) {
      setLocationStatus('error');
      triggerToast('Seu navegador não oferece geolocalização.', 'error');
      return;
    }

    setLocationStatus('loading');
    navigator.geolocation.getCurrentPosition(
      position => {
        setEffectiveUserCoords({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
        setLocationStatus('ready');
        triggerToast('Localização atualizada com precisão do dispositivo.', 'success');
      },
      error => {
        console.warn('Geolocation request failed.', error);
        setLocationStatus('error');
        triggerToast(
          'Não foi possível acessar sua localização. Confira a permissão do navegador.',
          'error'
        );
      },
      {
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 60000,
      }
    );
  };

  const filteredStores = useMemo(() => {
    return storesWithCoords.filter(store => {
      if (normalizedSearch) {
        const matchesName = matchesSearch(store.name, normalizedSearch);
        const matchesDescription = matchesSearch(
          store.description,
          normalizedSearch
        );
        const matchesKeywords = store.keywords?.some(keyword =>
          matchesSearch(keyword, normalizedSearch)
        );

        if (!matchesName && !matchesDescription && !matchesKeywords) {
          return false;
        }
      }

      if (effectiveUserCoords) {
        if (!Number.isFinite(store.lat) || !Number.isFinite(store.lng)) {
          return false;
        }

        const distance = getDistance(
          effectiveUserCoords.lat,
          effectiveUserCoords.lng,
          store.lat as number,
          store.lng as number
        );
        if (distance > radiusKm) return false;
      }

      if (ofertasFilter === 'novas') return Boolean(store.isNew);
      if (ofertasFilter === 'favoritas') {
        return favoriteStoreIds.includes(store.id);
      }
      if (ofertasFilter === 'cliente') {
        return orders.some(order => order.storeId === store.id);
      }
      return true;
    });
  }, [
    effectiveUserCoords,
    favoriteStoreIds,
    getDistance,
    normalizedSearch,
    ofertasFilter,
    orders,
    radiusKm,
    storesWithCoords,
  ]);

  const marketplaceEmptyState: MarketplaceEmptyStateProps = (() => {
    if (storesWithCoords.length === 0) {
      return {
        icon: StoreIcon,
        title: 'O marketplace ainda está sendo formado',
        description:
          'As lojas aparecerão aqui quando seus proprietários publicarem vitrines reais no Kyrub.',
      };
    }

    if (normalizedSearch) {
      return {
        icon: SearchX,
        title: 'Nenhuma loja encontrada',
        description: `Não encontramos resultados para “${searchQuery.trim()}”. Tente outro nome, produto ou categoria.`,
        actionLabel: 'Limpar busca',
        onAction: () => setSearchQuery(''),
      };
    }

    if (effectiveUserCoords) {
      return {
        icon: MapPin,
        title: `Nenhuma loja em até ${radiusKm} km`,
        description:
          radiusKm < 50
            ? 'Amplie o raio de busca para descobrir vitrines publicadas em outras regiões.'
            : 'Ainda não há vitrines com localização cadastrada dentro do maior raio disponível.',
        actionLabel: radiusKm < 50 ? 'Buscar em até 50 km' : undefined,
        onAction: radiusKm < 50 ? () => setRadiusKm(50) : undefined,
      };
    }

    if (ofertasFilter !== 'todas') {
      return {
        icon: Heart,
        title: 'Nenhum resultado para este filtro',
        description:
          'Altere o filtro para continuar explorando as vitrines publicadas.',
        actionLabel: 'Ver todas as lojas',
        onAction: () => setOfertasFilter('todas'),
      };
    }

    return {
      icon: SearchX,
      title: 'Nenhuma oferta disponível',
      description:
        'Ajuste os filtros ou volte mais tarde para conferir novas vitrines publicadas.',
    };
  })();

  const connectedFriends = useMemo(
    () =>
      friends.filter(friend => {
        if (!friend.added || friend.isProfileVisible === false) return false;
        if (!normalizedSearch) return true;
        return (
          matchesSearch(friend.name, normalizedSearch) ||
          matchesSearch(friend.role, normalizedSearch) ||
          matchesSearch(friend.bio, normalizedSearch)
        );
      }),
    [friends, normalizedSearch]
  );

  const suggestions = useMemo(
    () =>
      getSuggestions().filter(friend => {
        if (!normalizedSearch) return true;
        return (
          matchesSearch(friend.name, normalizedSearch) ||
          matchesSearch(friend.role, normalizedSearch) ||
          matchesSearch(friend.bio, normalizedSearch)
        );
      }),
    [getSuggestions, normalizedSearch]
  );

  const feedPosts = useMemo(() => {
    return (posts as ExtendedSocialPost[]).filter(post => {
      if (post.publicationType === 'status') return false;

      if (normalizedSearch) {
        const matchesPost =
          matchesSearch(post.user, normalizedSearch) ||
          matchesSearch(post.content, normalizedSearch) ||
          post.taggedUsers?.some(user => matchesSearch(user, normalizedSearch));
        if (!matchesPost) return false;
      }

      if (pracaFilter === 'favoritos') {
        if (
          post.authorId === currentUser?.uid ||
          post.user === currentUserName ||
          post.user.includes('Você')
        ) {
          return true;
        }
        const friend = friends.find(
          item => item.id === post.authorId || item.name === post.user
        );
        return Boolean(friend?.favorited);
      }

      return true;
    });
  }, [
    currentUser?.uid,
    currentUserName,
    friends,
    normalizedSearch,
    posts,
    pracaFilter,
  ]);

  const readPostImages = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length === 0) return;

    const remainingSlots = 9 - postMediaUrls.length;
    if (remainingSlots <= 0) {
      triggerToast('O carrossel aceita no máximo 9 imagens.', 'info');
      return;
    }

    const selectedFiles = files
      .filter(file => file.type.startsWith('image/'))
      .slice(0, remainingSlots);

    if (selectedFiles.length < files.length) {
      triggerToast(
        'Foram adicionadas apenas imagens até o limite de 9 arquivos.',
        'info'
      );
    }

    const encodedImages = await Promise.all(
      selectedFiles.map(
        file =>
          new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(file);
          })
      )
    );

    setPostMediaUrls(current => [...current, ...encodedImages].slice(0, 9));
  };

  const publishPost = (publicationType: 'feed' | 'status') => {
    const content = newPostText.trim();
    if (!content && postMediaUrls.length === 0) {
      triggerToast('Escreva algo ou adicione imagens antes de publicar.', 'info');
      return;
    }

    const newPost: ExtendedSocialPost = {
      id: `${publicationType}-${Date.now()}`,
      authorId: currentUser?.uid,
      user: currentUserName,
      avatar: currentUserAvatar,
      time: 'Agora mesmo',
      createdAt: new Date().toISOString(),
      content,
      likes: 0,
      mediaUrls: postMediaUrls,
      taggedUsers,
      publicationType,
    };

    setPosts(current => [newPost, ...current]);
    setNewPostText('');
    setPostMediaUrls([]);
    setTaggedUsers([]);
    setIsTagPickerOpen(false);
    triggerToast(
      publicationType === 'feed'
        ? 'Publicação enviada para o feed da Praça.'
        : 'Status publicado para seus contatos conectados.',
      'success'
    );
  };

  const toggleTaggedUser = (friendName: string) => {
    setTaggedUsers(current =>
      current.includes(friendName)
        ? current.filter(name => name !== friendName)
        : [...current, friendName]
    );
  };

  const openOwnRegister = () => {
    setSelectedRegister({
      id: currentUser?.uid || 'current-user',
      name: currentUserName,
      avatar: currentUserAvatar,
    });
  };

  const registerPosts = useMemo(() => {
    if (!selectedRegister) return [];

    return (posts as ExtendedSocialPost[]).filter(post => {
      if (post.authorId && post.authorId === selectedRegister.id) return true;
      if (post.user === selectedRegister.name) return true;
      return (
        selectedRegister.id === (currentUser?.uid || 'current-user') &&
        post.user.includes('Você')
      );
    });
  }, [currentUser?.uid, posts, selectedRegister]);

  return (
    <div className="space-y-5 animate-fade-in" id="kyrub-tab-container">
      <section className="space-y-3 rounded-3xl border border-slate-800 bg-slate-900 p-4">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={requestActualLocation}
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border transition-colors ${
              locationStatus === 'ready'
                ? 'border-orange-500/50 bg-orange-500/15 text-orange-400'
                : locationStatus === 'error'
                  ? 'border-red-500/40 bg-red-500/10 text-red-400'
                  : 'border-slate-800 bg-slate-950 text-slate-500 hover:text-orange-400'
            }`}
            title="Usar localização atual e ajustar distância"
            aria-label="Filtro de distância"
            id="distance-filter-trigger"
          >
            {locationStatus === 'loading' ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <LocateFixed className="h-4 w-4" />
            )}
          </button>

          <div className="relative min-w-0 flex-1">
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              type="search"
              placeholder="Buscar lojas, produtos ou usuários..."
              value={searchQuery}
              onChange={event => setSearchQuery(event.target.value)}
              className="w-full rounded-xl border border-slate-800 bg-slate-950 py-2.5 pl-10 pr-9 text-xs text-white outline-none transition-colors focus:border-orange-500/60"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"
                title="Limpar busca"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {isDistancePanelOpen && (
          <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <span className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-slate-300">
                  <MapPin className="h-3.5 w-3.5 text-orange-400" />
                  Distância
                </span>
                <p className="mt-1 text-[9px] text-slate-500">
                  {locationStatus === 'ready'
                    ? 'Localização ativa. Lojas sem coordenadas não entram no resultado.'
                    : 'Autorize sua localização para filtrar as vitrines próximas.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsDistancePanelOpen(false)}
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-900 hover:text-white"
                title="Fechar filtro"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="mt-3 flex items-center gap-3">
              <input
                type="range"
                min="1"
                max="50"
                value={radiusKm}
                onChange={event => setRadiusKm(Number(event.target.value))}
                className="h-1 flex-1 cursor-pointer appearance-none rounded-lg bg-slate-800 accent-orange-500"
                aria-label="Raio de distância em quilômetros"
              />
              <span className="w-12 text-right font-mono text-[10px] font-black text-orange-400">
                {radiusKm} KM
              </span>
            </div>
          </div>
        )}

        <div className="flex border-b border-slate-800" id="social-tabs">
          <button
            type="button"
            onClick={() => setSocialSubTab('lojas')}
            className={`flex-1 border-b-2 pb-2.5 text-xs font-black uppercase tracking-wider transition-all ${
              socialSubTab === 'lojas'
                ? 'border-orange-500 text-white'
                : 'border-transparent text-slate-500 hover:text-slate-300'
            }`}
          >
            Ofertas
          </button>
          <button
            type="button"
            onClick={() => setSocialSubTab('usuarios')}
            className={`flex-1 border-b-2 pb-2.5 text-xs font-black uppercase tracking-wider transition-all ${
              socialSubTab === 'usuarios'
                ? 'border-orange-500 text-white'
                : 'border-transparent text-slate-500 hover:text-slate-300'
            }`}
          >
            Praça
          </button>
        </div>
      </section>

      {socialSubTab === 'lojas' && (
        <div className="space-y-4 animate-fade-in">
          <div className="flex items-center justify-around rounded-2xl border border-slate-800/80 bg-slate-900/60 p-3">
            {[
              { id: 'novas', label: 'Novas' },
              { id: 'favoritas', label: 'Favoritas' },
              { id: 'cliente', label: 'Cliente' },
            ].map(filter => (
              <button
                type="button"
                key={filter.id}
                onClick={() =>
                  setOfertasFilter(
                    ofertasFilter === filter.id
                      ? 'todas'
                      : (filter.id as 'novas' | 'favoritas' | 'cliente')
                  )
                }
                className={`rounded-full border px-3 py-2 text-[10px] font-bold uppercase transition-all ${
                  ofertasFilter === filter.id
                    ? 'border-orange-500 bg-orange-500/20 text-orange-400'
                    : 'border-slate-800 bg-slate-950 text-slate-400 hover:text-white'
                }`}
              >
                {filter.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2 sm:gap-3">
            {filteredStores.map(store => {
              const hasValidCoords =
                Number.isFinite(store.lat) && Number.isFinite(store.lng);
              const distance =
                effectiveUserCoords && hasValidCoords
                  ? getDistance(
                      effectiveUserCoords.lat,
                      effectiveUserCoords.lng,
                      store.lat as number,
                      store.lng as number
                    )
                  : null;

              return (
                <article
                  key={store.id}
                  className="group relative flex h-[156px] flex-col justify-between overflow-hidden rounded-3xl border border-slate-800 bg-slate-950 shadow-xl transition-all hover:border-slate-700"
                >
                  <StoreOfferCarousel images={store.offerImages} />

                  <div className="absolute inset-x-0 top-0 z-10 flex items-start justify-between p-2">
                    <div className="relative h-9 w-9 shrink-0">
                      {store.logo ? (
                        <img
                          src={store.logo}
                          alt={store.name}
                          className="h-9 w-9 rounded-xl border border-slate-800 bg-slate-900 object-cover shadow-md"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-800 bg-slate-900 text-slate-500 shadow-md">
                          <StoreIcon className="h-4 w-4" />
                        </div>
                      )}
                      <span
                        className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border border-slate-950 ${
                          store.status === 'open'
                            ? 'bg-emerald-500'
                            : store.status === 'delayed'
                              ? 'bg-amber-500'
                              : 'bg-slate-500'
                        }`}
                      />
                    </div>

                    <button
                      type="button"
                      onClick={() => handleToggleFavoriteStore(store.id)}
                      className="rounded-full border border-slate-800/80 bg-slate-950/85 p-1.5 backdrop-blur-md transition-transform hover:scale-110"
                      title="Favoritar loja"
                    >
                      <Heart
                        className={`h-3 w-3 ${
                          favoriteStoreIds.includes(store.id)
                            ? 'fill-red-500 text-red-500'
                            : 'text-slate-400'
                        }`}
                      />
                    </button>
                  </div>

                  <div className="relative z-10 mt-auto bg-gradient-to-t from-slate-950 via-slate-950/95 to-transparent p-2">
                    <h3 className="truncate text-[13px] font-black uppercase tracking-wider text-white">
                      {store.name}
                    </h3>
                    <p className="mb-1 line-clamp-1 text-[8.5px] leading-none text-slate-400">
                      {store.description}
                    </p>
                    <div className="flex items-center justify-between gap-1 font-mono text-[8px] text-slate-400">
                      <span className="shrink-0 font-bold">
                        {distance !== null
                          ? `📍 ${distance.toFixed(1)} KM`
                          : '📍 Localização não informada'}
                      </span>
                    </div>
                  </div>

                  <div className="relative z-10 grid grid-cols-2 border-t border-slate-800 bg-slate-950/95">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedStoreForMoments(store);
                        setShowMomentsModal(true);
                      }}
                      className="border-r border-slate-800 py-1.5 text-center font-mono text-[8.5px] font-black uppercase tracking-widest text-slate-400 hover:bg-slate-900 hover:text-white"
                    >
                      Momentos
                    </button>
                    <button
                      type="button"
                      onClick={() => setVisitingStore(store)}
                      className="py-1.5 text-center font-mono text-[8.5px] font-black uppercase tracking-widest text-teal-400 hover:bg-slate-900 hover:text-teal-300"
                    >
                      Entrar
                    </button>
                  </div>
                </article>
              );
            })}
          </div>

          {filteredStores.length === 0 && (
            <MarketplaceEmptyState {...marketplaceEmptyState} />
          )}
        </div>
      )}

      {socialSubTab === 'usuarios' && (
        <div className="space-y-5 animate-fade-in">
          <div className="flex gap-1 rounded-2xl border border-slate-800 bg-slate-900/80 p-1 shadow-lg">
            {[
              { id: 'recentes', label: 'Recentes' },
              { id: 'favoritos', label: 'Favoritos' },
              { id: 'conectados', label: 'Conectados' },
            ].map(filter => (
              <button
                type="button"
                key={filter.id}
                onClick={() =>
                  setPracaFilter(
                    filter.id as 'recentes' | 'favoritos' | 'conectados'
                  )
                }
                className={`flex-1 rounded-xl py-2 text-[10px] font-black uppercase tracking-wider transition-all ${
                  pracaFilter === filter.id
                    ? 'bg-orange-600 text-white shadow-lg shadow-orange-600/10'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {filter.label}
              </button>
            ))}
          </div>

          {(pracaFilter === 'recentes' || pracaFilter === 'favoritos') && (
            <div className="space-y-4">
              {pracaFilter === 'recentes' && (
                <section className="space-y-3 rounded-3xl border border-slate-800/80 bg-slate-900 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Avatar
                        src={currentUserAvatar}
                        name={currentUserName}
                        className="h-9 w-9 rounded-full border border-slate-800 object-cover"
                      />
                      <div>
                        <span className="block text-[10px] font-black text-white">
                          {currentUserName}
                        </span>
                        <span className="text-[8px] font-mono uppercase text-slate-500">
                          Nova publicação
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={openOwnRegister}
                      className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-800 bg-slate-950 text-slate-400 hover:border-orange-500/40 hover:text-orange-400"
                      title="Meu registro de publicações"
                      aria-label="Abrir meu registro de publicações"
                    >
                      <CircleUserRound className="h-4 w-4" />
                    </button>
                  </div>

                  <textarea
                    value={newPostText}
                    onChange={event => setNewPostText(event.target.value)}
                    placeholder="O que está acontecendo no seu negócio ou região?"
                    className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white outline-none focus:border-orange-500"
                    rows={3}
                  />

                  {postMediaUrls.length > 0 && (
                    <div className="grid grid-cols-3 gap-2 rounded-2xl border border-slate-800 bg-slate-950 p-2">
                      {postMediaUrls.map((url, index) => (
                        <div
                          key={`${url.slice(0, 32)}-${index}`}
                          className="relative aspect-square overflow-hidden rounded-xl border border-slate-800"
                        >
                          <img
                            src={url}
                            alt={`Imagem ${index + 1} da publicação`}
                            className="h-full w-full object-cover"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              setPostMediaUrls(current =>
                                current.filter((_, itemIndex) => itemIndex !== index)
                              )
                            }
                            className="absolute right-1 top-1 rounded-full bg-slate-950/90 p-1 text-white"
                            title="Remover imagem"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {taggedUsers.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {taggedUsers.map(name => (
                        <button
                          type="button"
                          key={name}
                          onClick={() => toggleTaggedUser(name)}
                          className="flex items-center gap-1 rounded-full border border-teal-500/30 bg-teal-500/10 px-2 py-1 text-[9px] font-bold text-teal-300"
                          title="Remover marcação"
                        >
                          @{name}
                          <X className="h-2.5 w-2.5" />
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="relative flex flex-wrap items-center justify-between gap-2 border-t border-slate-800/70 pt-3">
                    <div className="flex items-center gap-2">
                      <label
                        className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-xl border border-slate-800 bg-slate-950 text-slate-400 hover:text-orange-400"
                        title="Adicionar até 9 imagens"
                      >
                        <ImagePlus className="h-4 w-4" />
                        <input
                          type="file"
                          accept="image/*"
                          multiple
                          className="hidden"
                          onChange={readPostImages}
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => setIsTagPickerOpen(current => !current)}
                        className={`flex h-9 w-9 items-center justify-center rounded-xl border bg-slate-950 transition-colors ${
                          isTagPickerOpen || taggedUsers.length > 0
                            ? 'border-teal-500/40 text-teal-400'
                            : 'border-slate-800 text-slate-400 hover:text-teal-400'
                        }`}
                        title="Marcar usuários"
                      >
                        <AtSign className="h-4 w-4" />
                      </button>
                      <span className="font-mono text-[8px] text-slate-500">
                        {postMediaUrls.length}/9
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => publishPost('status')}
                        className="flex items-center gap-1.5 rounded-xl border border-teal-500/30 bg-teal-500/10 px-3 py-2 text-[9px] font-black uppercase text-teal-300 hover:bg-teal-500/20"
                      >
                        <Clock3 className="h-3.5 w-3.5" />
                        Status
                      </button>
                      <button
                        type="button"
                        onClick={() => publishPost('feed')}
                        className="flex items-center gap-1.5 rounded-xl bg-orange-600 px-3 py-2 text-[9px] font-black uppercase text-white hover:bg-orange-500"
                      >
                        <Send className="h-3.5 w-3.5" />
                        Feed
                      </button>
                    </div>

                    {isTagPickerOpen && (
                      <div className="absolute left-0 right-0 top-full z-20 mt-2 max-h-52 overflow-y-auto rounded-2xl border border-slate-800 bg-slate-950 p-2 shadow-2xl">
                        {friends.filter(friend => friend.isProfileVisible !== false)
                          .length === 0 ? (
                          <p className="p-3 text-center text-[10px] text-slate-500">
                            Nenhum usuário disponível para marcação.
                          </p>
                        ) : (
                          friends
                            .filter(friend => friend.isProfileVisible !== false)
                            .map(friend => (
                              <button
                                type="button"
                                key={friend.id}
                                onClick={() => toggleTaggedUser(friend.name)}
                                className="flex w-full items-center justify-between gap-3 rounded-xl px-2 py-2 text-left hover:bg-slate-900"
                              >
                                <span className="flex min-w-0 items-center gap-2">
                                  <Avatar
                                    src={friend.avatar}
                                    name={friend.name}
                                    className="h-7 w-7 shrink-0 rounded-full border border-slate-800 object-cover"
                                  />
                                  <span className="truncate text-[10px] font-bold text-slate-300">
                                    {friend.name}
                                  </span>
                                </span>
                                <span className="text-[9px] font-mono text-teal-400">
                                  {taggedUsers.includes(friend.name)
                                    ? 'Marcado'
                                    : 'Marcar'}
                                </span>
                              </button>
                            ))
                        )}
                      </div>
                    )}
                  </div>
                </section>
              )}

              <div className="space-y-4">
                {feedPosts.map(post => (
                  <article
                    key={post.id}
                    className="space-y-3 rounded-2xl border border-slate-800/80 bg-slate-900 p-4"
                  >
                    <div className="flex items-center gap-3">
                      <Avatar
                        src={post.avatar}
                        name={post.user}
                        className="h-9 w-9 rounded-full border border-slate-800 object-cover"
                      />
                      <div className="min-w-0">
                        <h4 className="truncate text-xs font-bold text-slate-200">
                          {post.user}
                        </h4>
                        <span className="font-mono text-[9px] text-slate-500">
                          {post.time}
                        </span>
                      </div>
                    </div>

                    {post.content && (
                      <p className="whitespace-pre-line text-xs leading-relaxed text-slate-300">
                        {post.content}
                      </p>
                    )}

                    {post.taggedUsers && post.taggedUsers.length > 0 && (
                      <p className="text-[9px] font-mono text-teal-400">
                        com {post.taggedUsers.map(name => `@${name}`).join(', ')}
                      </p>
                    )}

                    {post.mediaUrls && post.mediaUrls.length > 0 && (
                      <MediaCarousel mediaUrls={post.mediaUrls} />
                    )}

                    <div className="flex items-center justify-between border-t border-slate-800/60 pt-2.5 font-mono text-[10px] text-slate-500">
                      <button
                        type="button"
                        onClick={() => {
                          setPosts(current =>
                            current.map(item =>
                              item.id === post.id
                                ? { ...item, likes: item.likes + 1 }
                                : item
                            )
                          );
                          triggerToast('Publicação curtida!', 'success');
                        }}
                        className="flex items-center gap-1.5 hover:text-white"
                      >
                        <ThumbsUp className="h-3.5 w-3.5 text-orange-500" />
                        {post.likes} curtidas
                      </button>
                      <span className="text-[9px] text-orange-400">Feed Kyrub</span>
                    </div>
                  </article>
                ))}

                {feedPosts.length === 0 && (
                  <div className="py-12 text-center text-xs text-slate-500">
                    Nenhuma publicação encontrada para os filtros selecionados.
                  </div>
                )}
              </div>
            </div>
          )}

          {pracaFilter === 'conectados' && (
            <div className="space-y-6">
              <section className="space-y-3">
                <h4 className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-slate-400">
                  <span className="h-2 w-2 rounded-full bg-teal-500" />
                  Contatos conectados ({connectedFriends.length})
                </h4>

                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                  {connectedFriends.map(friend => {
                    const friendStatuses = (posts as ExtendedSocialPost[]).filter(
                      post =>
                        post.publicationType === 'status' &&
                        (post.authorId === friend.id || post.user === friend.name)
                    );
                    const latestStatus = friendStatuses[0];

                    return (
                      <article
                        key={friend.id}
                        className="flex min-w-0 flex-col justify-between gap-3 rounded-3xl border border-slate-800 bg-slate-900 p-3 transition-colors hover:border-slate-700"
                      >
                        <button
                          type="button"
                          onClick={() =>
                            setSelectedRegister({
                              id: friend.id,
                              name: friend.name,
                              avatar: friend.avatar,
                            })
                          }
                          className="text-left"
                          title={`Ver registro de ${friend.name}`}
                        >
                          <div className="relative mx-auto w-fit">
                            <Avatar
                              src={friend.avatar}
                              name={friend.name}
                              className={`h-14 w-14 rounded-full border-2 object-cover ${
                                latestStatus
                                  ? 'border-orange-500'
                                  : 'border-slate-800'
                              }`}
                            />
                            <span className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full border-2 border-slate-900 bg-slate-950 text-orange-400">
                              <CircleUserRound className="h-3 w-3" />
                            </span>
                          </div>
                          <h5 className="mt-2 truncate text-center text-[10px] font-black uppercase text-white">
                            {friend.name}
                          </h5>
                          <p className="truncate text-center font-mono text-[8px] uppercase text-slate-500">
                            {friend.role}
                          </p>
                        </button>

                        {latestStatus ? (
                          <div className="rounded-xl border border-orange-500/20 bg-orange-500/5 p-2">
                            <span className="block text-[8px] font-black uppercase text-orange-400">
                              Status
                            </span>
                            <p className="mt-1 line-clamp-2 text-[9px] leading-relaxed text-slate-300">
                              {latestStatus.content || 'Publicou novas imagens.'}
                            </p>
                            {latestStatus.mediaUrls?.[0] && (
                              <img
                                src={latestStatus.mediaUrls[0]}
                                alt="Prévia do status"
                                className="mt-2 aspect-video w-full rounded-lg object-cover"
                              />
                            )}
                          </div>
                        ) : (
                          <p className="line-clamp-2 min-h-8 text-center text-[9px] italic leading-relaxed text-slate-500">
                            {friend.bio || 'Sem status publicado.'}
                          </p>
                        )}

                        <div className="grid grid-cols-2 gap-1.5 border-t border-slate-800/70 pt-2">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedRegister({
                                id: friend.id,
                                name: friend.name,
                                avatar: friend.avatar,
                              });
                            }}
                            className="flex items-center justify-center gap-1 rounded-lg border border-slate-800 bg-slate-950 px-1 py-1.5 text-[8px] font-black uppercase text-slate-300 hover:text-orange-400"
                            title="Registro de publicações"
                          >
                            <CircleUserRound className="h-3 w-3" />
                            Registro
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedChatUser(friend);
                              setShowChatModal(true);
                            }}
                            className="flex items-center justify-center gap-1 rounded-lg bg-orange-600 px-1 py-1.5 text-[8px] font-black uppercase text-white hover:bg-orange-500"
                          >
                            <MessageCircle className="h-3 w-3" />
                            Chat
                          </button>
                          <button
                            type="button"
                            onClick={() => handleToggleFavoriteFriend(friend.id)}
                            className={`flex items-center justify-center gap-1 rounded-lg border px-1 py-1.5 text-[8px] font-black uppercase ${
                              friend.favorited
                                ? 'border-amber-500/30 bg-amber-500/10 text-amber-400'
                                : 'border-slate-800 bg-slate-950 text-slate-400'
                            }`}
                          >
                            <Star className="h-3 w-3" />
                            {friend.favorited ? 'Favorito' : 'Favoritar'}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleToggleFriend(friend.id)}
                            className="flex items-center justify-center gap-1 rounded-lg border border-red-500/20 bg-red-500/10 px-1 py-1.5 text-[8px] font-black uppercase text-red-400"
                          >
                            <UserMinus className="h-3 w-3" />
                            Remover
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>

                {connectedFriends.length === 0 && (
                  <div className="rounded-2xl border border-slate-900/60 bg-slate-900/40 py-6 text-center text-xs italic text-slate-500">
                    Você ainda não possui contatos ativos na rede.
                  </div>
                )}
              </section>

              <section className="space-y-4 border-t border-slate-900 pt-4">
                <div className="flex gap-4 border-b border-slate-800/80">
                  <button
                    type="button"
                    onClick={() => setConectadosSubTab('sugestoes')}
                    className={`border-b-2 pb-2 text-xs font-black uppercase tracking-wider ${
                      conectadosSubTab === 'sugestoes'
                        ? 'border-orange-500 text-white'
                        : 'border-transparent text-slate-500'
                    }`}
                  >
                    Sugestões ({suggestions.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setConectadosSubTab('solicitacoes')}
                    className={`border-b-2 pb-2 text-xs font-black uppercase tracking-wider ${
                      conectadosSubTab === 'solicitacoes'
                        ? 'border-orange-500 text-white'
                        : 'border-transparent text-slate-500'
                    }`}
                  >
                    Solicitações ({connectionRequests.length})
                  </button>
                </div>

                {conectadosSubTab === 'sugestoes' && (
                  <div className="space-y-3">
                    {suggestions.map(friend => (
                      <article
                        key={friend.id}
                        className="flex items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-3"
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <Avatar
                            src={friend.avatar}
                            name={friend.name}
                            className="h-11 w-11 shrink-0 rounded-full border border-slate-800 object-cover"
                          />
                          <div className="min-w-0">
                            <h5 className="truncate text-xs font-black uppercase text-white">
                              {friend.name}
                            </h5>
                            <p className="truncate text-[9px] text-slate-500">
                              {friend.bio || friend.role}
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleToggleFriend(friend.id)}
                          className={`shrink-0 rounded-xl px-3 py-2 text-[9px] font-black uppercase ${
                            friend.connectionStatus === 'pending_sent'
                              ? 'border border-slate-700 bg-slate-800 text-slate-300'
                              : 'bg-teal-500 text-slate-950'
                          }`}
                        >
                          {friend.connectionStatus === 'pending_sent'
                            ? 'Cancelar'
                            : 'Conectar'}
                        </button>
                      </article>
                    ))}

                    {suggestions.length === 0 && (
                      <div className="rounded-2xl border border-slate-900/60 bg-slate-900/40 py-6 text-center text-xs italic text-slate-500">
                        Nenhuma sugestão pública disponível no momento.
                      </div>
                    )}
                  </div>
                )}

                {conectadosSubTab === 'solicitacoes' && (
                  <div className="space-y-3">
                    {connectionRequests.map(request => (
                      <article
                        key={request.id}
                        className="rounded-2xl border border-slate-800 bg-slate-900 p-3"
                      >
                        <div className="flex items-center gap-3">
                          <Avatar
                            src={request.avatar}
                            name={request.name}
                            className="h-11 w-11 shrink-0 rounded-full border border-slate-800 object-cover"
                          />
                          <div className="min-w-0">
                            <h5 className="truncate text-xs font-black uppercase text-white">
                              {request.name}
                            </h5>
                            <p className="truncate text-[9px] text-slate-500">
                              {request.bio || request.role || 'Usuário Kyrub'}
                            </p>
                          </div>
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() => handleAcceptRequest(request)}
                            className="rounded-xl bg-emerald-600 py-2 text-[9px] font-black uppercase text-white"
                          >
                            Aceitar
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              handleDeclineRequest(request.id, request.name)
                            }
                            className="rounded-xl border border-slate-800 bg-slate-950 py-2 text-[9px] font-black uppercase text-slate-400"
                          >
                            Recusar
                          </button>
                        </div>
                      </article>
                    ))}

                    {connectionRequests.length === 0 && (
                      <div className="rounded-2xl border border-slate-900/60 bg-slate-900/40 py-8 text-center text-xs italic text-slate-500">
                        Nenhuma solicitação de conexão pendente.
                      </div>
                    )}
                  </div>
                )}
              </section>
            </div>
          )}
        </div>
      )}

      {selectedRegister && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/85 p-0 backdrop-blur-sm sm:items-center sm:p-4">
          <section className="flex max-h-[88dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl border border-slate-800 bg-slate-900 shadow-2xl sm:rounded-3xl">
            <header className="flex items-center justify-between gap-3 border-b border-slate-800 p-4">
              <div className="flex min-w-0 items-center gap-3">
                <Avatar
                  src={selectedRegister.avatar}
                  name={selectedRegister.name}
                  className="h-11 w-11 shrink-0 rounded-full border border-slate-800 object-cover"
                />
                <div className="min-w-0">
                  <span className="block font-mono text-[8px] font-black uppercase tracking-wider text-orange-400">
                    Registro de publicações
                  </span>
                  <h3 className="truncate text-sm font-black uppercase text-white">
                    {selectedRegister.name}
                  </h3>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedRegister(null)}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-800 bg-slate-950 text-slate-400 hover:text-white"
                title="Fechar registro"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              {registerPosts.map(post => (
                <article
                  key={post.id}
                  className="space-y-2 rounded-2xl border border-slate-800 bg-slate-950 p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`rounded-full px-2 py-1 font-mono text-[8px] font-black uppercase ${
                        post.publicationType === 'status'
                          ? 'bg-teal-500/10 text-teal-400'
                          : 'bg-orange-500/10 text-orange-400'
                      }`}
                    >
                      {post.publicationType === 'status' ? 'Status' : 'Feed'}
                    </span>
                    <span className="font-mono text-[8px] text-slate-500">
                      {post.time}
                    </span>
                  </div>
                  {post.content && (
                    <p className="whitespace-pre-line text-[11px] leading-relaxed text-slate-300">
                      {post.content}
                    </p>
                  )}
                  {post.mediaUrls && post.mediaUrls.length > 0 && (
                    <MediaCarousel mediaUrls={post.mediaUrls} />
                  )}
                </article>
              ))}

              {registerPosts.length === 0 && (
                <div className="py-12 text-center">
                  <Users className="mx-auto h-8 w-8 text-slate-700" />
                  <p className="mt-3 text-xs text-slate-500">
                    Este usuário ainda não possui publicações registradas.
                  </p>
                </div>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
