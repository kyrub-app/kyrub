import { useEffect, useMemo, useState } from 'react';
import type React from 'react';
import {
  ChevronRight,
  FolderOpen,
  ListChecks,
  PackageSearch,
  Plus,
  ReceiptText,
  Send,
} from 'lucide-react';
import type { Product } from '../../types';

export interface PdvSelectedItem {
  product: Product;
  quantity: number;
}

interface PdvAction {
  onClick: () => void;
  label: string;
  title?: string;
  disabled?: boolean;
  busy?: boolean;
}

interface SharedPdvCatalogProps {
  idPrefix: string;
  resetKey: string;
  products: Product[];
  keywords: string[];
  selectedItems: PdvSelectedItem[];
  onAddProduct: (product: Product) => void;
  primaryAction: PdvAction;
  secondaryAction: PdvAction;
  accentColor?: string;
  salesByProductId?: Record<string, number>;
  emptySelectionMessage?: string;
  emptyCatalogMessage?: string;
}

type NativePdvFilter = 'new' | 'best_sellers';

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

const getProductRecency = (product: Product): number => {
  const updatedAt = (product as Product & { updatedAt?: string }).updatedAt?.trim() ?? '';
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

export const SharedPdvCatalog: React.FC<SharedPdvCatalogProps> = ({
  idPrefix,
  resetKey,
  products,
  keywords,
  selectedItems,
  onAddProduct,
  primaryAction,
  secondaryAction,
  accentColor = '#f97316',
  salesByProductId = {},
  emptySelectionMessage = 'Selecione produtos para montar sua solicitação.',
  emptyCatalogMessage = 'Nenhum produto ou serviço foi publicado nesta categoria.',
}) => {
  const [selectedFilter, setSelectedFilter] = useState<NativePdvFilter | string>(
    'new'
  );
  const [collectionPath, setCollectionPath] = useState<string[]>([]);

  useEffect(() => {
    setSelectedFilter('new');
    setCollectionPath([]);
  }, [resetKey]);

  const normalizedKeywords = useMemo(
    () =>
      Array.from(
        new Map(
          keywords
            .map(keyword => keyword.trim())
            .filter(Boolean)
            .map(keyword => [normalizeSearchValue(keyword), keyword])
        ).values()
      ),
    [keywords]
  );

  const selectedQuantity = selectedItems.reduce(
    (sum, item) => sum + item.quantity,
    0
  );
  const selectedSubtotal = selectedItems.reduce(
    (sum, item) => sum + item.product.price * item.quantity,
    0
  );

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

  const filteredProducts = useMemo(() => {
    if (selectedFilter === 'best_sellers') {
      return sortByNewest(products).sort((left, right) => {
        const salesDifference =
          (salesByProductId[right.id] ?? 0) -
          (salesByProductId[left.id] ?? 0);
        return salesDifference || getProductRecency(right) - getProductRecency(left);
      });
    }

    if (selectedKeyword) {
      return sortByNewest(
        products.filter(product =>
          categoryStartsWithPath(product.category, activeCollectionPath)
        )
      );
    }

    return sortByNewest(products);
  }, [activeCollectionPath, products, salesByProductId, selectedFilter, selectedKeyword]);

  const childCollections = useMemo(
    () =>
      selectedKeyword
        ? buildChildCollections(products, activeCollectionPath)
        : [],
    [activeCollectionPath, products, selectedKeyword]
  );

  const filterButtonClassName = (active: boolean): string =>
    `min-h-9 shrink-0 rounded-xl border px-3 text-[9px] font-black uppercase tracking-wide transition-colors ${
      active
        ? 'border-orange-500/50 bg-orange-500/15 text-orange-300'
        : 'border-slate-800 bg-slate-900 text-slate-500 hover:text-slate-300'
    }`;

  const selectedItemsId = `${idPrefix}-selected-items`;
  const sendButtonId = `${idPrefix}-send-selection-btn`;
  const accountButtonId = `${idPrefix}-account-btn`;
  const filtersId = `${idPrefix}-keyword-filters`;
  const collectionBrowserId = `${idPrefix}-collection-browser`;
  const productIdPrefix = `${idPrefix}-prod-`;

  return (
    <section
      className="overflow-hidden rounded-3xl border border-slate-800 bg-slate-950/70 shadow-xl"
      id={`${idPrefix}-pdv-catalog`}
      aria-label="PDV de produtos e serviços"
    >
      <div
        className="border-b border-slate-800 bg-slate-950/95 p-4 sm:p-5"
        id={selectedItemsId}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <span className="flex items-center gap-2 text-[10px] font-black uppercase tracking-wide text-slate-200">
              <ListChecks className="h-4 w-4" style={{ color: accentColor }} />
              Itens adicionados
            </span>
            <p className="mt-1 text-[10px] text-slate-500">
              {selectedQuantity > 0
                ? `${selectedQuantity} item(ns) · ${currencyFormatter.format(selectedSubtotal)}`
                : emptySelectionMessage}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={primaryAction.onClick}
              disabled={primaryAction.disabled || primaryAction.busy}
              className="flex h-11 w-11 items-center justify-center rounded-2xl text-white shadow-lg transition-transform hover:scale-105 disabled:cursor-not-allowed disabled:opacity-35"
              style={{ backgroundColor: accentColor }}
              id={sendButtonId}
              aria-label={primaryAction.label}
              title={primaryAction.title ?? primaryAction.label}
            >
              <Send className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={secondaryAction.onClick}
              disabled={secondaryAction.disabled || secondaryAction.busy}
              className="flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-700 bg-slate-900 text-slate-200 shadow-lg transition-transform hover:scale-105 hover:border-orange-500/40 hover:text-orange-300 disabled:cursor-not-allowed disabled:opacity-35"
              id={accountButtonId}
              aria-label={secondaryAction.label}
              title={secondaryAction.title ?? secondaryAction.label}
            >
              <ReceiptText className="h-4 w-4" />
            </button>
          </div>
        </div>

        {selectedItems.length > 0 && (
          <ul className="mt-3 grid gap-2 sm:grid-cols-2" aria-label="Itens selecionados">
            {selectedItems.map(item => (
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

      <div className="space-y-4 p-3 sm:p-4">
        <div
          className="flex gap-2 overflow-x-auto border-b border-slate-800 pb-3"
          id={filtersId}
          aria-label="Filtros do PDV e palavras-chave da loja"
        >
          <button
            type="button"
            onClick={() => {
              setSelectedFilter('new');
              setCollectionPath([]);
            }}
            className={filterButtonClassName(selectedFilter === 'new')}
            id={`${idPrefix}-filter-new`}
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
            id={`${idPrefix}-filter-best-sellers`}
          >
            Mais vendido
          </button>
          {normalizedKeywords.map(keyword => {
            const filterId = `${KEYWORD_FILTER_PREFIX}${keyword}`;
            return (
              <button
                key={normalizeSearchValue(keyword)}
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

        {selectedKeyword && (
          <div
            className="space-y-3 rounded-3xl border border-slate-800 bg-slate-950/65 p-3 sm:p-4"
            id={collectionBrowserId}
            aria-label={`Coleções da categoria ${selectedKeyword}`}
          >
            <nav
              className="flex max-w-full items-center gap-1 overflow-x-auto pb-1"
              id={`${idPrefix}-collection-breadcrumb`}
              aria-label="Caminho da coleção"
            >
              {activeCollectionPath.map((segment, index) => (
                <span
                  key={`${normalizeSearchValue(segment)}-${index}`}
                  className="flex shrink-0 items-center gap-1"
                >
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
                </span>
              ))}
            </nav>

            {childCollections.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <strong className="text-xs font-black text-white">
                    Dentro de {activeCollectionPath.at(-1) ?? selectedKeyword}
                  </strong>
                  <span className="text-[9px] text-slate-600">
                    {childCollections.length} coleção(ões)
                  </span>
                </div>

                <div
                  className="grid auto-cols-[minmax(138px,44%)] grid-flow-col gap-2.5 overflow-x-auto pb-2 sm:auto-cols-[180px]"
                  id={`${idPrefix}-subcategory-collections`}
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
          </div>
        )}

        {filteredProducts.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {filteredProducts.map(product => {
              const isUnavailable = !product.isService && product.stock <= 0;
              const productCategorySegments = splitCategoryPath(product.category);
              const productLeafCategory =
                productCategorySegments.at(-1) || product.category || 'Produto';

              return (
                <article
                  key={product.id}
                  className="overflow-hidden rounded-3xl border border-slate-800 bg-slate-900/70 transition-colors hover:border-slate-700"
                  id={`${productIdPrefix}${product.id}`}
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
                            {isUnavailable
                              ? 'Indisponível'
                              : `${product.stock} em estoque`}
                          </span>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => onAddProduct(product)}
                        disabled={isUnavailable}
                        className="flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2 text-[10px] font-black uppercase tracking-wide text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-35"
                        style={{ backgroundColor: accentColor }}
                        id={`${idPrefix}-add-${product.id}`}
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
              {selectedKeyword
                ? 'Nenhuma oferta nesta coleção'
                : 'Nenhum item disponível'}
            </h4>
            <p className="mx-auto mt-2 max-w-sm text-xs leading-relaxed text-slate-500">
              {selectedKeyword
                ? `Não encontramos produtos em “${activeCollectionPath.join(' › ')}”.`
                : emptyCatalogMessage}
            </p>
          </div>
        )}
      </div>
    </section>
  );
};
