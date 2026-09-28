import { useEffect, useMemo, useState } from 'react';
import type React from 'react';
import {
  AlertTriangle,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import type { Product } from '../../types';
import { RetailerPanel as LegacyRetailerPanel } from '../LegacyRetailerPanel';
import { auth } from '../../utils/firebase';
import {
  persistPublicProduct,
  PUBLIC_PRODUCT_CREATE_EVENT,
  type PublicProduct,
  type PublicProductCreateRequest,
} from '../../utils/publicProducts';
import { removePublicProduct } from '../../utils/publicProductMutations';
import { OperationalDualWriteBridge } from './OperationalDualWriteBridge';
import { ProductEditorModal } from './ProductEditorModal';
import { ProductInventoryWorkspace } from './ProductInventoryWorkspace';

type RetailerPanelProps = React.ComponentProps<typeof LegacyRetailerPanel>;

type ProductInventoryDirectRuntimeProps = Pick<
  RetailerPanelProps,
  | 'activeRetailerId'
  | 'activeStore'
  | 'products'
  | 'setProducts'
  | 'triggerToast'
>;

const normalizeSearchValue = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLocaleLowerCase('pt-BR');

export function ProductInventoryDirectRuntime({
  activeRetailerId,
  activeStore,
  products,
  setProducts,
  triggerToast,
}: ProductInventoryDirectRuntimeProps) {
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [deletingProduct, setDeletingProduct] = useState<Product | null>(null);
  const [busyProductId, setBusyProductId] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  const activeRetailerProducts = useMemo(
    () =>
      products.filter(
        item =>
          item.supplierId === activeRetailerId &&
          item.wholesalePrice === undefined
      ),
    [activeRetailerId, products]
  );

  useEffect(() => {
    const handlePublicProductCreate = (event: Event): void => {
      const request = (event as CustomEvent<PublicProductCreateRequest>).detail;
      const product = request?.product;

      if (!request || !product || product.storeId !== activeRetailerId) return;

      const user = auth.currentUser;
      if (!user || user.uid !== activeRetailerId) {
        request.reason = 'Faça login novamente para cadastrar o item.';
        return;
      }

      const currentStoreProducts = products.filter(
        item =>
          item.supplierId === activeRetailerId &&
          item.wholesalePrice === undefined
      );

      if (activeStore.plan === 'free' && currentStoreProducts.length >= 5) {
        request.reason =
          'O plano gratuito permite até 5 produtos ou serviços por loja.';
        return;
      }

      request.accepted = true;
      setProducts(previous => [
        product,
        ...previous.filter(item => item.id !== product.id),
      ]);

      void persistPublicProduct(user, product)
        .then(() => {
          triggerToast(
            `“${product.name}” foi cadastrado e publicado na vitrine.`,
            'success'
          );
        })
        .catch(error => {
          console.error('Falha ao publicar o produto da loja:', error);
          triggerToast(
            `“${product.name}” ficou salvo neste dispositivo, mas ainda não foi publicado.`,
            'error'
          );
        });
    };

    window.addEventListener(PUBLIC_PRODUCT_CREATE_EVENT, handlePublicProductCreate);
    return () => {
      window.removeEventListener(
        PUBLIC_PRODUCT_CREATE_EVENT,
        handlePublicProductCreate
      );
    };
  }, [
    activeRetailerId,
    activeStore.plan,
    products,
    setProducts,
    triggerToast,
  ]);

  useEffect(() => {
    let frame = 0;
    let observer: MutationObserver | null = null;

    const applySearch = (): void => {
      frame = 0;
      const workspace = document.getElementById('erp-product-inventory-workspace');
      if (!(workspace instanceof HTMLElement)) return;

      const query = normalizeSearchValue(searchQuery);
      const grid = document.getElementById('erp-product-inventory-grid');
      const cards = grid
        ? Array.from(grid.querySelectorAll<HTMLElement>(':scope > article'))
        : [];

      let matchedCount = 0;
      cards.forEach(card => {
        const label = card.getAttribute('aria-label') ?? '';
        const name = label.replace(/^Editar\s+/i, '');
        const matches = !query || normalizeSearchValue(name).includes(query);
        card.style.display = matches ? '' : 'none';
        if (matches) matchedCount += 1;
      });

      const counter = workspace.querySelector<HTMLParagraphElement>('header p');
      if (counter && cards.length > 0) {
        const totalMatch = counter.textContent?.match(/de\s+(\d+)/i);
        const total = totalMatch?.[1] ?? String(cards.length);
        const nextText = `${query ? matchedCount : cards.length} de ${total} item(ns) exibido(s)`;
        if (counter.textContent !== nextText) counter.textContent = nextText;
      }

      const existingEmpty = document.getElementById('erp-product-search-empty');
      if (query && grid && cards.length > 0 && matchedCount === 0) {
        const empty = existingEmpty ?? document.createElement('div');
        empty.id = 'erp-product-search-empty';
        empty.className =
          'rounded-3xl border border-dashed border-slate-800 bg-slate-950/45 px-4 py-8 text-center text-xs text-slate-500';
        empty.textContent = `Nenhum produto encontrado para “${searchQuery.trim()}”.`;
        if (!existingEmpty) grid.insertAdjacentElement('afterend', empty);
      } else {
        existingEmpty?.remove();
      }
    };

    const schedule = (): void => {
      if (frame) return;
      frame = window.requestAnimationFrame(applySearch);
    };

    schedule();
    observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer?.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
      document.getElementById('erp-product-search-empty')?.remove();
      document
        .querySelectorAll<HTMLElement>('#erp-product-inventory-grid > article')
        .forEach(card => card.style.removeProperty('display'));
    };
  }, [searchQuery]);

  const handleSaveProduct = async (product: Product): Promise<void> => {
    const user = auth.currentUser;
    if (!user || user.uid !== activeRetailerId) {
      throw new Error('Faça login novamente para atualizar o item.');
    }

    const previousProduct = products.find(item => item.id === product.id);
    if (!previousProduct || previousProduct.supplierId !== activeRetailerId) {
      throw new Error('O item selecionado não pertence à loja autenticada.');
    }

    const updatedProduct: PublicProduct = {
      ...product,
      id: previousProduct.id,
      storeId: user.uid,
      supplierId: user.uid,
      updatedAt: new Date().toISOString(),
    };

    setBusyProductId(product.id);
    setProducts(previous =>
      previous.map(item => item.id === product.id ? updatedProduct : item)
    );

    try {
      await persistPublicProduct(user, updatedProduct);
      setEditingProduct(null);
      triggerToast(
        `“${updatedProduct.name}” foi atualizado no catálogo do Kyrub.`,
        'success'
      );
    } catch (error) {
      setProducts(previous =>
        previous.map(item => item.id === product.id ? previousProduct : item)
      );
      console.error('Falha ao atualizar produto no módulo direto:', error);
      throw new Error('Não foi possível salvar as alterações do item.');
    } finally {
      setBusyProductId('');
    }
  };

  const handleConfirmDeleteProduct = async (): Promise<void> => {
    const product = deletingProduct;
    const user = auth.currentUser;
    if (!product) return;
    if (!user || user.uid !== activeRetailerId) {
      triggerToast('Faça login novamente para excluir o item.', 'error');
      return;
    }

    setBusyProductId(product.id);
    setProducts(previous => previous.filter(item => item.id !== product.id));

    try {
      await removePublicProduct(user, product.id);
      setDeletingProduct(null);
      triggerToast(`“${product.name}” foi excluído do catálogo.`, 'success');
    } catch (error) {
      setProducts(previous =>
        previous.some(item => item.id === product.id)
          ? previous
          : [product, ...previous]
      );
      console.error('Falha ao excluir produto no módulo direto:', error);
      triggerToast('Não foi possível excluir o item.', 'error');
    } finally {
      setBusyProductId('');
    }
  };

  return (
    <>
      <OperationalDualWriteBridge
        legacyStoreId={activeRetailerId}
        notify={triggerToast}
      />

      <div
        id="kyrub-products-stock-direct-runtime"
        data-kyrub-products-stock-native="true"
        className="space-y-4"
        aria-description="Este módulo não envia alterações automaticamente ao Mercado Livre."
      >
        <label
          className="flex min-h-12 items-center gap-3 rounded-2xl border border-slate-800 bg-slate-950/70 px-4 transition-colors focus-within:border-orange-500/45 focus-within:bg-slate-950"
          id="kyrub-product-live-search"
        >
          <Search className="h-4 w-4 shrink-0 text-slate-500" />
          <input
            type="search"
            value={searchQuery}
            onChange={event => setSearchQuery(event.target.value)}
            placeholder="Buscar produto pelo nome…"
            autoComplete="off"
            className="min-w-0 flex-1 bg-transparent py-3 text-xs text-white outline-none placeholder:text-slate-600"
            aria-label="Buscar produto pelo nome"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-900 hover:text-white"
              aria-label="Limpar busca de produto"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </label>

        <ProductInventoryWorkspace
          products={activeRetailerProducts}
          keywords={activeStore.keywords ?? []}
          onCreateProduct={() => undefined}
          onEditProduct={setEditingProduct}
          onDeleteProduct={setDeletingProduct}
          busyProductId={busyProductId}
        />
      </div>

      <ProductEditorModal
        product={editingProduct}
        products={activeRetailerProducts}
        keywords={activeStore.keywords ?? []}
        isSaving={Boolean(busyProductId)}
        onClose={() => !busyProductId && setEditingProduct(null)}
        onSave={handleSaveProduct}
      />

      {deletingProduct && (
        <div className="fixed inset-0 z-[136] flex items-end justify-center bg-slate-950/90 backdrop-blur-md sm:items-center sm:p-5">
          <section className="w-full max-w-md rounded-t-3xl border border-red-500/25 bg-slate-900 p-5 shadow-2xl sm:rounded-3xl sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-red-500/10 text-red-300">
                  <AlertTriangle className="h-5 w-5" />
                </span>
                <div>
                  <span className="font-mono text-[9px] font-black uppercase tracking-[0.16em] text-red-300">
                    Excluir item
                  </span>
                  <h3 className="mt-1 text-lg font-black text-white">
                    Remover “{deletingProduct.name}”?
                  </h3>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDeletingProduct(null)}
                disabled={Boolean(busyProductId)}
                className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-800 bg-slate-950 text-slate-500 disabled:opacity-40"
                aria-label="Fechar confirmação"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/[0.07] p-4 text-[10px] leading-relaxed text-red-100">
              O item deixará de aparecer na lista de produtos e na vitrine. Pedidos antigos continuarão preservando o nome, o preço e as quantidades registrados no momento da venda.
            </p>

            <div className="mt-5 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setDeletingProduct(null)}
                disabled={Boolean(busyProductId)}
                className="min-h-11 rounded-xl border border-slate-700 bg-slate-950 px-4 text-[10px] font-black uppercase text-slate-300 disabled:opacity-40"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmDeleteProduct()}
                disabled={Boolean(busyProductId)}
                className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-red-500 px-4 text-[10px] font-black uppercase text-white disabled:opacity-40"
                id="confirm-delete-product-direct-button"
              >
                <Trash2 className="h-4 w-4" />
                {busyProductId ? 'Excluindo...' : 'Excluir item'}
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
