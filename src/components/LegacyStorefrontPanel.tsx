import React, { useEffect, useState } from 'react';
import {
  Info,
  MapPin,
  Store as StoreIcon,
  X,
  Zap,
} from 'lucide-react';
import type { CartItem, Product, Store } from '../types';
import { SharedPdvCatalog } from './pdv/SharedPdvCatalog';

interface StorefrontPanelProps {
  activeConsumerStore: Store | undefined;
  products: Product[];
  cart: CartItem[];
  setIsCartOpen: (val: boolean) => void;
  handleAddToCart: (product: Product) => void;
  stores: Store[];
  setActiveConsumerStore: (store: Store) => void;
  activeKdsOrderCount?: number;
  salesByProductId?: Record<string, number>;
}

type StorefrontProduct = Product & {
  storeId?: string;
};

const getStoreInitials = (name: string): string => {
  const initials = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part.charAt(0).toUpperCase())
    .join('');

  return initials || 'K';
};

export const StorefrontPanel: React.FC<StorefrontPanelProps> = ({
  activeConsumerStore,
  products,
  cart,
  setIsCartOpen,
  handleAddToCart,
  stores,
  setActiveConsumerStore,
  activeKdsOrderCount = 0,
  salesByProductId = {},
}) => {
  const [isStoreInfoOpen, setIsStoreInfoOpen] = useState(false);

  useEffect(() => {
    setIsStoreInfoOpen(false);
  }, [activeConsumerStore?.id]);

  if (!activeConsumerStore) {
    return (
      <section
        className="rounded-3xl border border-dashed border-slate-800 bg-slate-900/45 px-5 py-14 text-center"
        id="storefront-selection-needed"
      >
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-slate-800 bg-slate-950 text-orange-400">
          <StoreIcon className="h-6 w-6" />
        </div>
        <h3 className="text-base font-black uppercase tracking-wide text-white">
          Escolha uma vitrine
        </h3>
        <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-slate-500">
          As lojas publicadas no marketplace aparecerão aqui para você conhecer suas ofertas.
        </p>

        {stores.length > 0 ? (
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            {stores.map(store => (
              <button
                key={store.id}
                type="button"
                onClick={() => setActiveConsumerStore(store)}
                className="flex min-h-11 items-center gap-2 rounded-2xl border border-slate-800 bg-slate-950 px-4 py-2.5 text-xs font-bold text-slate-200 transition-colors hover:border-orange-500/40 hover:text-white"
                id={`select-store-btn-${store.id}`}
              >
                <span
                  className="h-3 w-3 rounded-full"
                  style={{ backgroundColor: store.primaryColor || '#f97316' }}
                />
                <span>{store.name || 'Loja sem nome'}</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="mt-6 text-[11px] font-mono uppercase tracking-wide text-slate-600">
            Nenhuma vitrine pública disponível no momento
          </p>
        )}
      </section>
    );
  }

  const accentColor = activeConsumerStore.primaryColor || '#f97316';
  const storeKeywords = Array.from(
    new Set(
      (activeConsumerStore.keywords ?? [])
        .map(keyword => keyword.trim())
        .filter(Boolean)
    )
  );
  const otherStores = stores.filter(store => store.id !== activeConsumerStore.id);
  const storefrontOffers = products.filter(product => {
    const offer = product as StorefrontProduct;
    const belongsToStore =
      offer.storeId === activeConsumerStore.id ||
      product.supplierId === activeConsumerStore.id;

    return belongsToStore && product.wholesalePrice === undefined;
  });

  const movementMetadata = (() => {
    if (activeConsumerStore.status === 'closed') {
      return {
        label: 'Loja fechada',
        colorClassName: 'text-slate-400',
      };
    }

    if (activeKdsOrderCount > 20) {
      return {
        label: `Movimento muito alto: ${activeKdsOrderCount} pedidos ativos`,
        colorClassName: 'text-orange-500',
      };
    }

    if (activeKdsOrderCount > 10) {
      return {
        label: `Movimento alto: ${activeKdsOrderCount} pedidos ativos`,
        colorClassName: 'text-amber-400',
      };
    }

    return {
      label: `Loja aberta: ${activeKdsOrderCount} pedidos ativos`,
      colorClassName: 'text-emerald-400',
    };
  })();

  return (
    <div className="space-y-6 animate-fade-in" id="storefront-panel-container">
      <section
        className="relative overflow-hidden rounded-3xl border border-slate-800 bg-slate-950 shadow-2xl"
        id="storefront-banner"
      >
        <div className="relative min-h-48 overflow-hidden">
          {activeConsumerStore.banner ? (
            <img
              src={activeConsumerStore.banner}
              alt=""
              className="absolute inset-0 h-full w-full object-cover opacity-35"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div
              className="absolute inset-0 opacity-30"
              style={{
                background: `radial-gradient(circle at top right, ${accentColor}, transparent 58%)`,
              }}
            />
          )}

          <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/80 to-slate-950/25" />

          <div className="relative z-10 flex min-h-48 flex-col justify-end gap-5 p-5 sm:p-7">
            <div className="flex items-start gap-4">
              <button
                type="button"
                onClick={() => setIsStoreInfoOpen(true)}
                className="group relative shrink-0 rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-orange-400"
                aria-label={`Abrir informações públicas de ${activeConsumerStore.name}`}
                id="storefront-store-info-trigger"
              >
                {activeConsumerStore.logo ? (
                  <img
                    src={activeConsumerStore.logo}
                    alt={activeConsumerStore.name}
                    className="h-16 w-16 rounded-2xl border border-white/10 bg-slate-900 object-cover shadow-xl transition-transform group-hover:scale-[1.03]"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <span
                    className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/10 text-xl font-black text-white shadow-xl transition-transform group-hover:scale-[1.03]"
                    style={{ backgroundColor: accentColor }}
                    aria-label={`Iniciais de ${activeConsumerStore.name}`}
                  >
                    {getStoreInitials(activeConsumerStore.name)}
                  </span>
                )}

                <Zap
                  className={`absolute -bottom-1 -right-1 h-5 w-5 fill-current drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)] ${movementMetadata.colorClassName}`}
                  aria-hidden="true"
                />
                <span className="sr-only">{movementMetadata.label}</span>
              </button>

              <div className="min-w-0 flex-1">
                <span className="font-mono text-[9px] font-black uppercase tracking-[0.2em] text-orange-300">
                  Vitrine pública
                </span>
                <h2 className="mt-1 truncate text-2xl font-black tracking-tight text-white sm:text-3xl">
                  {activeConsumerStore.name || 'Loja sem nome'}
                </h2>
                <p className="mt-2 max-w-2xl text-xs leading-relaxed text-slate-300 sm:text-sm">
                  {activeConsumerStore.description ||
                    'Esta loja ainda não adicionou uma descrição pública.'}
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <SharedPdvCatalog
        idPrefix="storefront"
        resetKey={activeConsumerStore.id}
        products={storefrontOffers}
        keywords={storeKeywords}
        selectedItems={cart}
        onAddProduct={handleAddToCart}
        accentColor={accentColor}
        salesByProductId={salesByProductId}
        primaryAction={{
          onClick: () => setIsCartOpen(true),
          disabled: cart.length === 0,
          label: 'Revisar e enviar itens para aprovação da loja',
          title: 'Revisar e enviar',
        }}
        secondaryAction={{
          onClick: () => setIsCartOpen(true),
          label: 'Abrir finalizar pedido, meu pedido e conta',
          title: 'Finalizar pedido, acompanhar e consultar conta',
        }}
      />

      {otherStores.length > 0 && (
        <section
          className="space-y-3 border-t border-slate-800 pt-5"
          aria-label="Outras vitrines"
        >
          <span className="font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-slate-500">
            Outras vitrines
          </span>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {otherStores.map(store => (
              <button
                key={store.id}
                type="button"
                onClick={() => setActiveConsumerStore(store)}
                className="flex min-h-11 shrink-0 items-center gap-2 rounded-2xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-bold text-slate-300 transition-colors hover:border-orange-500/35 hover:text-white"
              >
                {store.logo ? (
                  <img
                    src={store.logo}
                    alt=""
                    className="h-7 w-7 rounded-lg object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <span
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-[9px] font-black text-white"
                    style={{ backgroundColor: store.primaryColor || '#f97316' }}
                  >
                    {getStoreInitials(store.name)}
                  </span>
                )}
                {store.name || 'Loja sem nome'}
              </button>
            ))}
          </div>
        </section>
      )}

      {isStoreInfoOpen && (
        <div
          className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/85 p-0 backdrop-blur-md sm:items-center sm:p-5"
          role="presentation"
          onClick={() => setIsStoreInfoOpen(false)}
        >
          <section
            className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-slate-800 bg-slate-900 p-5 shadow-2xl sm:rounded-3xl sm:p-6"
            role="dialog"
            aria-modal="true"
            aria-labelledby="storefront-store-info-title"
            onClick={event => event.stopPropagation()}
            id="storefront-store-info-modal"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex min-w-0 items-center gap-3">
                {activeConsumerStore.logo ? (
                  <img
                    src={activeConsumerStore.logo}
                    alt={activeConsumerStore.name}
                    className="h-14 w-14 shrink-0 rounded-2xl border border-slate-800 object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <span
                    className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-base font-black text-white"
                    style={{ backgroundColor: accentColor }}
                  >
                    {getStoreInitials(activeConsumerStore.name)}
                  </span>
                )}
                <div className="min-w-0">
                  <span className="font-mono text-[9px] font-black uppercase tracking-[0.18em] text-orange-400">
                    Informações da loja
                  </span>
                  <h3
                    id="storefront-store-info-title"
                    className="mt-1 truncate text-lg font-black text-white"
                  >
                    {activeConsumerStore.name || 'Loja sem nome'}
                  </h3>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setIsStoreInfoOpen(false)}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-800 bg-slate-950 text-slate-500 hover:text-white"
                aria-label="Fechar informações da loja"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-5 space-y-4">
              <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
                <span className="flex items-center gap-2 text-[10px] font-black uppercase text-slate-300">
                  <Info className="h-4 w-4" style={{ color: accentColor }} />
                  Sobre
                </span>
                <p className="mt-2 whitespace-pre-line text-xs leading-relaxed text-slate-400">
                  {activeConsumerStore.description ||
                    'Esta loja ainda não adicionou uma descrição pública.'}
                </p>
              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
                <span className="flex items-center gap-2 text-[10px] font-black uppercase text-slate-300">
                  <MapPin className="h-4 w-4" style={{ color: accentColor }} />
                  Endereço
                </span>
                <p className="mt-2 text-xs leading-relaxed text-slate-400">
                  {activeConsumerStore.address || 'Endereço não informado.'}
                </p>
              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
                <span className="flex items-center gap-2 text-[10px] font-black uppercase text-slate-300">
                  <Zap
                    className={`h-4 w-4 fill-current ${movementMetadata.colorClassName}`}
                  />
                  Movimento atual
                </span>
                <p className="mt-2 text-xs leading-relaxed text-slate-400">
                  {movementMetadata.label}
                </p>
              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
                <span className="text-[10px] font-black uppercase text-slate-300">
                  Palavras-chave
                </span>
                {storeKeywords.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {storeKeywords.map(keyword => (
                      <span
                        key={keyword}
                        className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-1.5 text-[9px] font-bold text-slate-400"
                      >
                        {keyword}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-slate-500">
                    Palavras-chave não informadas.
                  </p>
                )}
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
};
