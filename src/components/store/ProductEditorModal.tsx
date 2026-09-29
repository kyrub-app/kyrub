import { useEffect, useState } from 'react';
import type React from 'react';
import { X } from 'lucide-react';
import type { Product } from '../../types';
import { normalizeStorePointsPerUnit } from '../../../shared/storePoints';
import { auth } from '../../utils/firebase';
import {
  createEmptyProductFiscalProfile,
  normalizeProductFiscalProfile,
  persistProductFiscalProfile,
  type ProductFiscalEditorState,
} from '../../utils/productFiscal';
import { ProductFiscalFieldsBridge } from './ProductFiscalFieldsBridge';
import { ProductModalArchitectureBridge } from './ProductModalArchitectureBridge';
import {
  ProductModalWorkspaceTabs,
  ProductModalWorkspaceTabsBridge,
  type ProductModalWorkspace,
} from './ProductModalWorkspaceTabs';
import { ProductPricingFieldsBridge } from './ProductPricingFieldsBridge';
import { ProductShowcaseAccordionBridge } from './ProductShowcaseAccordionBridge';
import { ProductStorePointsFieldBridge } from './ProductStorePointsFieldBridge';
import { StoreInventoryCatalogWorkspace } from './StoreInventoryCatalogWorkspace';
import { StorePurchaseWorkspace } from './StorePurchaseWorkspace';
import {
  UnifiedProductModal,
  type ProductModalMode,
  type UnifiedProductModalProps,
} from './UnifiedProductModal';

interface ProductEditorModalProps
  extends Omit<UnifiedProductModalProps, 'isOpen' | 'mode' | 'product'> {
  isOpen?: boolean;
  mode?: ProductModalMode;
  product: Product | null;
}

export const ProductEditorModal: React.FC<ProductEditorModalProps> = ({
  isOpen,
  mode = 'edit',
  product,
  onSave,
  onClose,
  isSaving,
  ...props
}) => {
  const resolvedOpen = isOpen ?? Boolean(product);
  const [activeWorkspace, setActiveWorkspace] =
    useState<ProductModalWorkspace>('product');
  const [storePointsPerUnit, setStorePointsPerUnit] = useState(
    normalizeStorePointsPerUnit(product?.storePointsPerUnit)
  );
  const [fiscalState, setFiscalState] = useState<ProductFiscalEditorState>({
    ready: false,
    draft: createEmptyProductFiscalProfile(
      product?.isService === true ? 'service' : 'goods'
    ),
    initialProfile: null,
  });

  useEffect(() => {
    if (!resolvedOpen) return;
    setActiveWorkspace('product');
  }, [resolvedOpen, product?.id]);

  useEffect(() => {
    if (!resolvedOpen) return;

    let frame = 0;
    const synchronize = (): void => {
      frame = 0;
      const modal = document.getElementById('unified-product-modal');
      if (!(modal instanceof HTMLElement)) return;
      if (activeWorkspace === 'product') {
        modal.style.removeProperty('display');
      } else {
        modal.style.display = 'none';
      }
    };

    const schedule = (): void => {
      if (frame) return;
      frame = window.requestAnimationFrame(synchronize);
    };

    schedule();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
      const modal = document.getElementById('unified-product-modal');
      if (modal instanceof HTMLElement) modal.style.removeProperty('display');
    };
  }, [activeWorkspace, resolvedOpen]);

  useEffect(() => {
    if (!resolvedOpen) return;
    setStorePointsPerUnit(
      normalizeStorePointsPerUnit(product?.storePointsPerUnit)
    );
  }, [resolvedOpen, product?.id, product?.storePointsPerUnit]);

  const handleClose = (): void => {
    setActiveWorkspace('product');
    onClose();
  };

  const handleSave = async (nextProduct: Product): Promise<void> => {
    if (!fiscalState.ready) {
      throw new Error(
        'Aguarde os dados fiscais terminarem de carregar antes de salvar.'
      );
    }

    const user = auth.currentUser;
    if (!user) {
      throw new Error('Faça login novamente para salvar os dados fiscais.');
    }

    const productWithStorePoints: Product = {
      ...nextProduct,
      storePointsPerUnit: normalizeStorePointsPerUnit(storePointsPerUnit),
    };
    const kind = productWithStorePoints.isService === true ? 'service' : 'goods';
    const nextFiscalProfile = normalizeProductFiscalProfile(
      fiscalState.draft,
      kind
    );
    const previousFiscalProfile = fiscalState.initialProfile;
    const shouldPersistFiscalProfile = Boolean(
      nextFiscalProfile || previousFiscalProfile
    );

    if (shouldPersistFiscalProfile) {
      await persistProductFiscalProfile(
        user,
        productWithStorePoints.id,
        nextFiscalProfile
      );
    }

    try {
      await onSave(productWithStorePoints);
    } catch (error) {
      if (shouldPersistFiscalProfile) {
        void persistProductFiscalProfile(
          user,
          productWithStorePoints.id,
          previousFiscalProfile
        ).catch(rollbackError => {
          console.error(
            'Não foi possível reverter os dados fiscais após a falha do item.',
            rollbackError
          );
        });
      }
      throw error;
    }
  };

  const storeId = product?.supplierId ?? auth.currentUser?.uid ?? '';
  const operationalWorkspaceOpen =
    resolvedOpen && activeWorkspace !== 'product';

  return (
    <>
      <UnifiedProductModal
        {...props}
        isOpen={resolvedOpen}
        mode={mode}
        product={product}
        isSaving={isSaving}
        onClose={handleClose}
        onSave={handleSave}
      />
      <ProductModalArchitectureBridge isOpen={resolvedOpen} />
      <ProductModalWorkspaceTabsBridge
        isOpen={resolvedOpen && activeWorkspace === 'product'}
        active={activeWorkspace}
        onChange={setActiveWorkspace}
        disabled={isSaving}
      />
      <ProductShowcaseAccordionBridge isOpen={resolvedOpen} />
      <ProductFiscalFieldsBridge
        isOpen={resolvedOpen}
        product={product}
        isSaving={isSaving}
        onStateChange={setFiscalState}
      />
      <ProductPricingFieldsBridge
        isOpen={resolvedOpen}
        product={product}
        isSaving={isSaving}
      />
      <ProductStorePointsFieldBridge
        isOpen={resolvedOpen}
        value={storePointsPerUnit}
        disabled={isSaving}
        onChange={setStorePointsPerUnit}
      />

      {operationalWorkspaceOpen && (
        <div className="fixed inset-0 z-[136] flex items-end justify-center bg-slate-950/90 backdrop-blur-md sm:items-center sm:p-5">
          <section className="max-h-[94vh] w-full max-w-4xl overflow-y-auto rounded-t-3xl border border-slate-800 bg-slate-900 p-5 shadow-2xl sm:rounded-3xl sm:p-6">
            <header className="flex items-start justify-between gap-4">
              <div>
                <span className="font-mono text-[9px] font-black uppercase tracking-[0.16em] text-orange-400">
                  Operação da loja
                </span>
                <h3 className="mt-1 text-xl font-black text-white">
                  {activeWorkspace === 'stock'
                    ? 'Estoque da loja'
                    : 'Compras da loja'}
                </h3>
                <p className="mt-1 text-[10px] text-slate-500">
                  {activeWorkspace === 'stock'
                    ? 'Cadastre e acompanhe os itens físicos usados pelos seus produtos.'
                    : 'Veja o que precisa ser reposto a partir do estoque mínimo.'}
                </p>
              </div>
              <button
                type="button"
                onClick={handleClose}
                disabled={isSaving}
                className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-800 bg-slate-950 text-slate-500 hover:text-white disabled:opacity-40"
                aria-label="Fechar cadastro do produto"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="mt-5">
              <ProductModalWorkspaceTabs
                active={activeWorkspace}
                onChange={setActiveWorkspace}
                disabled={isSaving}
              />
            </div>

            <div className="mt-5 space-y-4">
              {!storeId ? (
                <p className="rounded-2xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-[10px] text-amber-200">
                  Faça login novamente para acessar estoque e compras.
                </p>
              ) : activeWorkspace === 'stock' ? (
                <StoreInventoryCatalogWorkspace storeId={storeId} />
              ) : (
                <StorePurchaseWorkspace storeId={storeId} />
              )}
            </div>
          </section>
        </div>
      )}
    </>
  );
};

export type { ProductModalMode, UnifiedProductModalProps };
