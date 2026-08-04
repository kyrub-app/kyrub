import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { LocateFixed, Search } from 'lucide-react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../utils/firebase';

type Filter = 'todas' | 'favoritas' | 'cliente';

type StoreMeta = {
  id: string;
  name: string;
  lat?: number;
  lng?: number;
};

type OrderLike = { storeId?: string };

type HiddenSearchState = {
  element: HTMLElement;
  display: string;
};

const FAVORITES_KEY = 'kyrub_favorite_stores';
const ORDERS_KEY = 'kyrub_orders';
const MAX_ORGANIC_RADIUS_KM = 30;

const normalize = (value: string | null | undefined): string =>
  (value ?? '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('pt-BR');

const readList = (key: string): string[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
};

const readCustomerStoreIds = (): string[] => {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(ORDERS_KEY) ?? '[]'
    ) as OrderLike[];
    return Array.isArray(parsed)
      ? Array.from(
          new Set(
            parsed
              .map(order => order.storeId)
              .filter((id): id is string => Boolean(id))
          )
        )
      : [];
  } catch {
    return [];
  }
};

const distanceKm = (
  first: { lat: number; lng: number },
  second: { lat: number; lng: number }
): number => {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const earthRadius = 6371;
  const latDelta = toRad(second.lat - first.lat);
  const lngDelta = toRad(second.lng - first.lng);
  const a =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(toRad(first.lat)) *
      Math.cos(toRad(second.lat)) *
      Math.sin(lngDelta / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const writeNativeInputValue = (
  input: HTMLInputElement,
  value: string
): void => {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value'
  )?.set;

  if (setter) setter.call(input, value);
  else input.value = value;

  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
};

export function ProfileOffersFiltersBridge() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [stores, setStores] = useState<StoreMeta[]>([]);
  const [filter, setFilter] = useState<Filter>('todas');
  const [favorites, setFavorites] = useState<string[]>(() =>
    readList(FAVORITES_KEY)
  );
  const [customerStoreIds, setCustomerStoreIds] = useState<string[]>(() =>
    readCustomerStoreIds()
  );
  const [distanceOpen, setDistanceOpen] = useState(false);
  const [radiusKm, setRadiusKm] = useState(10);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    null
  );
  const [locationBusy, setLocationBusy] = useState(false);
  const [searchValue, setSearchValue] = useState('');
  const originalSearchInputRef = useRef<HTMLInputElement | null>(null);
  const hiddenSearchRef = useRef<HiddenSearchState | null>(null);

  useEffect(() => {
    const storesQuery = query(
      collection(db, 'tenants'),
      where('publicationStatus', '==', 'published')
    );
    return onSnapshot(storesQuery, snapshot => {
      setStores(
        snapshot.docs.map(item => {
          const data = item.data() as Record<string, unknown>;
          return {
            id: typeof data.id === 'string' ? data.id : item.id,
            name: typeof data.name === 'string' ? data.name : '',
            lat: typeof data.lat === 'number' ? data.lat : undefined,
            lng: typeof data.lng === 'number' ? data.lng : undefined,
          };
        })
      );
    });
  }, []);

  useEffect(
    () => () => {
      const hiddenSearch = hiddenSearchRef.current;
      if (hiddenSearch?.element.isConnected) {
        hiddenSearch.element.style.display = hiddenSearch.display;
      }
    },
    []
  );

  const storesByName = useMemo(() => {
    const map = new Map<string, StoreMeta>();
    stores.forEach(store => map.set(normalize(store.name), store));
    return map;
  }, [stores]);

  useEffect(() => {
    const synchronize = () => {
      const headings = [...document.querySelectorAll<HTMLElement>('h3')];
      const title = headings.find(item =>
        normalize(item.textContent).includes('lojas para descobrir e consumir')
      );
      const panel = title?.closest<HTMLElement>('section');
      if (!panel) {
        setHost(null);
        return;
      }

      const body = panel.querySelector<HTMLElement>(':scope > div.flex-1');
      const searchWrapper = body?.querySelector<HTMLElement>(
        ':scope > div.relative'
      );
      if (!body || !searchWrapper) return;

      const originalSearchInput = searchWrapper.querySelector<HTMLInputElement>(
        'input[type="search"], input'
      );
      if (
        originalSearchInput &&
        originalSearchInputRef.current !== originalSearchInput
      ) {
        originalSearchInputRef.current = originalSearchInput;
        setSearchValue(originalSearchInput.value);
      }

      if (hiddenSearchRef.current?.element !== searchWrapper) {
        hiddenSearchRef.current = {
          element: searchWrapper,
          display: searchWrapper.style.display,
        };
      }
      searchWrapper.style.display = 'none';

      let bridgeHost = body.querySelector<HTMLElement>(
        '#profile-offers-filters-host'
      );
      if (!bridgeHost) {
        bridgeHost = document.createElement('div');
        bridgeHost.id = 'profile-offers-filters-host';
        body.insertBefore(bridgeHost, searchWrapper);
      }
      if (host !== bridgeHost) setHost(bridgeHost);

      const cards = [...body.querySelectorAll<HTMLElement>('article')];
      cards.forEach(card => {
        const name = card.querySelector('h4')?.textContent ?? '';
        const store = storesByName.get(normalize(name));
        if (!store) return;
        card.dataset.profileOfferStoreId = store.id;
        card.style.position = 'relative';

        let favoriteButton = card.querySelector<HTMLButtonElement>(
          '[data-profile-offer-favorite="true"]'
        );
        if (!favoriteButton) {
          favoriteButton = document.createElement('button');
          favoriteButton.type = 'button';
          favoriteButton.dataset.profileOfferFavorite = 'true';
          favoriteButton.className =
            'absolute right-2 top-2 z-20 flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-slate-950/85 text-slate-300 backdrop-blur';
          favoriteButton.setAttribute('aria-label', `Favoritar ${name}`);
          favoriteButton.innerHTML = '<span aria-hidden="true">♡</span>';
          card.appendChild(favoriteButton);
        }

        const favorite = favorites.includes(store.id);
        favoriteButton.innerHTML = `<span aria-hidden="true" style="font-size:1.25rem;line-height:1;color:${
          favorite ? '#f59e0b' : '#cbd5e1'
        }">${favorite ? '♥' : '♡'}</span>`;

        const byFavorite = filter !== 'favoritas' || favorite;
        const byCustomer =
          filter !== 'cliente' || customerStoreIds.includes(store.id);
        const hasCoords =
          typeof store.lat === 'number' && typeof store.lng === 'number';
        const byDistance =
          !coords ||
          !hasCoords ||
          distanceKm(coords, { lat: store.lat!, lng: store.lng! }) <=
            radiusKm;
        card.style.display = byFavorite && byCustomer && byDistance ? '' : 'none';
      });
    };

    synchronize();
    const timer = window.setInterval(synchronize, 300);
    return () => window.clearInterval(timer);
  }, [coords, customerStoreIds, favorites, filter, host, radiusKm, storesByName]);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      const button = (event.target as Element | null)?.closest<HTMLButtonElement>(
        '[data-profile-offer-favorite="true"]'
      );
      if (!button) return;
      const card = button.closest<HTMLElement>(
        '[data-profile-offer-store-id]'
      );
      const id = card?.dataset.profileOfferStoreId;
      if (!id) return;
      event.preventDefault();
      event.stopPropagation();
      setFavorites(current => {
        const next = current.includes(id)
          ? current.filter(item => item !== id)
          : [...current, id];
        localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
        return next;
      });
    };
    document.addEventListener('click', handleClick, true);
    return () => document.removeEventListener('click', handleClick, true);
  }, []);

  const requestLocation = () => {
    setDistanceOpen(current => !current);
    if (coords || locationBusy || !navigator.geolocation) return;
    setLocationBusy(true);
    navigator.geolocation.getCurrentPosition(
      position => {
        setCoords({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
        setLocationBusy(false);
      },
      () => setLocationBusy(false),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
    );
  };

  const updateSearch = (value: string) => {
    setSearchValue(value);
    const originalSearchInput = originalSearchInputRef.current;
    if (originalSearchInput) {
      writeNativeInputValue(originalSearchInput, value);
    }
  };

  if (!host) return null;

  return createPortal(
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={requestLocation}
          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border ${
            coords
              ? 'border-orange-500/40 bg-orange-500/10 text-orange-300'
              : 'border-slate-800 bg-slate-900 text-slate-400'
          }`}
          aria-label="Definir distância das lojas"
        >
          <LocateFixed
            className={`h-5 w-5 ${locationBusy ? 'animate-pulse' : ''}`}
          />
        </button>

        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" />
          <input
            type="search"
            value={searchValue}
            onChange={event => updateSearch(event.target.value)}
            placeholder="Buscar lojas..."
            className="h-12 w-full rounded-2xl border border-slate-800 bg-slate-900 pl-12 pr-4 text-base text-white outline-none transition-colors placeholder:text-slate-500 focus:border-orange-500/60"
            aria-label="Buscar lojas"
          />
        </div>
      </div>

      {distanceOpen && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-3">
          <div className="flex items-center gap-3">
            <input
              type="range"
              min="1"
              max={MAX_ORGANIC_RADIUS_KM}
              value={radiusKm}
              onChange={event =>
                setRadiusKm(
                  Math.min(
                    MAX_ORGANIC_RADIUS_KM,
                    Number(event.target.value)
                  )
                )
              }
              className="h-1 flex-1 accent-orange-500"
              aria-label="Distância máxima em quilômetros"
            />
            <strong className="w-14 text-right text-[10px] text-orange-300">
              {radiusKm} KM
            </strong>
          </div>
          <p className="mt-2 text-[9px] leading-relaxed text-slate-500">
            Alcance orgânico limitado a 30 km. Distâncias maiores ficam
            disponíveis por campanhas de marketing.
          </p>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        {(['todas', 'favoritas', 'cliente'] as const).map(item => (
          <button
            key={item}
            type="button"
            onClick={() => {
              setFilter(item);
              setCustomerStoreIds(readCustomerStoreIds());
            }}
            className={`rounded-xl border px-2 py-2.5 text-[9px] font-black uppercase ${
              filter === item
                ? 'border-orange-500 bg-orange-500 text-slate-950'
                : 'border-slate-800 bg-slate-900 text-slate-400'
            }`}
          >
            {item === 'todas'
              ? 'Todas'
              : item === 'favoritas'
                ? 'Favoritas'
                : 'Cliente'}
          </button>
        ))}
      </div>
    </div>,
    host
  );
}
