import { useEffect, useMemo, useState } from 'react';
import type React from 'react';
import type { Product } from '../../types';
import { RetailerPanel as LegacyRetailerPanel } from '../LegacyRetailerPanel';
import { auth } from '../../utils/firebase';
import {
  persistPublicProduct,
  PUBLIC_PRODUCT_CREATE_EVENT,
  type PublicProduct,
  type PublicProductCreateRequest,
} from '../../utils/publicProducts';
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
    </>
  );
}
