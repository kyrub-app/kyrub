import { useEffect, useState } from 'react';
import type React from 'react';
import type { Product } from '../../types';
import { auth } from '../../utils/firebase';
import {
  createEmptyProductFiscalProfile,
  normalizeProductFiscalProfile,
  persistProductFiscalProfile,
  type ProductFiscalEditorState,
} from '../../utils/productFiscal';
import {
  persistProductLoyaltyPoints,
  subscribeToProductLoyalty,
} from '../../utils/productLoyalty';
import { ProductCreateWizardBridge } from './ProductCreateWizardBridge';
import { ProductFiscalFieldsBridge } from './ProductFiscalFieldsBridge';
import { ProductLoyaltyFieldsBridge } from './ProductLoyaltyFieldsBridge';
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
  const [loyaltyPoints, setLoyaltyPoints] = useState(0);
  const [initialLoyaltyPoints, setInitialLoyaltyPoints] = useState(0);
  const [loyaltyReady, setLoyaltyReady] = useState(mode === 'create');

  useEffect(() => {
    if (!resolvedOpen) return;
    if (mode === 'create' || !product?.id) {
      setLoyaltyPoints(0);
      setInitialLoyaltyPoints(0);
      setLoyaltyReady(true);
      return;
    }
    const user = auth.currentUser;
    if (!user) {
      setLoyaltyReady(false);
      return;
    }
    setLoyaltyReady(false);
    return subscribeToProductLoyalty(
      user.uid,
      rules => {
        const next = rules[product.id] ?? 0;
        setLoyaltyPoints(next);
        setInitialLoyaltyPoints(next);
        setLoyaltyReady(true);
      },
      () => setLoyaltyReady(true)
    );
  }, [mode, product?.id, resolvedOpen]);

  const handleSave = async (nextProduct: Product): Promise<void> => {
    if (!fiscalState.ready) {
      throw new Error(
        'Aguarde os dados fiscais terminarem de carregar antes de salvar.'
      );
    }
    if (!loyaltyReady) {
      throw new Error('Aguarde a regra de fidelidade terminar de carregar.');
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
    await persistProductLoyaltyPoints(user, nextProduct.id, loyaltyPoints);

    try {
      await onSave(nextProduct);
      setInitialLoyaltyPoints(loyaltyPoints);
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
      void persistProductLoyaltyPoints(
        user,
        nextProduct.id,
        initialLoyaltyPoints
      ).catch(rollbackError => {
        console.error(
          'Não foi possível reverter os pontos de fidelidade após a falha do item.',
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
      <ProductLoyaltyFieldsBridge
        isOpen={resolvedOpen}
        points={loyaltyPoints}
        disabled={isSaving || !loyaltyReady}
        onChange={setLoyaltyPoints}
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
