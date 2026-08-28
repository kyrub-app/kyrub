import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Order, Store } from '../../types';
import { CustomerStoreRelationshipsPanel } from './CustomerStoreRelationshipsPanel';

type Props = {
  enabled: boolean;
  stores: Store[];
  orders: Order[];
  onEnterStore: (store: Store) => void;
  initialStoreId?: string;
  onInitialStoreHandled?: () => void;
};

const normalizedText = (value: string | null | undefined): string =>
  value?.trim().toLocaleUpperCase('pt-BR') ?? '';

export function CustomerRelationshipsShoppingBridge({
  enabled,
  stores,
  orders,
  onEnterStore,
  initialStoreId = '',
  onInitialStoreHandled,
}: Props) {
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    let disposed = false;
    let timer = 0;
    let currentHost: HTMLDivElement | null = null;
    let hiddenGrid: HTMLElement | null = null;
    let previousDisplay = '';

    const restore = (): void => {
      if (hiddenGrid?.isConnected) hiddenGrid.style.display = previousDisplay;
      hiddenGrid = null;
      previousDisplay = '';
      currentHost?.remove();
      currentHost = null;
      setHost(null);
    };

    const synchronize = (): void => {
      if (disposed) return;
      if (!enabled) {
        restore();
        timer = window.setTimeout(synchronize, 120);
        return;
      }

      const clientButton = Array.from(document.querySelectorAll('button')).find(
        button => normalizedText(button.textContent) === 'CLIENTE'
      );
      const section = clientButton?.closest('.space-y-4');
      if (!(section instanceof HTMLElement)) {
        restore();
        timer = window.setTimeout(synchronize, 120);
        return;
      }

      const grids = Array.from(section.children).filter(
        child => child instanceof HTMLElement && child.classList.contains('grid') && child.classList.contains('grid-cols-2')
      ) as HTMLElement[];
      const storeGrid = grids[0] ?? null;

      if (!storeGrid) {
        restore();
        timer = window.setTimeout(synchronize, 120);
        return;
      }

      if (!currentHost || !currentHost.isConnected || hiddenGrid !== storeGrid) {
        restore();
        hiddenGrid = storeGrid;
        previousDisplay = storeGrid.style.display;
        storeGrid.style.display = 'none';
        currentHost = document.createElement('div');
        currentHost.id = 'kyrub-customer-relationships-host';
        storeGrid.parentElement?.insertBefore(currentHost, storeGrid);
        setHost(currentHost);
      }

      timer = window.setTimeout(synchronize, 180);
    };

    synchronize();
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      restore();
    };
  }, [enabled]);

  useEffect(() => {
    if (!host || !enabled || !initialStoreId) return;
    const targetStore = stores.find(store => store.id === initialStoreId);
    if (!targetStore) return;
    let attempts = 0;
    let timer = 0;
    const openTarget = () => {
      attempts += 1;
      const heading = Array.from(host.querySelectorAll('h4')).find(
        item => normalizedText(item.textContent) === normalizedText(targetStore.name)
      );
      const button = heading?.closest('button');
      if (button instanceof HTMLButtonElement) {
        button.click();
        onInitialStoreHandled?.();
        return;
      }
      if (attempts < 25) timer = window.setTimeout(openTarget, 100);
    };
    openTarget();
    return () => window.clearTimeout(timer);
  }, [enabled, host, initialStoreId, onInitialStoreHandled, stores]);

  if (!host || !enabled) return null;

  return createPortal(
    <CustomerStoreRelationshipsPanel
      stores={stores}
      orders={orders}
      onEnterStore={onEnterStore}
    />,
    host
  );
}
