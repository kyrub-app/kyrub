import { useEffect, useMemo, useState } from 'react';
import type React from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { StorefrontPanel as LegacyStorefrontPanel } from './LegacyStorefrontPanel';
import {
  subscribeToPreferredPublicProducts,
  type PublicProduct,
} from '../utils/publicProducts';
import {
  subscribeToStoreCustomerOrders,
  type CustomerOrderStatus,
} from '../utils/customerOrders';
import {
  parseCatalogCustomizationDefaults,
  resolveCatalogCustomization,
  type CatalogCustomizationDefaults,
} from '../utils/catalogCustomizationInheritance';
import { db } from '../utils/firebase';

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

const sourceProductId = (value: string): string =>
  value.split('::', 1)[0]?.trim() || value.trim();

export const StorefrontPanel: React.FC<StorefrontPanelProps> = props => {
  const storeId = props.activeConsumerStore?.id ?? '';
  const [publicProducts, setPublicProducts] = useState<PublicProduct[] | null>(
    null
  );
  const [customizationDefaults, setCustomizationDefaults] = useState<
    CatalogCustomizationDefaults[]
  >([]);
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
    setCustomizationDefaults([]);
    if (!storeId) return;

    return onSnapshot(
      doc(db, 'tenants', storeId),
      snapshot =>
        setCustomizationDefaults(
          parseCatalogCustomizationDefaults(
            snapshot.data()?.catalogCustomizationDefaults
          )
        ),
      error => {
        console.warn(
          'Padrões herdados do catálogo indisponíveis na vitrine.',
          error
        );
        setCustomizationDefaults([]);
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
            const productId = sourceProductId(item.productId);
            nextSalesByProductId[productId] =
              (nextSalesByProductId[productId] ?? 0) + item.quantity;
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

  const storefrontProducts = useMemo(
    () =>
      (publicProducts ?? localStoreProducts).map(product => {
        const resolved = resolveCatalogCustomization(
          product,
          customizationDefaults
        );
        return {
          ...product,
          ...(resolved.quickNotes.length > 0
            ? { quickNotes: resolved.quickNotes }
            : { quickNotes: undefined }),
          ...(resolved.optionGroups.length > 0
            ? { optionGroups: resolved.optionGroups }
            : { optionGroups: undefined }),
        };
      }),
    [customizationDefaults, localStoreProducts, publicProducts]
  );

  return (
    <LegacyStorefrontPanel
      {...props}
      products={storefrontProducts}
      activeKdsOrderCount={activeKdsOrderCount}
      salesByProductId={salesByProductId}
    />
  );
};