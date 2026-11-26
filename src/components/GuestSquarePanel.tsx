import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, Heart, MessageCircle, Users } from 'lucide-react';
import type { Store } from '../types';
import { SquareDirectoryLayout } from './SquareDirectoryLayout';
import { CommunityCardBackdrop } from './CommunityCardBackdrop';
import { InfiniteScrollTrigger } from './InfiniteScrollTrigger';
import { useInfiniteCursor } from '../hooks/useInfiniteCursor';
import { SquareStoresSection } from './tabs/SquareStoresSection';

interface PublicSquareStore {
  id: string;
  slug: string;
  name: string;
  description: string;
  logo: string;
  banner: string;
  bannerImages?: string[];
  keywords: string[];
}

interface PublicSquareCommunity {
  id: string;
  name: string;
  description: string;
  category: string;
  coverImage: string;
  visibility: 'public' | 'moderated';
  memberCount: number;
}

interface PublicSquarePost {
  id: string;
  authorName: string;
  authorAvatar: string;
  content: string;
  mediaUrls: string[];
  createdAt: string;
  publicationType: 'feed' | 'status';
  kind: 'social' | 'community';
  communityName?: string;
}

interface PublicSquareData {
  stores: PublicSquareStore[];
  offerStoreIds: string[];
  communities: PublicSquareCommunity[];
  posts: PublicSquarePost[];
}

const initial: PublicSquareData = {
  stores: [], offerStoreIds: [], communities: [], posts: [],
};

const toStore = (store: PublicSquareStore): Store => ({
  id: store.id,
  name: store.name,
  slug: store.slug,
  description: store.description,
  logo: store.logo,
  banner: store.banner,
  bannerImages: store.bannerImages,
  primaryColor: '',
  plan: 'free',
  ownerEmail: '',
  keywords: store.keywords,
});

const viewPublicStore = (store: Store): void => {
  if (!/^[a-z0-9-]+$/.test(store.slug)) return;
  window.location.assign('/@' + encodeURIComponent(store.slug));
};

const dateLabel = (value: string): string => {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
    : '';
};

/**
 * The same Praça sections are available to visitors with strictly public
 * projections. Interactions stay behind login; this component never writes
 * Firestore records or mounts authenticated social listeners.
 */
export function GuestSquarePanel({ onLoginRequired }: { onLoginRequired: (reason: string) => void }) {
  const [data, setData] = useState<PublicSquareData>(initial);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [storeCatalogOpen, setStoreCatalogOpen] = useState(false);
  const [communityCatalogOpen, setCommunityCatalogOpen] = useState(false);
  const readCommunityPage = useCallback(async (cursor: string | null, signal: AbortSignal) => {
    const params = new URLSearchParams();
    if (cursor) params.set('cursor', cursor);
    const response = await fetch('/api/square/communities?' + params.toString(), {
      cache: 'no-store',
      headers: { accept: 'application/json' },
      signal,
    });
    if (!response.ok) throw Error('PUBLIC_COMMUNITY_PAGE_UNAVAILABLE');
    const payload = await response.json() as {
      communities?: PublicSquareCommunity[];
      nextCursor?: string | null;
    };
    if (!Array.isArray(payload.communities) ||
        (payload.nextCursor !== null && typeof payload.nextCursor !== 'string')) {
      throw Error('INVALID_PUBLIC_COMMUNITY_PAGE');
    }
    return {
      items: payload.communities.filter(item =>
        Boolean(item && /^[A-Za-z0-9_-]{1,128}$/.test(item.id) &&
          (item.visibility === 'public' || item.visibility === 'moderated'))),
      nextCursor: payload.nextCursor ?? null,
    };
  }, []);
  const communityPage = useInfiniteCursor(communityCatalogOpen, 'guest-public', readCommunityPage);
  const [communitySearch, setCommunitySearch] = useState('');
  const [communityCategory, setCommunityCategory] = useState('all');
  const [selectedCommunity, setSelectedCommunity] = useState<PublicSquareCommunity | null>(null);
  const [showAllPosts, setShowAllPosts] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/square/public', {
      signal: controller.signal,
      cache: 'no-store',
      headers: { accept: 'application/json' },
    }).then(async response => {
      if (!response.ok) throw Error('PUBLIC_SQUARE_UNAVAILABLE');
      return response.json() as Promise<Partial<PublicSquareData>>;
    }).then(payload => {
      if (controller.signal.aborted) return;
      setData({
        stores: Array.isArray(payload.stores) ? payload.stores : [],
        offerStoreIds: Array.isArray(payload.offerStoreIds) ? payload.offerStoreIds : [],
        communities: Array.isArray(payload.communities) ? payload.communities : [],
        posts: Array.isArray(payload.posts) ? payload.posts : [],
      });
    }).catch(() => {
      if (!controller.signal.aborted) setError('Não foi possível carregar todas as publicações da Praça. Tente novamente.');
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, []);

  const requireLogin = (reason: string) => {
    setStoreCatalogOpen(false);
    setCommunityCatalogOpen(false);
    setSelectedCommunity(null);
    onLoginRequired(reason);
  };

  const stores = useMemo(() => data.stores.map(toStore), [data.stores]);
  const categories = useMemo(
    () => [...new Set(communityPage.items.map(community => community.category).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'pt-BR')),
    [communityPage.items],
  );
  const filteredCommunities = useMemo(() => {
    const search = communitySearch.trim().toLocaleLowerCase('pt-BR');
    return communityPage.items.filter(community =>
      (communityCategory === 'all' || community.category === communityCategory) &&
      (!search || [community.name, community.description, community.category]
        .join(' ').toLocaleLowerCase('pt-BR').includes(search))
    );
  }, [communityPage.items, communitySearch, communityCategory]);
  const feed = useMemo(
    () => data.posts.filter(post => post.publicationType !== 'status' ||
      (Date.now() - Date.parse(post.createdAt) < 86_400_000)),
    [data.posts],
  );

  const communityCard = (community: PublicSquareCommunity, catalog: boolean) => (
    <article key={community.id} className={`relative isolate flex min-h-[320px] min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 ${catalog ? '' : 'w-[206px] shrink-0'}`}>
      <CommunityCardBackdrop coverImage={community.coverImage} />
      <div className="relative z-10 flex min-h-0 flex-1 flex-col justify-end px-3 pb-3 pt-16">
        <strong className="block line-clamp-2 text-sm font-black text-white drop-shadow-sm">{community.name}</strong>
        <p className="mt-1 text-xs text-slate-200">{community.category || 'Comunidade'} · {community.memberCount} {community.memberCount === 1 ? 'participante' : 'participantes'}</p>
        <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-100/90">{community.description}</p>
      </div>
      <div className={`relative z-10 grid ${catalog ? 'grid-cols-1' : 'grid-cols-2'} gap-1.5 p-1.5 pt-0`}>
        <button type="button" onClick={() => setSelectedCommunity(community)}
          className="min-h-11 min-w-0 rounded-xl border border-slate-700 bg-slate-900/90 px-1 text-center text-xs font-bold leading-tight whitespace-normal break-words text-white backdrop-blur-sm">
          Conhecer
        </button>
        <button type="button" onClick={() => requireLogin('participar da comunidade ' + community.name)}
          className="min-h-11 min-w-0 rounded-xl border border-slate-700 bg-slate-900/90 px-1 text-center text-xs font-bold leading-tight whitespace-normal break-words text-white backdrop-blur-sm">
          Participar
        </button>
      </div>
    </article>
  );

  const storesSection = (catalogOpen: boolean) => (
    <SquareStoresSection
      stores={stores}
      favoriteStoreIds={[]}
      participatingStoreIds={[]}
      offerStoreIds={data.offerStoreIds}
      onToggleFavoriteStore={() => requireLogin('salvar uma loja nos favoritos')}
      onViewAll={() => setStoreCatalogOpen(true)}
      onOpenStore={viewPublicStore}
      onOpenReviews={() => requireLogin('consultar avaliações de uma loja')}
      catalogOpen={catalogOpen}
      onCloseCatalog={() => setStoreCatalogOpen(false)}
    />
  );

  return (
    <div className="space-y-5" id="guest-praca" data-kyrub-brand-panel="taba">
      {loading && <p role="status" className="text-sm text-slate-400">Carregando a Praça…</p>}
      {error && <p role="alert" className="rounded-xl border border-amber-700/30 bg-slate-900 p-4 text-sm text-amber-200">{error}</p>}

      {storesSection(false)}

      <section id="square-communities" aria-label="Comunidades da Praça"
        className="space-y-4 rounded-3xl border border-slate-800 bg-slate-900/70 p-4">
        <header className="flex items-start justify-between gap-3">
          <div>
            <span className="text-xs font-black uppercase tracking-[0.18em] text-teal-300">Comunidades</span>
            <h2 className="mt-1 text-base font-black text-white">Encontre sua comunidade</h2>
          </div>
          <button type="button" onClick={() => setCommunityCatalogOpen(true)}
            className="flex min-h-10 shrink-0 items-center gap-1 rounded-xl bg-teal-500 px-3 text-xs font-black uppercase text-slate-950">
            Ver todas <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </header>
        <div role="group" aria-label="Filtros de comunidades" className="flex gap-1.5 overflow-x-auto">
          <button type="button" onClick={() => requireLogin('ver suas comunidades participantes')}
            className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs font-black uppercase text-slate-400">Participante</button>
          <button type="button" onClick={() => requireLogin('ver suas comunidades favoritas')}
            className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs font-black uppercase text-slate-400">Favoritos</button>
          <button type="button" aria-pressed="true"
            className="rounded-xl bg-teal-500/15 px-3 py-2 text-xs font-black uppercase text-teal-200">Em alta</button>
        </div>
        <div className="flex gap-2.5 overflow-x-auto pb-1" aria-label="Vitrine de comunidades">
          {data.communities.slice(0, 8).map(community => communityCard(community, false))}
          {!loading && data.communities.length === 0 &&
            <p className="rounded-xl border border-slate-800 p-4 text-sm text-slate-400">
              Nenhuma comunidade pública encontrada neste momento.
            </p>}
        </div>
      </section>

      <section id="guest-square-wall" aria-label="Mural da Praça" className="space-y-4 rounded-3xl border border-slate-800 bg-slate-900/70 p-4">
        <div>
          <span className="text-xs font-black uppercase tracking-[0.18em] text-teal-300">Mural</span>
          <h2 className="mt-1 text-xl font-black text-white">Mural da Praça</h2>
          <p className="mt-2 text-sm text-slate-400">Publicações públicas de Kairubidos e comunidades.</p>
        </div>
        <button type="button" onClick={() => requireLogin('publicar no mural da Praça')}
          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-950 px-4 text-sm font-semibold text-slate-300">
          <MessageCircle className="h-4 w-4" aria-hidden="true" /> O que você deseja compartilhar?
        </button>
        <div className="space-y-3">
          {(showAllPosts ? feed : feed.slice(0, 5)).map(post => (
            <article key={post.id} className="space-y-3 rounded-2xl border border-slate-800 bg-slate-950 p-4">
              <header className="flex items-center gap-3">
                {post.authorAvatar
                  ? <img src={post.authorAvatar} alt="" loading="lazy" decoding="async" aria-hidden="true" className="h-10 w-10 rounded-full object-cover" referrerPolicy="no-referrer" />
                  : <span className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-800"><Users className="h-5 w-5 text-slate-400" /></span>}
                <div className="min-w-0 flex-1">
                  <strong className="block truncate text-sm text-white">{post.authorName}</strong>
                  <span className="text-xs text-slate-400">{post.communityName ? 'Comunidade: ' + post.communityName + ' · ' : ''}{dateLabel(post.createdAt)}</span>
                </div>
              </header>
              {post.content && <p className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-200">{post.content}</p>}
              {post.mediaUrls.length > 0 &&
                <div className="flex snap-x gap-2 overflow-x-auto">
                  {post.mediaUrls.map((url, index) =>
                    <img key={url + index} src={url} alt={`Mídia da publicação ${index + 1}`}
                      className="max-h-72 min-w-0 max-w-full shrink-0 snap-start rounded-xl object-contain" loading="lazy" referrerPolicy="no-referrer" />)}
                </div>}
              <div className="flex gap-2 border-t border-slate-800 pt-3">
                <button type="button" onClick={() => requireLogin('curtir uma publicação')}
                  className="flex min-h-10 flex-1 items-center justify-center gap-1 rounded-xl border border-slate-800 text-xs font-bold text-slate-300">
                  <Heart className="h-4 w-4" /> Curtir
                </button>
                <button type="button" onClick={() => requireLogin('comentar uma publicação')}
                  className="flex min-h-10 flex-1 items-center justify-center gap-1 rounded-xl border border-slate-800 text-xs font-bold text-slate-300">
                  <MessageCircle className="h-4 w-4" /> Comentar
                </button>
              </div>
            </article>
          ))}
          {!loading && feed.length === 0 &&
            <p className="rounded-xl border border-dashed border-slate-700 p-5 text-center text-sm text-slate-400">
              Ainda não há publicações públicas para exibir.
            </p>}
          {!showAllPosts && feed.length > 5 &&
            <button type="button" onClick={() => setShowAllPosts(true)}
              className="min-h-11 w-full rounded-xl border border-slate-700 text-sm font-bold text-slate-200">
              Ver mais publicações
            </button>}
        </div>
      </section>

      {storeCatalogOpen && storesSection(true)}
      {communityCatalogOpen && (
        <SquareDirectoryLayout
          ariaLabel="Catálogo de comunidades"
          title="Todas as comunidades"
          subtitle="Descubra comunidades públicas e moderadas do Kyrub."
          searchId="guest-community-catalog-search"
          searchLabel="Buscar comunidades"
          searchPlaceholder="Nome, categoria ou assunto..."
          searchValue={communitySearch}
          onSearchChange={setCommunitySearch}
          selectedTab="trending"
          onTabChange={tab => {
            if (tab !== 'trending') requireLogin('ver suas comunidades ' + (tab === 'favorites' ? 'favoritas' : 'participantes'));
          }}
          categories={categories}
          category={communityCategory}
          onCategoryChange={setCommunityCategory}
          onClose={() => setCommunityCatalogOpen(false)}
        >
          <p className="mb-3 text-sm text-slate-400" aria-live="polite">
            {filteredCommunities.length} comunidades carregadas
          </p>
          <div className="grid grid-cols-2 items-stretch gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {filteredCommunities.map(community => communityCard(community, true))}
          </div>
          <InfiniteScrollTrigger
            hasMore={communityPage.hasMore}
            loading={communityPage.loading}
            error={communityPage.error}
            onLoadMore={communityPage.loadMore}
          />
        </SquareDirectoryLayout>
      )}

      {selectedCommunity && (
        <div className="fixed inset-0 z-[180] flex items-center justify-center bg-slate-950/90 p-4"
          role="presentation">
          <section role="dialog" aria-modal="true" aria-label={`Conhecer ${selectedCommunity.name}`}
            className="w-full max-w-md space-y-3 rounded-3xl border border-slate-700 bg-slate-900 p-5">
            <h2 className="text-xl font-black">{selectedCommunity.name}</h2>
            <p className="text-sm text-teal-300">{selectedCommunity.category} · {selectedCommunity.memberCount} participantes</p>
            <p className="whitespace-pre-wrap text-sm leading-6 text-slate-300">{selectedCommunity.description}</p>
            <button type="button" onClick={() => requireLogin('participar da comunidade ' + selectedCommunity.name)}
              className="min-h-11 w-full rounded-xl bg-teal-500 text-sm font-bold text-slate-950">Participar</button>
            <button type="button" onClick={() => setSelectedCommunity(null)}
              className="min-h-11 w-full rounded-xl border border-slate-700 text-sm font-bold">Voltar à Praça</button>
          </section>
        </div>
      )}
    </div>
  );
}
