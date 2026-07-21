import React from 'react';
import {
  Clock3,
  MapPin,
  PackageSearch,
  ShoppingBag,
  ShoppingCart,
  Store as StoreIcon,
  Tag,
} from 'lucide-react';
import { CartItem, Product, Store } from '../types';

interface StorefrontPanelProps {
  activeConsumerStore: Store | undefined;
  products: Product[];
  cart: CartItem[];
  setIsCartOpen: (val: boolean) => void;
  handleAddToCart: (product: Product) => void;
  stores: Store[];
  setActiveConsumerStore: (store: Store) => void;
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
}) => {
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
  const cartItemsCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const storeKeywords = activeConsumerStore.keywords?.filter(Boolean) ?? [];
  const otherStores = stores.filter(store => store.id !== activeConsumerStore.id);

  const storefrontOffers = products.filter(product => {
    const offer = product as StorefrontProduct;
    const belongsToStore =
      offer.storeId === activeConsumerStore.id ||
      product.supplierId === activeConsumerStore.id;

    return belongsToStore && product.wholesalePrice === undefined;
  });

  const categories = Array.from(
    new Set(storefrontOffers.map(product => product.category).filter(Boolean)),
  );

  const statusMetadata = (() => {
    switch (activeConsumerStore.status) {
      case 'open':
        return {
          label: 'Aberta agora',
          className: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300',
        };
      case 'delayed':
        return {
          label: 'Atendimento com espera',
          className: 'border-amber-500/25 bg-amber-500/10 text-amber-300',
        };
      case 'closed':
        return {
          label: 'Fechada no momento',
          className: 'border-slate-700 bg-slate-900 text-slate-400',
        };
      default:
        return {
          label: 'Horário não informado',
          className: 'border-slate-700 bg-slate-900 text-slate-400',
        };
    }
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
              {activeConsumerStore.logo ? (
                <img
                  src={activeConsumerStore.logo}
                  alt={activeConsumerStore.name}
                  className="h-16 w-16 shrink-0 rounded-2xl border border-white/10 bg-slate-900 object-cover shadow-xl"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div
                  className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border border-white/10 text-xl font-black text-white shadow-xl"
                  style={{ backgroundColor: accentColor }}
                  aria-label={`Iniciais de ${activeConsumerStore.name}`}
                >
                  {getStoreInitials(activeConsumerStore.name)}
                </div>
              )}

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

            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-wide ${statusMetadata.className}`}
              >
                <Clock3 className="h-3.5 w-3.5" />
                {statusMetadata.label}
              </span>

              {categories.slice(0, 3).map(category => (
                <span
                  key={category}
                  className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-slate-700 bg-slate-900/85 px-3 py-1 text-[10px] font-bold text-slate-300"
                >
                  <Tag className="h-3 w-3" />
                  {category}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="grid gap-3 border-t border-slate-800 bg-slate-950/95 p-4 sm:grid-cols-[1fr_auto] sm:items-center sm:p-5">
          <div className="min-w-0">
            {storeKeywords.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {storeKeywords.slice(0, 6).map(keyword => (
                  <span
                    key={keyword}
                    className="rounded-lg bg-slate-900 px-2.5 py-1 text-[9px] font-bold text-slate-400"
                  >
                    #{keyword}
                  </span>
                ))}
              </div>
            ) : (
              <span className="inline-flex items-center gap-2 text-[10px] text-slate-500">
                <MapPin className="h-3.5 w-3.5 text-orange-400" />
                Localização e categorias ainda não informadas
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={() => setIsCartOpen(true)}
            className="flex min-h-11 items-center justify-center gap-2 rounded-2xl px-5 py-3 text-xs font-black uppercase tracking-wide text-white shadow-lg transition-transform hover:scale-[1.01]"
            style={{ backgroundColor: accentColor }}
            id="storefront-view-cart-btn"
          >
            <ShoppingCart className="h-4 w-4" />
            Carrinho ({cartItemsCount})
          </button>
        </div>
      </section>

      <section className="space-y-4" aria-labelledby="storefront-offers-title">
        <div className="flex items-center justify-between gap-3 border-b border-slate-800 pb-3">
          <div>
            <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-slate-500">
              Produtos e serviços publicados
            </span>
            <h3
              id="storefront-offers-title"
              className="mt-1 flex items-center gap-2 text-lg font-black text-white"
            >
              <ShoppingBag className="h-5 w-5" style={{ color: accentColor }} />
              Ofertas da loja
            </h3>
          </div>
          <span className="rounded-full border border-slate-800 bg-slate-900 px-3 py-1 text-[10px] font-bold text-slate-400">
            {storefrontOffers.length} {storefrontOffers.length === 1 ? 'oferta' : 'ofertas'}
          </span>
        </div>

        {storefrontOffers.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {storefrontOffers.map(product => {
              const isUnavailable = !product.isService && product.stock <= 0;

              return (
                <article
                  key={product.id}
                  className="overflow-hidden rounded-3xl border border-slate-800 bg-slate-900/70 transition-colors hover:border-slate-700"
                  id={`storefront-prod-${product.id}`}
                >
                  <div className="relative aspect-[4/3] overflow-hidden bg-slate-950">
                    {product.image ? (
                      <img
                        src={product.image}
                        alt={product.name}
                        className="h-full w-full object-cover transition-transform duration-500 hover:scale-105"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-slate-700">
                        <PackageSearch className="h-10 w-10" />
                      </div>
                    )}

                    <span className="absolute left-3 top-3 rounded-lg border border-slate-700 bg-slate-950/85 px-2.5 py-1 font-mono text-[9px] font-bold uppercase text-slate-300 backdrop-blur-sm">
                      {product.isService ? 'Serviço' : product.category || 'Produto'}
                    </span>
                  </div>

                  <div className="space-y-4 p-4">
                    <div>
                      <h4 className="text-sm font-black text-white">{product.name}</h4>
                      <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-400">
                        {product.description || 'Descrição não informada.'}
                      </p>
                    </div>

                    <div className="flex items-end justify-between gap-3 border-t border-slate-800 pt-4">
                      <div>
                        <span className="block font-mono text-[8px] uppercase tracking-wide text-slate-500">
                          Valor
                        </span>
                        <span className="font-mono text-lg font-black text-white">
                          R$ {product.price.toFixed(2)}
                        </span>
                        {!product.isService && (
                          <span className="mt-1 block text-[9px] text-slate-500">
                            {isUnavailable ? 'Indisponível' : `${product.stock} em estoque`}
                          </span>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => handleAddToCart(product)}
                        disabled={isUnavailable}
                        className="flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2 text-[10px] font-black uppercase tracking-wide text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-35"
                        style={{ backgroundColor: accentColor }}
                        id={`add-to-cart-btn-${product.id}`}
                      >
                        <ShoppingCart className="h-4 w-4" />
                        Adicionar
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="rounded-3xl border border-dashed border-slate-800 bg-slate-900/40 px-5 py-12 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-800 bg-slate-950 text-orange-400">
              <PackageSearch className="h-5 w-5" />
            </div>
            <h4 className="text-sm font-black uppercase tracking-wide text-slate-100">
              Nenhuma oferta publicada
            </h4>
            <p className="mx-auto mt-2 max-w-sm text-xs leading-relaxed text-slate-500">
              Os produtos e serviços aparecerão aqui quando o lojista publicar ofertas vinculadas a esta vitrine.
            </p>
          </div>
        )}
      </section>

      {otherStores.length > 0 && (
        <section className="space-y-3 border-t border-slate-800 pt-5" aria-label="Outras vitrines">
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
    </div>
  );
};
