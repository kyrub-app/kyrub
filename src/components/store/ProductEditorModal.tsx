import { useEffect, useState } from 'react';
import type React from 'react';
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
import { ProductPricingFieldsBridge } from './ProductPricingFieldsBridge';
import { ProductStorePointsFieldBridge } from './ProductStorePointsFieldBridge';
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
    setStorePointsPerUnit(
      normalizeStorePointsPerUnit(product?.storePointsPerUnit)
    );
  }, [resolvedOpen, product?.id, product?.storePointsPerUnit]);

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

    await persistProductFiscalProfile(
      user,
      productWithStorePoints.id,
      nextFiscalProfile
    );

    try {
      await onSave(productWithStorePoints);
    } catch (error) {
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
    </>
  );
};

export type { ProductModalMode, UnifiedProductModalProps };
