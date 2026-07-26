import { useEffect, useMemo, useState } from 'react';
import {
  ImageOff,
  Package,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import type { Product } from '../../types';

interface ProductInventoryWorkspaceProps {
  products: Product[];
  keywords: string[];
  onCreateProduct: () => void;
  onEditProduct: (product: Product) => void;
  onDeleteProduct: (product: Product) => void;
  busyProductId?: string;
}

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

export function ProductInventoryWorkspace({
  products,
  keywords,
  onCreateProduct,
  onEditProduct,
  onDeleteProduct,
  busyProductId = '',
}: ProductInventoryWorkspaceProps) {
  const categoryOptions = useMemo(() => uniqueKeywords(keywords), [keywords]);
  const [selectedKeyword, setSelectedKeyword] = useState('');

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

  const visibleProducts = useMemo(() => {
    if (!selectedKeyword) return products;

    return products.filter(
      product =>
        normalizeCategoryValue(categoryRoot(product.category)) === selectedKeyword
    );
  }, [products, selectedKeyword]);

  return (
    <section
      className="space-y-4 rounded-3xl border border-slate-800 bg-slate-900 p-4 sm:p-5"
      id="erp-product-inventory-workspace"
    >
      <header className="flex items-center justify-between gap-3 border-b border-slate-800 pb-3">
        <div className="min-w-0">
          <h4 className="text-xs font-black uppercase tracking-wide text-white">
            Itens ativos no estoque
          </h4>
          <p className="mt-1 text-[10px] text-slate-500">
            {visibleProducts.length} de {products.length} item(ns) exibido(s)
          </p>
        </div>
        <button
          type="button"
          onClick={onCreateProduct}
          className="inline-flex min-h-10 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-orange-500 px-3 text-[9px] font-black uppercase text-slate-950 transition-colors hover:bg-orange-400"
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

      {visibleProducts.length > 0 ? (
        <div
          className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4 2xl:grid-cols-5"
          id="erp-product-inventory-grid"
        >
          {visibleProducts.map(product => {
            const isBusy = busyProductId === product.id;

            return (
              <article
                key={product.id}
                className="min-w-0 overflow-hidden rounded-2xl border border-slate-800 bg-slate-950"
                id={`erp-product-${product.id}`}
              >
                <div className="relative aspect-square overflow-hidden bg-slate-900">
                  {product.image ? (
                    <img
                      src={product.image}
                      alt={product.name}
                      className="h-full w-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-slate-700">
                      <ImageOff className="h-7 w-7" />
                    </div>
                  )}
                </div>

                <div className="space-y-2 p-3">
                  <div className="min-w-0">
                    <h5 className="line-clamp-2 text-xs font-black leading-tight text-white">
                      {product.name}
                    </h5>
                    <p className="mt-1 line-clamp-2 text-[9px] leading-relaxed text-slate-500">
                      {product.category}
                    </p>
                  </div>

                  <div className="flex items-end justify-between gap-2 border-t border-slate-800 pt-2">
                    <div className="min-w-0 space-y-1">
                      <strong className="block truncate text-[11px] text-emerald-400">
                        {currencyFormatter.format(product.price)}
                      </strong>
                      <span className="flex items-center gap-1 text-[9px] font-mono text-slate-500">
                        <Package className="h-3 w-3" />
                        {product.isService ? 'Serviço' : `${product.stock} un.`}
                      </span>
                    </div>

                    <div className="flex shrink-0 items-center gap-1" aria-label={`Ações de ${product.name}`}>
                      <button
                        type="button"
                        onClick={() => onEditProduct(product)}
                        disabled={isBusy}
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-700 bg-slate-900 text-slate-400 hover:border-orange-500/40 hover:text-orange-300 disabled:opacity-35"
                        aria-label={`Editar ${product.name}`}
                        title="Editar item"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteProduct(product)}
                        disabled={isBusy}
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-red-500/20 bg-red-500/10 text-red-300 hover:bg-red-500/20 disabled:opacity-35"
                        aria-label={`Excluir ${product.name}`}
                        title="Excluir item"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
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
            {products.length === 0
              ? 'Nenhum produto ou serviço cadastrado.'
              : 'Nenhum item encontrado nesta categoria.'}
          </p>
        </div>
      )}
    </section>
  );
}
