import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Heart } from 'lucide-react';
import { StoreCardBannerCarousel } from '../StoreCardBannerCarousel';
import { SquareDirectoryLayout, type SquareDirectoryTab } from '../SquareDirectoryLayout';
import type { Store } from '../../types';

type StoreListTab = SquareDirectoryTab;
type PublicStoreCard = {
  id: string;
  name: string;
  slug: string;
  description: string;
  logo: string;
  banner: string;
  bannerImages?: string[];
  official: boolean;
  source?: Store;
};

type SquareStoresSectionProps = {
  stores: Store[];
  favoriteStoreIds: string[];
  participatingStoreIds: string[];
  onToggleFavoriteStore: (storeId: string) => void;
  offerStoreIds: string[];
  onViewAll: () => void;
  onOpenStore: (store: Store) => void;
  onOpenReviews: (store: Store) => void;
  catalogOpen?: boolean;
  onCloseCatalog?: () => void;
};

const OFFICIAL_STORE_SLUG = 'kyrub-oficial';
const OFFICIAL_STORE_PATH = '/@kyrub-oficial';

// Official discovery cards can arrive before their Store listing. Reviews
// only require the verified public identity (store ID and name); preserve
// that identity when opening the existing canonical reviews modal.
const storeForReviews = (store: PublicStoreCard): Store => store.source ?? {
  id: store.id,
  name: store.name,
  slug: store.slug,
  description: store.description,
  logo: store.logo,
  banner: '',
  primaryColor: '',
  plan: 'free',
  ownerEmail: '',
};

export function SquareStoresSection({
  stores, favoriteStoreIds, participatingStoreIds, offerStoreIds,
  onToggleFavoriteStore, onViewAll, onOpenStore, onOpenReviews, catalogOpen = false, onCloseCatalog,
}: SquareStoresSectionProps) {
  const [listTab, setListTab] = useState<StoreListTab>('trending');
  const [catalogTab, setCatalogTab] = useState<StoreListTab>('trending');
  const [catalogSearch, setCatalogSearch] = useState('');
  const [catalogCategory, setCatalogCategory] = useState('all');
  const [officialStore, setOfficialStore] = useState<PublicStoreCard | null>(null);
  const [loadingOfficial, setLoadingOfficial] = useState(true);
  const [officialError, setOfficialError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/marketplace-discovery/public/kyrub-oficial', {
      signal: controller.signal,
      cache: 'no-store',
      headers: { accept: 'application/json' },
    })
      .then(async response => {
        if (!response.ok) throw Error('OFFICIAL_STORE_DISCOVERY_UNAVAILABLE');
        return response.json() as Promise<{ store?: Record<string, unknown> }>;
      })
      .then(payload => {
        const store = payload.store;
        if (
          store?.slug !== OFFICIAL_STORE_SLUG ||
          typeof store.id !== 'string' || !store.id ||
          typeof store.name !== 'string' || !store.name.trim()
        ) {
          throw Error('OFFICIAL_STORE_DISCOVERY_INVALID');
        }
        if (controller.signal.aborted) return;
        setOfficialStore({
          id: store.id,
          slug: OFFICIAL_STORE_SLUG,
          name: store.name,
          description: typeof store.description === 'string' ? store.description : '',
          logo: typeof store.logo === 'string' ? store.logo : '',
          banner: typeof store.banner === 'string' ? store.banner : '',
          bannerImages: Array.isArray(store.bannerImages) ? store.bannerImages.filter((value): value is string => typeof value === 'string') : undefined,
          official: true,
        });
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setOfficialStore(null);
          setOfficialError(true);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingOfficial(false);
      });
    return () => controller.abort();
  }, []);

  const cards = useMemo(() => {
    const seen = new Set<string>();
    const output: PublicStoreCard[] = [];

    if (officialStore) {
      output.push(officialStore);
      seen.add(OFFICIAL_STORE_SLUG);
    }
    for (const store of stores) {
      const slug = store.slug?.trim().toLowerCase() || store.id;
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);
      output.push({
        id: store.id,
        slug: store.slug || '',
        name: store.name,
        description: store.description || '',
        logo: store.logo || '',
        banner: store.banner || '',
        bannerImages: store.bannerImages,
        official: slug === OFFICIAL_STORE_SLUG,
        source: store,
      });
    }
    return output;
  }, [officialStore, stores]);

  const visible = useMemo(() => {
    const favoriteIds = new Set(favoriteStoreIds);
    const participatingIds = new Set(participatingStoreIds);
    const offerIds = new Set(offerStoreIds);
    if (listTab === 'participating') {
      return cards.filter(store => participatingIds.has(store.id));
    }
    if (listTab === 'favorites') {
      return cards.filter(store => favoriteIds.has(store.id));
    }
    if (listTab === 'trending') {
      // Early showcase: published offers and the platform's own store.
      // Never represent this as a ranking by purchases or revenue.
      return cards.filter(store => store.official || offerIds.has(store.id));
    }
    return cards;
  }, [cards, favoriteStoreIds, participatingStoreIds, offerStoreIds, listTab]);

  // The catalog must show every discoverable store in "Em alta", with
  // highlighted stores first; the rail retains its narrower preview policy.
  const catalogCategories = useMemo(
    () => [...new Set(cards.flatMap(store => store.source?.keywords ?? [])
      .map(keyword => keyword.trim()).filter(Boolean))]
      .sort((left, right) => left.localeCompare(right, 'pt-BR')),
    [cards],
  );
  const catalogStores = useMemo(() => {
    const query = catalogSearch.trim().toLocaleLowerCase('pt-BR');
    const favoriteIds = new Set(favoriteStoreIds);
    const participatingIds = new Set(participatingStoreIds);
    const offerIds = new Set(offerStoreIds);
    return cards.filter(store => {
      if (catalogTab === 'participating' && !participatingIds.has(store.id)) return false;
      if (catalogTab === 'favorites' && !favoriteIds.has(store.id)) return false;
      if (catalogCategory !== 'all' && !store.source?.keywords?.includes(catalogCategory)) return false;
      return !query || [
        store.name, store.description, store.slug, store.source?.address ?? '',
        ...(store.source?.keywords ?? []),
      ].join(' ').toLocaleLowerCase('pt-BR').includes(query);
    }).sort((left, right) => {
      if (catalogTab !== 'trending') return left.name.localeCompare(right.name, 'pt-BR');
      const score = (store: PublicStoreCard) =>
        (store.official ? 2 : 0) + (offerIds.has(store.id) ? 1 : 0);
      return score(right) - score(left) || left.name.localeCompare(right.name, 'pt-BR');
    });
  }, [cards, catalogSearch, catalogCategory, catalogTab,
    favoriteStoreIds, participatingStoreIds, offerStoreIds]);

  if (catalogOpen) {
    return (
      <SquareDirectoryLayout
        ariaLabel="Catálogo de lojas"
        title="Todas as lojas"
        subtitle="Descubra lojas, produtos e ofertas no Kyrub."
        searchId="store-catalog-search"
        searchLabel="Buscar lojas"
        searchPlaceholder="Nome, categoria, produto ou assunto..."
        searchValue={catalogSearch}
        onSearchChange={setCatalogSearch}
        selectedTab={catalogTab}
        onTabChange={setCatalogTab}
        categories={catalogCategories}
        category={catalogCategory}
        onCategoryChange={setCatalogCategory}
        onClose={() => onCloseCatalog?.()}
      >
        <p className="mb-3 text-sm text-slate-400" aria-live="polite">
          {loadingOfficial && catalogStores.length === 0
            ? 'Carregando lojas publicadas…'
            : `${catalogStores.length} ${catalogStores.length === 1 ? 'loja encontrada' : 'lojas encontradas'}`}
        </p>
        <div className="grid grid-cols-2 items-stretch gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {catalogStores.map(store => {
            const favorite = favoriteStoreIds.includes(store.id);
            const participating = participatingStoreIds.includes(store.id);
            return (
              <article key={store.slug || store.id}
                className="relative flex min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-900">
                <StoreCardBannerCarousel name={store.name} logo={store.logo}
                  banner={store.banner} bannerImages={store.bannerImages} />
                <button type="button"
                  aria-label={favorite ? `Remover ${store.name} dos favoritos` : `Favoritar loja ${store.name}`}
                  aria-pressed={favorite}
                  onClick={() => onToggleFavoriteStore(store.id)}
                  className={`absolute right-2 top-2 z-10 flex h-10 w-10 items-center justify-center rounded-full border bg-slate-950/85 ${favorite
                    ? 'border-rose-500/60 text-rose-300'
                    : 'border-slate-600 text-slate-200'}`}>
                  <Heart className={`h-4 w-4 ${favorite ? 'fill-current' : ''}`} aria-hidden="true" />
                </button>
                <div className="flex-1 p-3">
                  <strong className="block line-clamp-2 text-sm font-black text-white">{store.name}</strong>
                  {store.official && <span className="mt-1 block text-xs font-bold text-teal-300">Loja Oficial</span>}
                  {participating && <span className="mt-1 block text-xs font-bold text-emerald-300">Você participa</span>}
                  {store.source?.keywords?.length ? (
                    <span className="mt-1 block truncate text-xs text-teal-300/75">
                      {store.source.keywords.slice(0, 2).join(', ')}
                    </span>
                  ) : null}
                  {store.description && (
                    <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-400">
                      {store.description}
                    </p>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-1.5 border-t border-slate-800 p-1.5">
                  <button type="button"
                    aria-label={`Abrir momentos da loja ${store.name}`}
                    title={`Momentos de ${store.name}`}
                    onClick={() => onOpenReviews(storeForReviews(store))}
                    className="flex min-h-11 min-w-0 items-center justify-center rounded-xl border border-amber-500/30 bg-slate-800 px-1 text-xs font-bold tracking-tight text-amber-300">
                    Momentos
                  </button>
                  {store.official ? (
                    <a href={OFFICIAL_STORE_PATH}
                      className="flex min-h-11 min-w-0 items-center justify-center rounded-xl bg-slate-800 px-1 text-xs font-bold text-slate-200">
                      Entrar
                    </a>
                  ) : (
                    <button type="button" onClick={() => store.source && onOpenStore(store.source)}
                      className="flex min-h-11 min-w-0 items-center justify-center rounded-xl bg-slate-800 px-1 text-xs font-bold text-slate-200">
                      Entrar
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
        {!loadingOfficial && catalogStores.length === 0 && (
          <p className="mt-3 rounded-xl border border-dashed border-slate-700 p-6 text-center text-sm text-slate-400">
            {officialError && cards.length === 0
              ? 'Não foi possível consultar as vitrines agora.'
              : 'Nenhuma loja encontrada. Experimente outra busca ou filtro.'}
          </p>
        )}
      </SquareDirectoryLayout>
    );
  }

  return (
    <section id="square-stores" aria-label="Lojas na Praça"
      className="mb-4 space-y-4 rounded-3xl border border-slate-800 bg-slate-900/70 p-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <span className="text-xs font-black uppercase tracking-[0.18em] text-teal-300">Lojas</span>
          <h2 className="mt-1 text-base font-black text-white">Descubra lojas e ofertas</h2>
        </div>
        <button type="button" id="square-stores-view-all" onClick={onViewAll}
          className="flex min-h-10 shrink-0 items-center gap-1 rounded-xl bg-teal-500 px-3 text-xs font-black uppercase text-slate-950">
          Ver todas <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </header>
      <div role="group" aria-label="Filtros de lojas" className="flex gap-1.5 overflow-x-auto">
        {([
          ['participating', 'Participante'],
          ['favorites', 'Favoritos'],
          ['trending', 'Em alta'],
        ] as const).map(([id, label]) => (
          <button key={id} type="button"
            aria-pressed={listTab === id}
            onClick={() => setListTab(id)}
            className={`shrink-0 rounded-xl px-3 py-2 text-xs font-black uppercase ${
              listTab === id
                ? 'bg-teal-500/15 text-teal-200'
                : 'border border-slate-800 bg-slate-950 text-slate-500'
            }`}>
            {label}
          </button>
        ))}
      </div>
      {listTab === 'participating' && (
        <p className="text-xs leading-relaxed text-slate-400">Lojas com histórico de fidelidade confirmado. Sua própria loja não entra.</p>
      )}
      {listTab === 'trending' && (
        <p className="text-xs leading-relaxed text-slate-400">Destaques e lojas com ofertas publicadas; sem ranking de vendas.</p>
      )}
      <div className="flex gap-2.5 overflow-x-auto pb-1" aria-label="Vitrines de lojas">
        {visible.slice(0, 8).map(store => (
          <article key={store.slug || store.id}
            className="flex w-[206px] shrink-0 flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-900">
            <div className="relative h-24">
              <StoreCardBannerCarousel name={store.name} logo={store.logo}
                banner={store.banner} bannerImages={store.bannerImages} />
              <button type="button"
                aria-label={favoriteStoreIds.includes(store.id) ? `Remover ${store.name} dos favoritos` : `Favoritar loja ${store.name}`}
                aria-pressed={favoriteStoreIds.includes(store.id)}
                onClick={() => onToggleFavoriteStore(store.id)}
                className={`absolute right-2 top-2 flex h-10 w-10 items-center justify-center rounded-full border bg-slate-950/85 ${favoriteStoreIds.includes(store.id) ? 'border-rose-500/60 text-rose-300' : 'border-slate-600 text-slate-200'}`}>
                <Heart className={`h-4 w-4 ${favoriteStoreIds.includes(store.id) ? 'fill-current' : ''}`} />
              </button>
            </div>
            <div className="flex-1 p-3">
              <strong className="block line-clamp-2 text-sm font-black text-white">{store.name}</strong>
              {store.official && <span className="mt-1 block text-xs font-bold text-teal-300">Loja Oficial</span>}
              {store.description && (
                <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-400">{store.description}</p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-1.5 border-t border-slate-800 p-1.5">
              <button type="button"
                aria-label={`Abrir momentos da loja ${store.name}`}
                title={`Momentos de ${store.name}`}
                onClick={() => onOpenReviews(storeForReviews(store))}
                className="flex min-h-11 min-w-0 items-center justify-center rounded-xl border border-amber-500/30 bg-slate-800 px-1 text-xs font-bold tracking-tight text-amber-300">
                Momentos
              </button>
              {store.official ? (
                <a href={OFFICIAL_STORE_PATH}
                  className="flex min-h-11 min-w-0 items-center justify-center rounded-xl bg-slate-800 px-1 text-xs font-bold text-slate-200">
                  Entrar
                </a>
              ) : (
                <button type="button" onClick={() => store.source && onOpenStore(store.source)}
                  className="flex min-h-11 min-w-0 items-center justify-center rounded-xl bg-slate-800 px-1 text-xs font-bold text-slate-200">
                  Entrar
                </button>
              )}
            </div>
          </article>
        ))}
        {loadingOfficial && cards.length === 0 && (
          <p role="status" className="self-center text-xs text-slate-400">Carregando lojas publicadas…</p>
        )}
        {!loadingOfficial && visible.length === 0 && (
          <p className="self-center rounded-xl border border-slate-800 p-4 text-xs text-slate-400">
            {listTab === 'participating'
              ? 'Lojas com participação de fidelidade confirmada aparecerão aqui.'
              : listTab === 'favorites'
                ? 'Favorite uma loja tocando no coração do card.'
              : officialError && cards.length === 0
                ? 'Não foi possível consultar as vitrines agora.'
                : 'Nenhuma loja encontrada neste filtro.'}
          </p>
        )}
      </div>
    </section>
  );
}
