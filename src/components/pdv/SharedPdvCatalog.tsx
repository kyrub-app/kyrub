import { useEffect, useMemo, useState } from 'react';
import type React from 'react';
import {
  Check,
  ChevronRight,
  FolderOpen,
  ListChecks,
  PackageSearch,
  Plus,
  ReceiptText,
  Send,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import type { CartItem, Product } from '../../types';
import {
  buildProductConfigurationSelection,
  parseProductOptionGroups,
  type ProductConfigurationSelection,
} from '../../utils/productCustomization';

export interface PdvSelectedItem extends CartItem {}

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
  onAddProduct: (selection: ProductConfigurationSelection) => void;
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

const itemUnitPrice = (item: PdvSelectedItem): number =>
  item.unitPrice ?? (item.product.isComplimentary ? 0 : item.product.price);

const itemLineKey = (item: PdvSelectedItem): string =>
  item.lineKey ?? item.product.id;

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
  const [customizingProduct, setCustomizingProduct] = useState<Product | null>(null);
  const [selectedChoiceIds, setSelectedChoiceIds] = useState<
    Record<string, string[]>
  >({});
  const [customizationError, setCustomizationError] = useState('');

  useEffect(() => {
    setSelectedFilter('new');
    setCollectionPath([]);
    setCustomizingProduct(null);
    setSelectedChoiceIds({});
    setCustomizationError('');
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
    (sum, item) => sum + itemUnitPrice(item) * item.quantity,
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

  const customizationGroups = useMemo(
    () => parseProductOptionGroups(customizingProduct?.optionGroups),
    [customizingProduct]
  );

  const customizationPreview = useMemo(() => {
    if (!customizingProduct) return null;
    try {
      return buildProductConfigurationSelection(
        customizingProduct,
        selectedChoiceIds
      );
    } catch {
      return null;
    }
  }, [customizingProduct, selectedChoiceIds]);

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

  const startProductSelection = (product: Product): void => {
    const groups = parseProductOptionGroups(product.optionGroups);
    if (groups.length === 0) {
      onAddProduct(buildProductConfigurationSelection(product, {}));
      return;
    }

    const defaults = Object.fromEntries(
      groups.map(group => [
        group.id,
        group.minSelections > 0 && group.maxSelections === 1
          ? [group.choices[0]?.id].filter(Boolean)
          : [],
      ])
    );
    setSelectedChoiceIds(defaults);
    setCustomizationError('');
    setCustomizingProduct(product);
  };

  const toggleChoice = (
    groupId: string,
    choiceId: string,
    maxSelections: number
  ): void => {
    setCustomizationError('');
    setSelectedChoiceIds(previous => {
      const current = previous[groupId] ?? [];
      if (maxSelections === 1) {
        return { ...previous, [groupId]: [choiceId] };
      }
      if (current.includes(choiceId)) {
        return {
          ...previous,
          [groupId]: current.filter(id => id !== choiceId),
        };
      }
      if (current.length >= maxSelections) return previous;
      return { ...previous, [groupId]: [...current, choiceId] };
    });
  };

  const confirmCustomization = (): void => {
    if (!customizingProduct) return;
    try {
      const selection = buildProductConfigurationSelection(
        customizingProduct,
        selectedChoiceIds
      );
      onAddProduct(selection);
      setCustomizingProduct(null);
      setSelectedChoiceIds({});
      setCustomizationError('');
    } catch (error) {
      setCustomizationError(
        error instanceof Error ? error.message : 'Revise as opções escolhidas.'
      );
    }
  };

  return (
    <>
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
                  key={itemLineKey(item)}
                  className="flex min-w-0 items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900/80 px-3 py-2"
                >
                  <span className="min-w-0">
                    <strong className="block truncate text-[10px] font-bold text-slate-300">
                      {item.quantity}× {item.product.name}
                    </strong>
                    {item.customizationSummary && (
                      <span className="mt-0.5 block truncate text-[8px] text-orange-300/70">
                        {item.customizationSummary}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 font-mono text-[9px] text-slate-500">
                    {currencyFormatter.format(itemUnitPrice(item) * item.quantity)}
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
            <div
              className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4 2xl:grid-cols-5"
              id={`${idPrefix}-pdv-products-grid`}
            >
              {filteredProducts.map(product => {
                const isUnavailable = !product.isService && product.stock <= 0;
                const productCategorySegments = splitCategoryPath(product.category);
                const productLeafCategory =
                  productCategorySegments.at(-1) || product.category || 'Produto';
                const hasOptions = parseProductOptionGroups(product.optionGroups).length > 0;
                const basePrice = product.isComplimentary ? 0 : product.price;

                return (
                  <article
                    key={product.id}
                    className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/70 transition-colors hover:border-slate-700 sm:rounded-3xl"
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
                          <PackageSearch className="h-8 w-8 sm:h-10 sm:w-10" />
                        </div>
                      )}

                      <span className="absolute left-2 top-2 max-w-[80%] truncate rounded-lg border border-slate-700 bg-slate-950/85 px-2 py-1 font-mono text-[8px] font-bold uppercase text-slate-300 backdrop-blur-sm sm:left-3 sm:top-3 sm:px-2.5 sm:text-[9px]">
                        {product.isService ? 'Serviço' : productLeafCategory}
                      </span>
                      {product.isComplimentary && (
                        <span className="absolute right-2 top-2 rounded-lg bg-emerald-500 px-2 py-1 text-[8px] font-black uppercase text-slate-950 sm:right-3 sm:top-3">
                          Sem custo
                        </span>
                      )}
                    </div>

                    <div className="flex flex-1 flex-col gap-3 p-3 sm:gap-4 sm:p-4">
                      <div>
                        <h4 className="line-clamp-2 text-xs font-black text-white sm:text-sm">
                          {product.name}
                        </h4>
                        {productCategorySegments.length > 1 && (
                          <p className="mt-1 line-clamp-1 font-mono text-[7px] uppercase tracking-wide text-orange-300/70 sm:text-[8px]">
                            {productCategorySegments.join(' › ')}
                          </p>
                        )}
                        <p className="mt-1 line-clamp-2 text-[9px] leading-relaxed text-slate-400 sm:text-xs">
                          {product.description || 'Descrição não informada.'}
                        </p>
                        {hasOptions && (
                          <span className="mt-2 flex items-center gap-1 text-[8px] font-bold uppercase text-orange-300">
                            <SlidersHorizontal className="h-3 w-3" />
                            Personalizável
                          </span>
                        )}
                      </div>

                      <div className="mt-auto flex flex-col gap-2 border-t border-slate-800 pt-3 sm:flex-row sm:items-end sm:justify-between sm:gap-3 sm:pt-4">
                        <div>
                          <span className="block font-mono text-[7px] uppercase tracking-wide text-slate-500 sm:text-[8px]">
                            {hasOptions ? 'A partir de' : 'Valor'}
                          </span>
                          <span className="font-mono text-sm font-black text-white sm:text-lg">
                            {currencyFormatter.format(basePrice)}
                          </span>
                          {!product.isService && (
                            <span className="mt-1 block text-[8px] text-slate-500 sm:text-[9px]">
                              {isUnavailable
                                ? 'Indisponível'
                                : `${product.stock} em estoque`}
                            </span>
                          )}
                        </div>

                        <button
                          type="button"
                          onClick={() => startProductSelection(product)}
                          disabled={isUnavailable}
                          className="flex min-h-9 w-full items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-[8px] font-black uppercase tracking-wide text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-35 sm:min-h-11 sm:w-auto sm:px-4 sm:text-[10px]"
                          style={{ backgroundColor: accentColor }}
                          id={`${idPrefix}-add-${product.id}`}
                        >
                          {hasOptions ? (
                            <SlidersHorizontal className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                          ) : (
                            <Plus className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                          )}
                          {hasOptions ? 'Montar' : 'Adicionar'}
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

      {customizingProduct && (
        <div
          className="fixed inset-0 z-[140] flex items-end justify-center bg-slate-950/85 p-0 backdrop-blur-md sm:items-center sm:p-4"
          role="presentation"
          onClick={() => setCustomizingProduct(null)}
        >
          <section
            className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-slate-800 bg-slate-900 shadow-2xl sm:rounded-3xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby={`${idPrefix}-customization-title`}
            onClick={event => event.stopPropagation()}
            id={`${idPrefix}-product-customization-modal`}
          >
            <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-slate-800 bg-slate-900/95 p-4 backdrop-blur-sm sm:p-5">
              <div className="min-w-0">
                <span className="font-mono text-[9px] font-black uppercase tracking-[0.18em] text-orange-400">
                  Personalizar item
                </span>
                <h3
                  id={`${idPrefix}-customization-title`}
                  className="mt-1 truncate text-lg font-black text-white"
                >
                  {customizingProduct.name}
                </h3>
                <p className="mt-1 text-[10px] text-slate-500">
                  Escolha as etapas e opções antes de adicionar ao pedido.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCustomizingProduct(null)}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-800 bg-slate-950 text-slate-500 hover:text-white"
                aria-label="Fechar personalização"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="space-y-4 p-4 sm:p-5">
              {customizationGroups.map(group => {
                const selected = selectedChoiceIds[group.id] ?? [];
                const selectionRule =
                  group.minSelections === group.maxSelections
                    ? `Escolha ${group.minSelections}`
                    : `Escolha de ${group.minSelections} a ${group.maxSelections}`;

                return (
                  <fieldset
                    key={group.id}
                    className="rounded-3xl border border-slate-800 bg-slate-950/65 p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <legend className="text-sm font-black text-white">
                        {group.name}
                      </legend>
                      <span className="rounded-full bg-slate-900 px-2.5 py-1 text-[8px] font-bold uppercase text-slate-500">
                        {selectionRule}
                      </span>
                    </div>

                    <div className="mt-3 space-y-2">
                      {group.choices.map(choice => {
                        const isSelected = selected.includes(choice.id);
                        return (
                          <button
                            key={choice.id}
                            type="button"
                            onClick={() =>
                              toggleChoice(
                                group.id,
                                choice.id,
                                group.maxSelections
                              )
                            }
                            className={`flex min-h-12 w-full items-center justify-between gap-3 rounded-2xl border px-3 py-2 text-left transition-colors ${
                              isSelected
                                ? 'border-orange-500/50 bg-orange-500/10'
                                : 'border-slate-800 bg-slate-900/70 hover:border-slate-700'
                            }`}
                          >
                            <span className="flex min-w-0 items-center gap-3">
                              <span
                                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border ${
                                  isSelected
                                    ? 'border-orange-500 bg-orange-500 text-slate-950'
                                    : 'border-slate-700 bg-slate-950 text-transparent'
                                }`}
                              >
                                <Check className="h-3.5 w-3.5" />
                              </span>
                              <strong className="truncate text-xs text-slate-200">
                                {choice.name}
                              </strong>
                            </span>
                            <span className="shrink-0 font-mono text-[10px] text-slate-400">
                              {choice.priceDelta > 0
                                ? `+ ${currencyFormatter.format(choice.priceDelta)}`
                                : 'Incluso'}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </fieldset>
                );
              })}

              {customizationError && (
                <p className="rounded-2xl border border-red-500/25 bg-red-500/10 px-3 py-2.5 text-xs text-red-300">
                  {customizationError}
                </p>
              )}
            </div>

            <footer className="sticky bottom-0 flex items-center justify-between gap-3 border-t border-slate-800 bg-slate-900/95 p-4 backdrop-blur-sm sm:p-5">
              <div>
                <span className="block font-mono text-[8px] uppercase text-slate-600">
                  Valor configurado
                </span>
                <strong className="font-mono text-lg text-white">
                  {currencyFormatter.format(
                    customizationPreview?.unitPrice ??
                      (customizingProduct.isComplimentary
                        ? 0
                        : customizingProduct.price)
                  )}
                </strong>
              </div>
              <button
                type="button"
                onClick={confirmCustomization}
                className="flex min-h-11 items-center gap-2 rounded-xl px-5 text-[10px] font-black uppercase text-white"
                style={{ backgroundColor: accentColor }}
                id={`${idPrefix}-confirm-customization`}
              >
                <Plus className="h-4 w-4" />
                Adicionar configurado
              </button>
            </footer>
          </section>
        </div>
      )}
    </>
  );
};
