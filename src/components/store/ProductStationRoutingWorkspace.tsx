import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Boxes, LoaderCircle } from 'lucide-react';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import type { Product } from '../../types';
import { auth, db } from '../../utils/firebase';
import { parsePublicProducts } from '../../utils/publicProducts';
import {
  cacheProductPreparationStations,
  DEFAULT_PRODUCTION_STATION,
  persistProductPreparationStation,
  readProductPreparationStationsFromTenant,
  type ProductPreparationStations,
} from '../../utils/productionRouting';

const readProductionSpaces = (): string[] => {
  try {
    const parsed = JSON.parse(
      localStorage.getItem('kyrub_producao_spaces') ?? '[]'
    ) as unknown;
    if (!Array.isArray(parsed)) return [DEFAULT_PRODUCTION_STATION];
    return [...new Set(
      [DEFAULT_PRODUCTION_STATION, ...parsed]
        .map(value => typeof value === 'string' ? value.trim().toLocaleUpperCase('pt-BR') : '')
        .filter(Boolean)
        .filter(value => value !== 'TODOS')
    )];
  } catch {
    return [DEFAULT_PRODUCTION_STATION];
  }
};

export function ProductStationRoutingWorkspace() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [stations, setStations] = useState<ProductPreparationStations>({});
  const [productionSpaces, setProductionSpaces] = useState<string[]>(
    readProductionSpaces
  );
  const [busyProductId, setBusyProductId] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    let portalHost: HTMLDivElement | null = null;

    const mount = (): void => {
      if (cancelled) return;
      const workspace = document.getElementById('erp-product-inventory-workspace');
      const filterBar = document.getElementById('erp-product-keyword-filters');
      if (!workspace || !filterBar || !filterBar.parentElement) {
        timer = window.setTimeout(mount, 80);
        return;
      }
      if (!portalHost || !portalHost.isConnected) {
        portalHost = document.createElement('div');
        portalHost.id = 'kyrub-product-station-routing-host';
        filterBar.parentElement.insertBefore(portalHost, filterBar.nextSibling);
        setHost(portalHost);
      }
      timer = window.setTimeout(mount, 250);
    };

    timer = window.setTimeout(mount, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      portalHost?.remove();
      setHost(null);
    };
  }, []);

  useEffect(() => {
    let unsubscribeTenant = () => undefined;
    const unsubscribeAuth = onAuthStateChanged(auth, user => {
      unsubscribeTenant();
      unsubscribeTenant = () => undefined;
      setProducts([]);
      setStations({});
      if (!user) return;
      unsubscribeTenant = onSnapshot(
        doc(db, 'tenants', user.uid),
        snapshot => {
          const nextProducts = parsePublicProducts(snapshot.data()?.publicProducts);
          const nextStations = readProductPreparationStationsFromTenant(
            snapshot.data()
          );
          setProducts(nextProducts);
          setStations(nextStations);
          cacheProductPreparationStations(nextStations);
        },
        caught => {
          console.warn('Roteamento de produção indisponível.', caught);
          setError('Não foi possível carregar as rotas de produção.');
        }
      );
    });
    return () => {
      unsubscribeAuth();
      unsubscribeTenant();
    };
  }, []);

  useEffect(() => {
    const refreshSpaces = (): void => setProductionSpaces(readProductionSpaces());
    window.addEventListener('storage', refreshSpaces);
    const interval = window.setInterval(refreshSpaces, 2_000);
    return () => {
      window.removeEventListener('storage', refreshSpaces);
      window.clearInterval(interval);
    };
  }, []);

  const orderedProducts = useMemo(
    () => [...products].sort((left, right) => left.name.localeCompare(right.name, 'pt-BR')),
    [products]
  );

  if (!host) return null;

  const content = (
    <section className="mt-3 rounded-2xl border border-violet-500/20 bg-violet-500/5 p-3">
      <div className="flex items-start gap-2">
        <Boxes className="mt-0.5 h-4 w-4 shrink-0 text-violet-300" />
        <div>
          <strong className="block text-[10px] font-black uppercase tracking-wide text-violet-200">
            Estação de preparo por item
          </strong>
          <p className="mt-1 text-[9px] leading-relaxed text-slate-500">
            A rota é usada pelo painel de Pedidos para separar BAR, COZINHA, EXPEDIÇÃO e outros setores cadastrados em Ambientes.
          </p>
        </div>
      </div>

      {error && (
        <p className="mt-3 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-[9px] text-red-200">
          {error}
        </p>
      )}

      {orderedProducts.length > 0 ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {orderedProducts.map(product => {
            const busy = busyProductId === product.id;
            const current = stations[product.id] ?? DEFAULT_PRODUCTION_STATION;
            return (
              <label
                key={product.id}
                className="rounded-xl border border-slate-800 bg-slate-950/75 p-2.5"
              >
                <span className="block truncate text-[10px] font-bold text-slate-200">
                  {product.name}
                </span>
                <select
                  value={current}
                  disabled={busy}
                  onChange={event => {
                    const user = auth.currentUser;
                    if (!user) {
                      setError('Faça login novamente para alterar a rota.');
                      return;
                    }
                    const nextStation = event.target.value;
                    setBusyProductId(product.id);
                    setError('');
                    void persistProductPreparationStation(
                      user,
                      product.id,
                      nextStation
                    )
                      .then(setStations)
                      .catch(caught => {
                        setError(
                          caught instanceof Error
                            ? caught.message
                            : 'Não foi possível salvar a rota.'
                        );
                      })
                      .finally(() => setBusyProductId(''));
                  }}
                  className="mt-2 w-full rounded-lg border border-slate-800 bg-slate-900 px-2 py-2 text-[9px] font-black uppercase text-violet-200 outline-none focus:border-violet-400 disabled:opacity-50"
                >
                  {productionSpaces.map(space => (
                    <option key={space} value={space}>{space}</option>
                  ))}
                </select>
                {busy && (
                  <span className="mt-1 flex items-center gap-1 text-[8px] text-slate-600">
                    <LoaderCircle className="h-3 w-3 animate-spin" /> Salvando
                  </span>
                )}
              </label>
            );
          })}
        </div>
      ) : (
        <p className="mt-3 text-[9px] text-slate-600">
          Cadastre produtos ou serviços para definir as estações.
        </p>
      )}
    </section>
  );

  return createPortal(content, host);
}
