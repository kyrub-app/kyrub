import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from '../../utils/firebase';
import { StorePromotionsManager } from '../StorePromotionsManager';

const LEGACY_VOUCHER_HEADING = 'CRIAR NOVO CUPOM';

const findLegacyVoucherGrid = (): HTMLElement | null => {
  const managementContainer = document.getElementById('erp-gerencial-tab');
  if (!managementContainer) return null;

  const heading = Array.from(managementContainer.querySelectorAll('h4')).find(
    candidate =>
      candidate.textContent?.trim().toLocaleUpperCase('pt-BR') ===
      LEGACY_VOUCHER_HEADING
  );
  const grid = heading?.closest('.grid');
  return grid instanceof HTMLElement ? grid : null;
};

/**
 * The retailer production shell still owns Gerencial navigation. When the
 * legacy Vouchers submodule becomes visible, replace only its session-local
 * form with the server-authoritative promotion manager.
 */
export function StorePromotionsLegacyBridge() {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    let portalHost: HTMLDivElement | null = null;
    let legacyGrid: HTMLElement | null = null;
    let previousDisplay = '';

    const detach = (): void => {
      if (legacyGrid?.isConnected) legacyGrid.style.display = previousDisplay;
      portalHost?.remove();
      portalHost = null;
      legacyGrid = null;
      previousDisplay = '';
      setHost(null);
    };

    const synchronize = (): void => {
      if (cancelled) return;

      if (portalHost && !portalHost.isConnected) detach();

      if (!portalHost) {
        const candidate = findLegacyVoucherGrid();
        if (candidate?.parentElement) {
          legacyGrid = candidate;
          previousDisplay = candidate.style.display;
          candidate.style.display = 'none';

          portalHost = document.createElement('div');
          portalHost.id = 'kyrub-native-store-promotions-host';
          portalHost.className = 'min-w-0';
          candidate.parentElement.insertBefore(portalHost, candidate);
          setHost(portalHost);
        }
      }

      timer = window.setTimeout(synchronize, 80);
    };

    timer = window.setTimeout(synchronize, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      detach();
    };
  }, []);

  if (!user || !host) return null;

  return createPortal(
    <StorePromotionsManager
      storeId={user.uid}
      products={[]}
      triggerToast={() => undefined}
    />,
    host
  );
}
