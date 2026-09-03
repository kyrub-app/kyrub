import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { User } from 'firebase/auth';
import MercadoLivreE2ETestBridge from './MercadoLivreE2ETestBridge';
import NinetyNineFoodE2ETestBridge from './NinetyNineFoodE2ETestBridge';
import PhysicalInventoryWorkspace from './PhysicalInventoryWorkspace';
import StoreChannelCenter from './StoreChannelCenter';
import StoreChannelOperationsQueue from './StoreChannelOperationsQueue';
import StoreConnectionsWorkspace from './StoreConnectionsWorkspace';

interface StoreConnectionsPortalBridgeProps {
  user: User;
  storeId: string;
  notify: (message: string, type?: 'success' | 'error' | 'info') => void;
}

export default function StoreConnectionsPortalBridge({
  user,
  storeId,
  notify,
}: StoreConnectionsPortalBridgeProps) {
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    let portalHost: HTMLDivElement | null = null;

    const mount = (): void => {
      if (cancelled) return;

      const productHost = document.getElementById('kyrub-product-inventory-workspace-host');
      if (!productHost?.parentElement) {
        timer = window.setTimeout(mount, 80);
        return;
      }

      const existing = document.getElementById('kyrub-store-connections-workspace-host');
      if (existing instanceof HTMLElement) {
        portalHost = existing as HTMLDivElement;
        setHost(existing);
        return;
      }

      portalHost = document.createElement('div');
      portalHost.id = 'kyrub-store-connections-workspace-host';
      portalHost.className = 'mb-5 min-w-0';
      productHost.parentElement.insertBefore(portalHost, productHost);
      setHost(portalHost);
    };

    timer = window.setTimeout(mount, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      portalHost?.remove();
      setHost(null);
    };
  }, [storeId, user.uid]);

  if (!host || user.uid !== storeId) return null;

  return createPortal(
    <div className="space-y-5">
      <StoreChannelCenter user={user} storeId={storeId} />
      <StoreChannelOperationsQueue user={user} storeId={storeId} />
      <PhysicalInventoryWorkspace storeId={storeId} />
      <div id="kyrub-mercado-livre-channel-detail">
        <StoreConnectionsWorkspace user={user} storeId={storeId} notify={notify} />
      </div>
      <MercadoLivreE2ETestBridge user={user} storeId={storeId} notify={notify} />
      <div id="kyrub-99food-channel-detail">
        <NinetyNineFoodE2ETestBridge notify={notify} />
      </div>
    </div>,
    host
  );
}
