import React, { useEffect, useState } from 'react';
import {
  ChevronRight,
  FolderOpen,
  Info,
  ListChecks,
  MapPin,
  PackageSearch,
  Plus,
  Send,
  ShoppingBag,
  Store as StoreIcon,
  X,
  Zap,
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
  activeKdsOrderCount?: number;
  salesByProductId?: Record<string, number>;
}

type StorefrontProduct = Product & {
  storeId?: string;
  updatedAt?: string;
};

type NativeStorefrontFilter = 'new' | 'best_sellers';

type CollectionCard = {
  key: string;
  name: string;
  path: string;
  segments: string[];
  image: string;
  itemCount: number;
};

const KEYWORD_FILTER_PREFIX = 'keyword:';

const currencyFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

const normalizeSearchValue = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLocaleLowerCase('pt-BR');

const splitCategoryPath = (category: string): string[] =>
  category
    .split(/\s*(?:>|\/)\s*/)
    .map(segment => segment.trim())
    .filter(Boolean);

const normalizePath = (segments: string[]): string =>
  segments.map(normalizeSearchValue).join(' > ');

const categoryStartsWithPath = (
  category: string,
  expectedPath: string[]
): boolean => {
  const productSegments = splitCategoryPath(category);
  if (productSegments.length < expectedPath.length) return false;

  return expectedPath.every(
    (segment, index) =>
      normalizeSearchValue(productSegments[index] ?? '') ===
      normalizeSearchValue(segment)
  );
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

const getProductRecency = (product: Product): number => {
  const storefrontProduct = product as StorefrontProduct;
  const updatedAt = storefrontProduct.updatedAt?.trim() ?? '';
  const parsedUpdatedAt = Date.parse(updatedAt);
  if (Number.isFinite(parsedUpdatedAt)) return parsedUpdatedAt;

  const idTimestamp = product.id.match(/(\d{10,})$/)?.[1];
  const parsedIdTimestamp = idTimestamp ? Number(idTimestamp) : 0;
  return Number.isFinite(parsedIdTimestamp) ? parsedIdTimestamp : 0;
};

const sortByNewest = (offers: Product[]): Product[] =>
  [...offers].sort((left, right) => {
    const recencyDifference = getProductRecency(right) - getProductRecency(left);
    return recencyDifference || right.id.localeCompare(left.id);
  });

const findCollectionImage = (product: Product, path: string[]): string => {
  const normalizedTarget = normalizePath(path);
  const configuredImage = product.categoryCollections?.find(
    collection =>
      normalizePath(splitCategoryPath(collection.path)) === normalizedTarget &&
      collection.image.trim()
  )?.image;

  return configuredImage?.trim() || product.image.trim();
};

const buildChildCollections = (
  offers: Product[],
  currentPath: string[]
): CollectionCard[] => {
  const collections = new Map<string, CollectionCard>();

  for (const product of sortByNewest(offers)) {
    if (!categoryStartsWithPath(product.category, currentPath)) continue;
    const segments = splitCategoryPath(product.category);
    if (segments.length <= currentPath.length) continue;

    const childSegments = segments.slice(0, currentPath.length + 1);
    const key = normalizePath(childSegments);
    const existing = collections.get(key);

    if (existing) {
      existing.itemCount += 1;
      if (!existing.image) {
        existing.image = findCollectionImage(product, childSegments);
      }
      continue;
    }

    collections.set(key, {
      key,
      name: childSegments.at(-1) ?? '',
      path: childSegments.join(' > '),
      segments: childSegments,
      image: findCollectionImage(product, childSegments),
      itemCount: 1,
    });
  }

  return [...collections.values()].sort((left, right) =>
    left.name.localeCompare(right.name, 'pt-BR')
  );
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
  const [selectedFilter, setSelectedFilter] = useState<
    NativeStorefrontFilter | string
  >('new');
  const [collectionPath, setCollectionPath] = useState<string[]>([]);
  const [isStoreInfoOpen, setIsStoreInfoOpen] = useState(false);

  useEffect(() => {
    setSelectedFilter('new');
    setCollectionPath([]);
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
  const cartItemsCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const cartSubtotal = cart.reduce(
    (sum, item) => sum + item.product.price * item.quantity,
    0
  );
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

  const selectedKeyword = selectedFilter.startsWith(KEYWORD_FILTER_PREFIX)
    ? selectedFilter.slice(KEYWORD_FILTER_PREFIX.length)
    : '';
  const activeCollectionPath = selectedKeyword
    ? collectionPath.length > 0 &&
      normalizeSearchValue(collectionPath[0] ?? '') ===
        normalizeSearchValue(selectedKeyword)
      ? collectionPath
      : [selectedKeyword]
    : [];

  const filteredOffers = (() => {
    if (selectedFilter === 'best_sellers') {
      return sortByNewest(storefrontOffers).sort((left, right) => {
        const salesDifference =
          (salesByProductId[right.id] ?? 0) - (salesByProductId[left.id] ?? 0);
        return salesDifference || getProductRecency(right) - getProductRecency(left);
      });
    }

    if (selectedKeyword) {
      return sortByNewest(
        storefrontOffers.filter(product =>
          categoryStartsWithPath(product.category, activeCollectionPath)
        )
      );
    }

    return sortByNewest(storefrontOffers);
  })();

  const childCollections = selectedKeyword
    ? buildChildCollections(storefrontOffers, activeCollectionPath)
    : [];
  const currentCollectionName = activeCollectionPath.at(-1) ?? selectedKeyword;

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

  const filterButtonClassName = (active: boolean): string =>
    `min-h-9 shrink-0 rounded-xl border px-3 text-[9px] font-black uppercase tracking-wide transition-colors ${
      active
        ? 'border-orange-500/50 bg-orange-500/15 text-orange-300'
        : 'border-slate-800 bg-slate-900 text-slate-500 hover:text-slate-300'
    }`;

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

        <div
          className="border-t border-slate-800 bg-slate-950/95 p-4 sm:p-5"
          id="storefront-selected-items"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <span className="flex items-center gap-2 text-[10px] font-black uppercase tracking-wide text-slate-200">
                <ListChecks className="h-4 w-4" style={{ color: accentColor }} />
                Itens adicionados
              </span>
              <p className="mt-1 text-[10px] text-slate-500">
                {cartItemsCount > 0
                  ? `${cartItemsCount} item(ns) · ${currencyFormatter.format(cartSubtotal)}`
                  : 'Selecione produtos para montar sua solicitação.'}
              </p>
            </div>

            <button
              type="button"
              onClick={() => setIsCartOpen(true)}
              disabled={cartItemsCount === 0}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-white shadow-lg transition-transform hover:scale-105 disabled:cursor-not-allowed disabled:opacity-35"
              style={{ backgroundColor: accentColor }}
              id="storefront-send-selection-btn"
              aria-label="Revisar e enviar itens para aprovação da loja"
              title="Revisar e enviar"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>

          {cart.length > 0 && (
            <ul className="mt-3 grid gap-2 sm:grid-cols-2" aria-label="Itens selecionados">
              {cart.map(item => (
                <li
                  key={item.product.id}
                  className="flex min-w-0 items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900/80 px-3 py-2"
                >
                  <span className="min-w-0 truncate text-[10px] font-bold text-slate-300">
                    {item.quantity}× {item.product.name}
                  </span>
                  <span className="shrink-0 font-mono text-[9px] text-slate-500">
                    {currencyFormatter.format(item.product.price * item.quantity)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="space-y-4" aria-labelledby="storefront-offers-title">
        <div className="border-b border-slate-800 pb-3">
          <div className="flex items-end justify-between gap-3">
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
              {filteredOffers.length} {filteredOffers.length === 1 ? 'oferta' : 'ofertas'}
            </span>
          </div>

          <div
            className="mt-3 flex gap-2 overflow-x-auto pb-1"
            id="storefront-keyword-filters"
            aria-label="Filtros nativos do ERP e palavras-chave da loja"
          >
            <button
              type="button"
              onClick={() => {
                setSelectedFilter('new');
                setCollectionPath([]);
              }}
              className={filterButtonClassName(selectedFilter === 'new')}
              id="storefront-filter-new"
            >
              Novidades
            </button>
            <button
              type="button"
              onClick={() => {
                setSelectedFilter('best_sellers');
                setCollectionPath([]);
              }}
              className={filterButtonClassName(selectedFilter === 'best_sellers')}
              id="storefront-filter-best-sellers"
            >
              Mais vendido
            </button>
            {storeKeywords.map(keyword => {
              const filterId = `${KEYWORD_FILTER_PREFIX}${keyword}`;
              return (
                <button
                  key={keyword}
                  type="button"
                  onClick={() => {
                    setSelectedFilter(filterId);
                    setCollectionPath([keyword]);
                  }}
                  className={filterButtonClassName(selectedFilter === filterId)}
                >
                  {keyword}
                </button>
              );
            })}
          </div>
        </div>

        {selectedKeyword && (
          <section
            className="space-y-3 rounded-3xl border border-slate-800 bg-slate-950/65 p-3 sm:p-4"
            id="storefront-collection-browser"
            aria-label={`Coleções da categoria ${selectedKeyword}`}
          >
            <nav
              className="flex max-w-full items-center gap-1 overflow-x-auto pb-1"
              id="storefront-collection-breadcrumb"
              aria-label="Caminho da coleção"
            >
              {activeCollectionPath.map((segment, index) => (
                <React.Fragment key={`${normalizeSearchValue(segment)}-${index}`}>
                  {index > 0 && (
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-700" />
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      setCollectionPath(activeCollectionPath.slice(0, index + 1))
                    }
                    className={`min-h-8 shrink-0 rounded-xl px-2.5 text-[9px] font-black uppercase transition-colors ${
                      index === activeCollectionPath.length - 1
                        ? 'bg-orange-500/15 text-orange-300'
                        : 'text-slate-500 hover:bg-slate-900 hover:text-slate-300'
                    }`}
                  >
                    {segment}
                  </button>
                </React.Fragment>
              ))}
            </nav>

            {childCollections.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <span className="font-mono text-[8px] font-black uppercase tracking-[0.16em] text-slate-600">
                      Navegue pelas coleções
                    </span>
                    <h4 className="mt-0.5 text-xs font-black text-white">
                      Dentro de {currentCollectionName}
                    </h4>
                  </div>
                  <span className="text-[9px] text-slate-600">
                    {childCollections.length} coleção(ões)
                  </span>
                </div>

                <div
                  className="grid auto-cols-[minmax(138px,44%)] grid-flow-col gap-2.5 overflow-x-auto pb-2 sm:auto-cols-[180px]"
                  id="storefront-subcategory-collections"
                >
                  {childCollections.map(collection => (
                    <button
                      key={collection.key}
                      type="button"
                      onClick={() => setCollectionPath(collection.segments)}
                      className="group relative aspect-[4/3] min-w-0 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 text-left transition-all hover:-translate-y-0.5 hover:border-orange-500/40"
                      aria-label={`Abrir coleção ${collection.path}`}
                    >
                      {collection.image ? (
                        <img
                          src={collection.image}
                          alt=""
                          className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center text-slate-700">
                          <FolderOpen className="h-8 w-8" />
                        </div>
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/30 to-transparent" />
                      <div className="absolute inset-x-0 bottom-0 p-3">
                        <strong className="block truncate text-xs font-black text-white">
                          {collection.name}
                        </strong>
                        <span className="mt-0.5 block text-[9px] text-slate-400">
                          {collection.itemCount} item(ns)
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}

        {filteredOffers.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {filteredOffers.map(product => {
              const isUnavailable = !product.isService && product.stock <= 0;
              const productCategorySegments = splitCategoryPath(product.category);
              const productLeafCategory =
                productCategorySegments.at(-1) || product.category || 'Produto';

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

                    <span className="absolute left-3 top-3 max-w-[80%] truncate rounded-lg border border-slate-700 bg-slate-950/85 px-2.5 py-1 font-mono text-[9px] font-bold uppercase text-slate-300 backdrop-blur-sm">
                      {product.isService ? 'Serviço' : productLeafCategory}
                    </span>
                  </div>

                  <div className="space-y-4 p-4">
                    <div>
                      <h4 className="text-sm font-black text-white">{product.name}</h4>
                      {productCategorySegments.length > 1 && (
                        <p className="mt-1 line-clamp-1 font-mono text-[8px] uppercase tracking-wide text-orange-300/70">
                          {productCategorySegments.join(' › ')}
                        </p>
                      )}
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
                          {currencyFormatter.format(product.price)}
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
                        <Plus className="h-4 w-4" />
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
              {selectedKeyword ? 'Nenhuma oferta nesta coleção' : 'Nenhuma oferta publicada'}
            </h4>
            <p className="mx-auto mt-2 max-w-sm text-xs leading-relaxed text-slate-500">
              {selectedKeyword
                ? `Não encontramos produtos em “${activeCollectionPath.join(' › ')}”.`
                : 'Os produtos e serviços aparecerão aqui quando o lojista publicar ofertas vinculadas a esta vitrine.'}
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
                  <Zap className={`h-4 w-4 fill-current ${movementMetadata.colorClassName}`} />
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
