import { useEffect, useMemo, useState } from 'react';
import type React from 'react';
import { createPortal } from 'react-dom';
import { ReceiptText } from 'lucide-react';
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
  const [customerPanelHost, setCustomerPanelHost] = useState<HTMLElement | null>(
    null
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

  useEffect(() => {
    setCustomerPanelHost(null);
    if (!storeId) return;

    let cancelled = false;
    let timer = 0;
    let portalHost: HTMLDivElement | null = null;
    let selectedItemsContainer: HTMLElement | null = null;
    let sendButton: HTMLButtonElement | null = null;
    let previousPosition = '';
    let previousSendMargin = '';

    const mountCustomerPanelShortcut = (): void => {
      if (cancelled) return;

      selectedItemsContainer = document.getElementById(
        'storefront-selected-items'
      );
      sendButton = document.getElementById(
        'storefront-send-selection-btn'
      ) as HTMLButtonElement | null;

      if (!selectedItemsContainer || !sendButton) {
        timer = window.setTimeout(mountCustomerPanelShortcut, 40);
        return;
      }

      previousPosition = selectedItemsContainer.style.position;
      previousSendMargin = sendButton.style.marginRight;
      selectedItemsContainer.style.position = 'relative';
      sendButton.style.marginRight = '3.25rem';

      portalHost = document.createElement('div');
      portalHost.id = 'storefront-customer-panel-host';
      portalHost.className = 'absolute right-4 top-4 sm:right-5 sm:top-5';
      selectedItemsContainer.appendChild(portalHost);
      setCustomerPanelHost(portalHost);
    };

    timer = window.setTimeout(mountCustomerPanelShortcut, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (selectedItemsContainer) {
        selectedItemsContainer.style.position = previousPosition;
      }
      if (sendButton) sendButton.style.marginRight = previousSendMargin;
      portalHost?.remove();
      setCustomerPanelHost(null);
    };
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
    <>
      <LegacyStorefrontPanel
        {...props}
        products={publicProducts ?? localStoreProducts}
        activeKdsOrderCount={activeKdsOrderCount}
        salesByProductId={salesByProductId}
      />

      {customerPanelHost &&
        createPortal(
          <button
            type="button"
            onClick={() => props.setIsCartOpen(true)}
            className="flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-700 bg-slate-900 text-slate-200 shadow-lg transition-transform hover:scale-105 hover:border-orange-500/40 hover:text-orange-300"
            id="storefront-customer-panel-btn"
            aria-label="Abrir finalizar pedido, meu pedido e conta"
            title="Finalizar pedido, acompanhar e consultar conta"
          >
            <ReceiptText className="h-4 w-4" />
          </button>,
          customerPanelHost
        )}
    </>
  );
};
