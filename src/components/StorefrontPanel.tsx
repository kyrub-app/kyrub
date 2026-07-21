import { useEffect, useMemo, useState } from 'react';
import type React from 'react';
import { StorefrontPanel as LegacyStorefrontPanel } from './LegacyStorefrontPanel';
import {
  subscribeToPublicProducts,
  type PublicProduct,
} from '../utils/publicProducts';

type StorefrontPanelProps = React.ComponentProps<typeof LegacyStorefrontPanel>;

export const StorefrontPanel: React.FC<StorefrontPanelProps> = props => {
  const storeId = props.activeConsumerStore?.id ?? '';
  const [publicProducts, setPublicProducts] = useState<PublicProduct[] | null>(
    null
  );

  useEffect(() => {
    setPublicProducts(null);

    if (!storeId) {
      setPublicProducts([]);
      return;
    }

    return subscribeToPublicProducts(
      storeId,
      products => setPublicProducts(products),
      error => {
        console.warn('Produtos públicos da loja indisponíveis.', error);
      }
    );
  }, [storeId]);

  const localStoreProducts = useMemo(
    () =>
      props.products.filter(
        product =>
          product.supplierId === storeId && product.wholesalePrice === undefined
      ),
    [props.products, storeId]
  );

  return (
    <LegacyStorefrontPanel
      {...props}
      products={publicProducts ?? localStoreProducts}
    />
  );
};
