import { useEffect, useMemo, useState } from 'react';
import { ShoppingBag, Store as StoreIcon } from 'lucide-react';
import type { Store } from '../../types';

type StoreListTab = 'mine' | 'discover' | 'trending';
type PublicStoreCard = {
  id: string;
  name: string;
  slug: string;
  description: string;
  logo: string;
  official: boolean;
  source?: Store;
};

type SquareStoresSectionProps = {
  stores: Store[];
  favoriteStoreIds: string[];
  purchasedStoreIds: string[];
  offerStoreIds: string[];
  onViewAll: () => void;
  onOpenStore: (store: Store) => void;
};

const OFFICIAL_STORE_SLUG = 'kyrub-oficial';
const OFFICIAL_STORE_PATH = '/@kyrub-oficial';

export function SquareStoresSection({
  stores, favoriteStoreIds, offerStoreIds,
  onViewAll, onOpenStore,
}: SquareStoresSectionProps) {
  const [listTab, setListTab] = useState<StoreListTab>('discover');
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
        official: slug === OFFICIAL_STORE_SLUG,
        source: store,
      });
    }
    return output;
  }, [officialStore, stores]);

  const visible = useMemo(() => {
    const favoriteIds = new Set(favoriteStoreIds);
    const offerIds = new Set(offerStoreIds);
    if (listTab === 'mine') {
      return cards.filter(store => favoriteIds.has(store.id));
    }
    if (listTab === 'trending') {
      // Early showcase: published offers and the platform's own store.
      // Never represent this as a ranking by purchases or revenue.
      return cards.filter(store => store.official || offerIds.has(store.id));
    }
    return cards;
  }, [cards, favoriteStoreIds, offerStoreIds, listTab]);

  return (
    <section id="square-stores" aria-label="Lojas na Praça"
      className="mb-4 space-y-3 rounded-3xl border border-slate-800 bg-slate-900/70 p-3">
      <header className="flex items-start justify-between gap-3">
        <div>
          <span className="text-[8px] font-black uppercase tracking-[0.18em] text-sky-300">Lojas</span>
          <h2 className="mt-0.5 text-xs font-black text-white">Descubra lojas e ofertas</h2>
        </div>
      </header>
      <div role="group" aria-label="Filtros de lojas" className="flex gap-1.5 overflow-x-auto">
        {([
          ['mine', 'Favoritas'],
          ['discover', 'Descobrir'],
          ['trending', 'Em alta'],
        ] as const).map(([id, label]) => (
          <button key={id} type="button"
            aria-pressed={listTab === id}
            onClick={() => id === 'discover' ? onViewAll() : setListTab(id)}
            className={`shrink-0 rounded-xl px-3 py-2 text-[8px] font-black uppercase ${
              listTab === id
                ? 'bg-sky-500/15 text-sky-200'
                : 'border border-slate-800 bg-slate-950 text-slate-500'
            }`}>
            {label}
          </button>
        ))}
      </div>
      {listTab === 'mine' && (
        <p className="text-[9px] text-slate-500">Suas lojas favoritas.</p>
      )}
      {listTab === 'trending' && (
        <p className="text-[9px] text-slate-500">Destaques e lojas com ofertas publicadas; sem ranking de vendas.</p>
      )}
      <div className="flex gap-2.5 overflow-x-auto pb-1" aria-label="Vitrines de lojas">
        {visible.slice(0, 8).map(store => (
          <article key={store.slug || store.id}
            className="flex w-[172px] shrink-0 flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-900">
            <div className="flex h-24 items-center justify-center bg-gradient-to-br from-sky-900/40 via-indigo-900/30 to-orange-900/20">
              {store.logo
                ? <img src={store.logo} alt={store.name} className="h-14 w-14 rounded-xl object-cover" referrerPolicy="no-referrer" />
                : <StoreIcon className="h-10 w-10 text-orange-400" aria-hidden="true" />}
            </div>
            <div className="flex-1 p-3">
              <strong className="block line-clamp-2 text-[11px] font-black text-white">{store.name}</strong>
              {store.official && <span className="mt-1 block text-[8px] font-bold text-teal-300">Loja Oficial</span>}
              {store.description && (
                <p className="mt-1 line-clamp-2 text-[9px] leading-relaxed text-slate-400">{store.description}</p>
              )}
            </div>
            <div className="border-t border-slate-800 p-2">
              {store.official ? (
                <a href={OFFICIAL_STORE_PATH}
                  className="flex min-h-9 items-center justify-center gap-1 rounded-xl bg-slate-800 px-2 text-[9px] font-black uppercase text-slate-200">
                  <ShoppingBag className="h-3.5 w-3.5" aria-hidden="true" /> Abrir loja
                </a>
              ) : (
                <button type="button" onClick={() => store.source && onOpenStore(store.source)}
                  className="flex min-h-9 w-full items-center justify-center rounded-xl bg-slate-800 px-2 text-[9px] font-black uppercase text-slate-200">
                  Abrir loja
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
            {listTab === 'mine'
              ? 'Suas lojas favoritas aparecerão aqui.'
              : officialError && cards.length === 0
                ? 'Não foi possível consultar as vitrines agora.'
                : 'Nenhuma loja encontrada neste filtro.'}
          </p>
        )}
      </div>
    </section>
  );
}
