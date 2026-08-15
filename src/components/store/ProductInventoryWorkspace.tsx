import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ImageOff,
  Package,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import type { Product } from '../../types';
import type { KyrubCatalogDraftListItem } from '../../../shared/kyrubCatalogDrafts';
import { auth } from '../../utils/firebase';
import { requestProductCreateModal } from '../../utils/productModalEvents';
import {
  KYRUB_CATALOG_PRODUCT_CHANGED_EVENT,
  listKyrubCatalogDrafts,
  setKyrubCatalogProductPublished,
} from '../../actions/kyrubCatalogDraftService';

interface ProductInventoryWorkspaceProps {
  products: Product[];
  keywords: string[];
  onCreateProduct: () => void;
  onEditProduct: (product: Product) => void;
  onDeleteProduct: (product: Product) => void;
  busyProductId?: string;
}

type InventoryItem = {
  id: string;
  name: string;
  description: string;
  price: number;
  image: string;
  stock: number;
  category: string;
  isService: boolean;
  published: boolean;
  product?: Product;
};

const currencyFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

const normalizeCategoryValue = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLocaleLowerCase('pt-BR');

const categoryRoot = (category: string): string =>
  category
    .split(/\s*(?:>|\/)\s*/)
    .map(segment => segment.trim())
    .find(Boolean) ?? '';

const uniqueKeywords = (keywords: string[]): string[] => {
  const seen = new Set<string>();

  return keywords.flatMap(keyword => {
    const trimmed = keyword.trim();
    const normalized = normalizeCategoryValue(trimmed);
    if (!trimmed || seen.has(normalized)) return [];
    seen.add(normalized);
    return [trimmed];
  });
};

const draftToInventoryItem = (
  draft: KyrubCatalogDraftListItem
): InventoryItem => ({
  id: draft.id,
  name: draft.product.name,
  description: draft.product.description ?? '',
  price: draft.product.price ?? 0,
  image: draft.product.image ?? '',
  stock: draft.product.stock ?? 0,
  category: draft.product.category ?? '',
  isService: draft.product.isService === true,
  published: false,
});

const productToInventoryItem = (product: Product): InventoryItem => ({
  id: product.id,
  name: product.name,
  description: product.description,
  price: product.price,
  image: product.image,
  stock: product.stock,
  category: product.category,
  isService: product.isService === true,
  published: true,
  product,
});

export function ProductInventoryWorkspace({
  products,
  keywords,
  onEditProduct,
  onDeleteProduct,
  busyProductId = '',
}: ProductInventoryWorkspaceProps) {
  const categoryOptions = useMemo(() => uniqueKeywords(keywords), [keywords]);
  const [selectedKeyword, setSelectedKeyword] = useState('');
  const [unpublishedProducts, setUnpublishedProducts] = useState<
    KyrubCatalogDraftListItem[]
  >([]);
  const [publicationBusyId, setPublicationBusyId] = useState('');
  const [publicationError, setPublicationError] = useState('');

  const loadUnpublishedProducts = useCallback(async (): Promise<void> => {
    const user = auth.currentUser;
    if (!user) {
      setUnpublishedProducts([]);
      return;
    }

    try {
      const result = await listKyrubCatalogDrafts(user);
      setUnpublishedProducts(result.drafts);
      setPublicationError('');
    } catch (error) {
      console.warn('Produtos não publicados indisponíveis.', error);
      setPublicationError(
        error instanceof Error
          ? error.message
          : 'Não foi possível carregar os produtos não publicados.'
      );
    }
  }, []);

  useEffect(() => {
    void loadUnpublishedProducts();

    const refresh = (): void => {
      void loadUnpublishedProducts();
    };
    window.addEventListener(KYRUB_CATALOG_PRODUCT_CHANGED_EVENT, refresh);
    window.addEventListener('focus', refresh);
    return () => {
      window.removeEventListener(KYRUB_CATALOG_PRODUCT_CHANGED_EVENT, refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [loadUnpublishedProducts]);

  useEffect(() => {
    if (
      selectedKeyword &&
      !categoryOptions.some(
        option => normalizeCategoryValue(option) === selectedKeyword
      )
    ) {
      setSelectedKeyword('');
    }
  }, [categoryOptions, selectedKeyword]);

  const inventoryItems = useMemo(() => {
    const drafts = unpublishedProducts.map(draftToInventoryItem);
    const draftIds = new Set(drafts.map(item => item.id));
    return [
      ...drafts,
      ...products
        .filter(product => !draftIds.has(product.id))
        .map(productToInventoryItem),
    ];
  }, [products, unpublishedProducts]);

  const visibleProducts = useMemo(() => {
    if (!selectedKeyword) return inventoryItems;

    return inventoryItems.filter(
      product =>
        normalizeCategoryValue(categoryRoot(product.category)) === selectedKeyword
    );
  }, [inventoryItems, selectedKeyword]);

  const handlePublicationChange = async (
    item: InventoryItem,
    published: boolean
  ): Promise<void> => {
    const user = auth.currentUser;
    if (!user) {
      setPublicationError('Faça login novamente para alterar a publicação.');
      return;
    }

    setPublicationBusyId(item.id);
    setPublicationError('');
    try {
      await setKyrubCatalogProductPublished(user, item.id, published);
      await loadUnpublishedProducts();
    } catch (error) {
      console.error('Falha ao alterar publicação do produto:', error);
      setPublicationError(
        error instanceof Error
          ? error.message
          : 'Não foi possível alterar a publicação do produto.'
      );
    } finally {
      setPublicationBusyId('');
    }
  };

  return (
    <section
      className="space-y-4 rounded-3xl border border-slate-800 bg-slate-900 p-4 sm:p-5"
      id="erp-product-inventory-workspace"
    >
      <header className="flex items-center justify-between gap-3 border-b border-slate-800 pb-3">
        <div className="min-w-0">
          <h4 className="text-xs font-black uppercase tracking-wide text-white">
            Produtos e serviços
          </h4>
          <p className="mt-1 text-[10px] text-slate-500">
            {visibleProducts.length} de {inventoryItems.length} item(ns) exibido(s)
          </p>
        </div>
        <button
          type="button"
          onClick={() => requestProductCreateModal(products, keywords)}
          className="inline-flex min-h-10 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-orange-500 px-3 text-[9px] font-black uppercase text-slate-950 transition-colors hover:bg-orange-400"
          id="open-unified-product-create-modal"
        >
          <Plus className="h-4 w-4" />
          Novo item
        </button>
      </header>

      <div
        className="flex max-w-full items-center gap-2 overflow-x-auto pb-1"
        id="erp-product-keyword-filters"
        aria-label="Filtrar itens pelas palavras-chave da loja"
      >
        <button
          type="button"
          onClick={() => setSelectedKeyword('')}
          className={`min-h-9 shrink-0 rounded-xl border px-3 text-[9px] font-black uppercase tracking-wide transition-colors ${
            selectedKeyword === ''
              ? 'border-orange-500/50 bg-orange-500/15 text-orange-300'
              : 'border-slate-800 bg-slate-950 text-slate-500 hover:text-slate-300'
          }`}
        >
          Todos
        </button>
        {categoryOptions.map(keyword => {
          const normalizedKeyword = normalizeCategoryValue(keyword);
          const active = selectedKeyword === normalizedKeyword;

          return (
            <button
              key={normalizedKeyword}
              type="button"
              onClick={() => setSelectedKeyword(normalizedKeyword)}
              className={`min-h-9 shrink-0 rounded-xl border px-3 text-[9px] font-black uppercase tracking-wide transition-colors ${
                active
                  ? 'border-orange-500/50 bg-orange-500/15 text-orange-300'
                  : 'border-slate-800 bg-slate-950 text-slate-500 hover:text-slate-300'
              }`}
            >
              {keyword}
            </button>
          );
        })}
      </div>

      {categoryOptions.length === 0 && (
        <p className="rounded-2xl border border-dashed border-slate-800 bg-slate-950/55 px-3 py-2.5 text-[10px] leading-relaxed text-slate-500">
          Cadastre palavras-chave em Configurações da loja → Perfil para criar os filtros do catálogo.
        </p>
      )}

      {publicationError && (
        <p
          className="rounded-2xl border border-red-500/25 bg-red-500/10 px-3 py-2.5 text-[10px] leading-relaxed text-red-200"
          role="alert"
        >
          {publicationError}
        </p>
      )}

      {visibleProducts.length > 0 ? (
        <div
          className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4 2xl:grid-cols-5"
          id="erp-product-inventory-grid"
        >
          {visibleProducts.map(item => {
            const isBusy =
              busyProductId === item.id || publicationBusyId === item.id;

            return (
              <article
                key={item.id}
                className="min-w-0 overflow-hidden rounded-2xl border border-slate-800 bg-slate-950"
                id={`erp-product-${item.id}`}
              >
                <div className="relative aspect-square overflow-hidden bg-slate-900">
                  {item.image ? (
                    <img
                      src={item.image}
                      alt={item.name}
                      className="h-full w-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-slate-700">
                      <ImageOff className="h-7 w-7" />
                    </div>
                  )}

                  {!item.published && (
                    <span className="absolute left-2 top-2 rounded-lg border border-amber-400/25 bg-slate-950/90 px-2 py-1 text-[8px] font-black uppercase tracking-wide text-amber-300">
                      Não publicado
                    </span>
                  )}
                </div>

                <div className="space-y-2 p-3">
                  <div className="min-w-0">
                    <h5 className="line-clamp-2 text-xs font-black leading-tight text-white">
                      {item.name}
                    </h5>
                    <p className="mt-1 line-clamp-2 text-[9px] leading-relaxed text-slate-500">
                      {item.category || 'Categoria não informada'}
                    </p>
                  </div>

                  <label className="flex min-h-9 cursor-pointer items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-900 px-2.5">
                    <span className="text-[9px] font-black uppercase tracking-wide text-slate-400">
                      Publicado
                    </span>
                    <input
                      type="checkbox"
                      checked={item.published}
                      disabled={isBusy}
                      onChange={event =>
                        void handlePublicationChange(item, event.target.checked)
                      }
                      className="h-4 w-4 accent-orange-500 disabled:opacity-40"
                      aria-label={`${item.published ? 'Despublicar' : 'Publicar'} ${item.name}`}
                    />
                  </label>

                  <div className="flex items-end justify-between gap-2 border-t border-slate-800 pt-2">
                    <div className="min-w-0 space-y-1">
                      <strong className="block truncate text-[11px] text-emerald-400">
                        {currencyFormatter.format(item.price)}
                      </strong>
                      <span className="flex items-center gap-1 text-[9px] font-mono text-slate-500">
                        <Package className="h-3 w-3" />
                        {item.isService ? 'Serviço' : `${item.stock} un.`}
                      </span>
                    </div>

                    {item.product && (
                      <div className="flex shrink-0 items-center gap-1" aria-label={`Ações de ${item.name}`}>
                        <button
                          type="button"
                          onClick={() => onEditProduct(item.product as Product)}
                          disabled={isBusy}
                          className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-700 bg-slate-900 text-slate-400 hover:border-orange-500/40 hover:text-orange-300 disabled:opacity-35"
                          aria-label={`Editar ${item.name}`}
                          title="Editar item"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteProduct(item.product as Product)}
                          disabled={isBusy}
                          className="flex h-8 w-8 items-center justify-center rounded-lg border border-red-500/20 bg-red-500/10 text-red-300 hover:bg-red-500/20 disabled:opacity-35"
                          aria-label={`Excluir ${item.name}`}
                          title="Excluir item"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="rounded-3xl border border-dashed border-slate-800 bg-slate-950/45 px-4 py-12 text-center">
          <Package className="mx-auto h-8 w-8 text-slate-700" />
          <p className="mt-3 text-xs text-slate-500">
            {inventoryItems.length === 0
              ? 'Nenhum produto ou serviço cadastrado.'
              : 'Nenhum item encontrado nesta categoria.'}
          </p>
        </div>
      )}
    </section>
  );
}
