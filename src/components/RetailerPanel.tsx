import { useEffect } from 'react';
import type React from 'react';
import { RetailerPanel as LegacyRetailerPanel } from './LegacyRetailerPanel';
import { auth } from '../utils/firebase';
import {
  persistPublicProduct,
  PUBLIC_PRODUCT_CREATE_EVENT,
  type PublicProductCreateRequest,
} from '../utils/publicProducts';

type RetailerPanelProps = React.ComponentProps<typeof LegacyRetailerPanel>;

export const RetailerPanel: React.FC<RetailerPanelProps> = props => {
  const {
    activeRetailerId,
    activeStore,
    products,
    setProducts,
    triggerToast,
  } = props;

  useEffect(() => {
    const handlePublicProductCreate = (event: Event): void => {
      const customEvent = event as CustomEvent<PublicProductCreateRequest>;
      const request = customEvent.detail;
      const product = request?.product;

      if (!request || !product) return;
      if (product.storeId !== activeRetailerId) return;

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

    window.addEventListener(
      PUBLIC_PRODUCT_CREATE_EVENT,
      handlePublicProductCreate
    );

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

  return <LegacyRetailerPanel {...props} />;
};
