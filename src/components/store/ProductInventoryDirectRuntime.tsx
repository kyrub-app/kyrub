import { useEffect, useMemo, useState } from 'react';
import type React from 'react';
import { AlertTriangle, Trash2, X } from 'lucide-react';
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
      >
        <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/[0.06] px-4 py-3 text-[10px] leading-relaxed text-cyan-100">
          As alterações feitas aqui atualizam o catálogo do Kyrub. Publicações em canais externos continuam exigindo preparação e autorização explícitas; este módulo não envia alterações automaticamente ao Mercado Livre.
        </div>

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
              O item deixará de aparecer no estoque e na vitrine. Pedidos antigos continuarão preservando o nome, o preço e as quantidades registrados no momento da venda.
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
