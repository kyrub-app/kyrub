import { useState } from 'react';
import type React from 'react';
import type { Product } from '../../types';
import { auth } from '../../utils/firebase';
import {
  createEmptyProductFiscalProfile,
  normalizeProductFiscalProfile,
  persistProductFiscalProfile,
  type ProductFiscalEditorState,
} from '../../utils/productFiscal';
import { ProductCreateWizardBridge } from './ProductCreateWizardBridge';
import { ProductFiscalFieldsBridge } from './ProductFiscalFieldsBridge';
import { ProductPricingFieldsBridge } from './ProductPricingFieldsBridge';
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
  isSaving,
  ...props
}) => {
  const resolvedOpen = isOpen ?? Boolean(product);
  const [fiscalState, setFiscalState] = useState<ProductFiscalEditorState>({
    ready: false,
    draft: createEmptyProductFiscalProfile(
      product?.isService === true ? 'service' : 'goods'
    ),
    initialProfile: null,
  });

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

    const kind = nextProduct.isService === true ? 'service' : 'goods';
    const nextFiscalProfile = normalizeProductFiscalProfile(
      fiscalState.draft,
      kind
    );
    const previousFiscalProfile = fiscalState.initialProfile;

    await persistProductFiscalProfile(
      user,
      nextProduct.id,
      nextFiscalProfile
    );

    try {
      await onSave(nextProduct);
    } catch (error) {
      void persistProductFiscalProfile(
        user,
        nextProduct.id,
        previousFiscalProfile
      ).catch(rollbackError => {
        console.error(
          'Não foi possível reverter os dados fiscais após a falha do item.',
          rollbackError
        );
      });
      throw error;
    }
  };

  return (
    <>
      <UnifiedProductModal
        {...props}
        isOpen={resolvedOpen}
        mode={mode}
        product={product}
        isSaving={isSaving}
        onSave={handleSave}
      />
      {mode === 'create' && (
        <ProductCreateWizardBridge
          isOpen={resolvedOpen}
          isSaving={isSaving}
        />
      )}
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
    </>
  );
};

export type { ProductModalMode, UnifiedProductModalProps };
