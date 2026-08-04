import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Heart, LocateFixed, MapPin } from 'lucide-react';
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

const FAVORITES_KEY = 'kyrub_favorite_stores';
const ORDERS_KEY = 'kyrub_orders';

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
    const parsed = JSON.parse(localStorage.getItem(ORDERS_KEY) ?? '[]') as OrderLike[];
    return Array.isArray(parsed)
      ? Array.from(new Set(parsed.map(order => order.storeId).filter((id): id is string => Boolean(id))))
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

export function ProfileOffersFiltersBridge() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [stores, setStores] = useState<StoreMeta[]>([]);
  const [filter, setFilter] = useState<Filter>('todas');
  const [favorites, setFavorites] = useState<string[]>(() => readList(FAVORITES_KEY));
  const [customerStoreIds, setCustomerStoreIds] = useState<string[]>(() => readCustomerStoreIds());
  const [distanceOpen, setDistanceOpen] = useState(false);
  const [radiusKm, setRadiusKm] = useState(10);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locationBusy, setLocationBusy] = useState(false);

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
      const searchWrapper = body?.querySelector<HTMLElement>(':scope > div.relative');
      if (!body || !searchWrapper) return;

      let bridgeHost = body.querySelector<HTMLElement>('#profile-offers-filters-host');
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

        let favoriteButton = card.querySelector<HTMLButtonElement>('[data-profile-offer-favorite="true"]');
        if (!favoriteButton) {
          favoriteButton = document.createElement('button');
          favoriteButton.type = 'button';
          favoriteButton.dataset.profileOfferFavorite = 'true';
          favoriteButton.className = 'absolute right-2 top-2 z-20 flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-slate-950/85 text-slate-300 backdrop-blur';
          favoriteButton.setAttribute('aria-label', `Favoritar ${name}`);
          favoriteButton.innerHTML = '<span aria-hidden="true">♡</span>';
          card.appendChild(favoriteButton);
        }

        const favorite = favorites.includes(store.id);
        favoriteButton.innerHTML = `<span aria-hidden="true" style="font-size:1.25rem;line-height:1;color:${favorite ? '#f59e0b' : '#cbd5e1'}">${favorite ? '♥' : '♡'}</span>`;

        const byFavorite = filter !== 'favoritas' || favorite;
        const byCustomer = filter !== 'cliente' || customerStoreIds.includes(store.id);
        const hasCoords = typeof store.lat === 'number' && typeof store.lng === 'number';
        const byDistance = !coords || !hasCoords || distanceKm(coords, { lat: store.lat!, lng: store.lng! }) <= radiusKm;
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
      const card = button.closest<HTMLElement>('[data-profile-offer-store-id]');
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
        setCoords({ lat: position.coords.latitude, lng: position.coords.longitude });
        setLocationBusy(false);
      },
      () => setLocationBusy(false),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
    );
  };

  if (!host) return null;

  return createPortal(
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={requestLocation}
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border ${
            coords
              ? 'border-orange-500/40 bg-orange-500/10 text-orange-300'
              : 'border-slate-800 bg-slate-900 text-slate-400'
          }`}
          aria-label="Definir distância das lojas"
        >
          <LocateFixed className={`h-5 w-5 ${locationBusy ? 'animate-pulse' : ''}`} />
        </button>
        <div className="min-w-0 flex-1 rounded-2xl border border-slate-800 bg-slate-900 px-3 py-2 text-[9px] text-slate-500">
          <span className="flex items-center gap-2 font-black uppercase text-slate-300">
            <MapPin className="h-4 w-4 text-orange-400" />
            Proximidade
          </span>
          <span>{coords ? `Lojas em até ${radiusKm} km` : 'Toque na mira para usar sua localização'}</span>
        </div>
      </div>

      {distanceOpen && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-3">
          <div className="flex items-center gap-3">
            <input
              type="range"
              min="1"
              max="100"
              value={radiusKm}
              onChange={event => setRadiusKm(Number(event.target.value))}
              className="h-1 flex-1 accent-orange-500"
              aria-label="Distância máxima em quilômetros"
            />
            <strong className="w-14 text-right text-[10px] text-orange-300">{radiusKm} KM</strong>
          </div>
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
            {item === 'todas' ? 'Todas' : item === 'favoritas' ? 'Favoritas' : 'Cliente'}
          </button>
        ))}
      </div>
    </div>,
    host
  );
}
