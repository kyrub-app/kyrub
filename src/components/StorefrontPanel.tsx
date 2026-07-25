import { useEffect, useMemo, useState } from 'react';
import type React from 'react';
import { StorefrontPanel as LegacyStorefrontPanel } from './LegacyStorefrontPanel';
import {
  subscribeToPreferredPublicProducts,
  type PublicProduct,
} from '../utils/publicProducts';
import {
  subscribeToStoreCustomerOrders,
  type CustomerOrderStatus,
} from '../utils/customerOrders';

const KDS_ACTIVE_STATUSES = new Set<CustomerOrderStatus>([
  'pending',
  'accepted',
  'preparing',
  'ready',
]);

const CONFIRMED_SALE_STATUSES = new Set<CustomerOrderStatus>([
  'accepted',
  'preparing',
  'ready',
  'out_for_delivery',
  'completed',
]);

type StorefrontPanelProps = Omit<
  React.ComponentProps<typeof LegacyStorefrontPanel>,
  'activeKdsOrderCount' | 'salesByProductId'
>;

export const StorefrontPanel: React.FC<StorefrontPanelProps> = props => {
  const storeId = props.activeConsumerStore?.id ?? '';
  const [publicProducts, setPublicProducts] = useState<PublicProduct[] | null>(
    null
  );
  const [activeKdsOrderCount, setActiveKdsOrderCount] = useState(0);
  const [salesByProductId, setSalesByProductId] = useState<Record<string, number>>(
    {}
  );

  useEffect(() => {
    setPublicProducts(null);

    if (!storeId) {
      setPublicProducts([]);
      return;
    }

    return subscribeToPreferredPublicProducts(
      storeId,
      result => setPublicProducts(result.products),
      error => {
        console.warn(
          'Leitura canônica de produtos indisponível; usando o catálogo legado.',
          error
        );
      }
    );
  }, [storeId]);

  useEffect(() => {
    setActiveKdsOrderCount(0);
    setSalesByProductId({});
    if (!storeId) return;

    return subscribeToStoreCustomerOrders(
      storeId,
      orders => {
        setActiveKdsOrderCount(
          orders.filter(order => KDS_ACTIVE_STATUSES.has(order.status)).length
        );

        const nextSalesByProductId: Record<string, number> = {};
        for (const order of orders) {
          if (!CONFIRMED_SALE_STATUSES.has(order.status)) continue;
          for (const item of order.items) {
            nextSalesByProductId[item.productId] =
              (nextSalesByProductId[item.productId] ?? 0) + item.quantity;
          }
        }
        setSalesByProductId(nextSalesByProductId);
      },
      error => {
        console.warn('Carga atual do KDS indisponível para a vitrine.', error);
        setActiveKdsOrderCount(0);
        setSalesByProductId({});
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
      activeKdsOrderCount={activeKdsOrderCount}
      salesByProductId={salesByProductId}
    />
  );
};
