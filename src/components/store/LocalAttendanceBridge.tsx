import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { onAuthStateChanged } from 'firebase/auth';
import type { ServiceLocation } from '../../../shared/serviceLocation';
import { auth } from '../../utils/firebase';
import { loadServiceLocations } from '../../utils/serviceLocations';
import { LocalAttendanceWorkspace } from './LocalAttendanceWorkspace';

const CANONICAL_HOST_IDS = new Set([
  'store-crm-relationship-host',
  'kyrub-customer-table-board-host',
  'canonical-local-attendance-host',
]);

export const LocalAttendanceBridge = () => {
  const [storeId, setStoreId] = useState(auth.currentUser?.uid ?? '');
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [serviceLocations, setServiceLocations] = useState<ServiceLocation[]>([]);

  useEffect(() => onAuthStateChanged(auth, user => setStoreId(user?.uid ?? '')), []);

  const refreshLocations = useCallback(async (): Promise<void> => {
    if (!storeId) {
      setServiceLocations([]);
      return;
    }
    try {
      setServiceLocations(await loadServiceLocations(storeId, { activeOnly: true }));
    } catch (error) {
      console.warn('Canonical service locations are unavailable.', error);
    }
  }, [storeId]);

  useEffect(() => {
    void refreshLocations();
    const handleLocationsChanged = () => void refreshLocations();
    window.addEventListener('kyrub-service-locations-changed', handleLocationsChanged);
    return () => window.removeEventListener('kyrub-service-locations-changed', handleLocationsChanged);
  }, [refreshLocations]);

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    let portalHost: HTMLDivElement | null = null;
    let hiddenNodes: Array<{ node: HTMLElement; display: string }> = [];

    const restoreLegacy = (): void => {
      hiddenNodes.forEach(({ node, display }) => {
        if (node.isConnected) node.style.display = display;
      });
      hiddenNodes = [];
    };

    const mount = (): void => {
      if (cancelled) return;
      if (portalHost?.isConnected) return;

      restoreLegacy();
      portalHost?.remove();
      portalHost = null;
      setHost(null);

      const container = document.getElementById('erp-clientes-tab');
      const opener = document.getElementById('erp-attendance-opener-row');
      if (!(container instanceof HTMLElement) || !(opener instanceof HTMLElement)) {
        timer = window.setTimeout(mount, 60);
        return;
      }

      const headerBlock = opener.parentElement;
      if (!(headerBlock instanceof HTMLElement) || headerBlock.parentElement !== container) {
        timer = window.setTimeout(mount, 60);
        return;
      }

      const directChildren = Array.from(container.children).filter(
        (child): child is HTMLElement => child instanceof HTMLElement
      );
      const legacyNodes = directChildren.filter(child => {
        if (CANONICAL_HOST_IDS.has(child.id)) return false;
        if (child === headerBlock) return true;
        if (child.id === 'empty-clients') return true;
        if (child.id) return false;
        return child !== headerBlock && !child.querySelector('[id$="-host"]');
      });

      for (const node of legacyNodes) {
        hiddenNodes.push({ node, display: node.style.display });
        node.style.display = 'none';
      }

      portalHost = document.createElement('div');
      portalHost.id = 'canonical-local-attendance-host';
      portalHost.className = 'min-w-0';
      container.insertBefore(portalHost, headerBlock);
      setHost(portalHost);
    };

    const observer = new MutationObserver(() => {
      if (!portalHost?.isConnected) {
        window.clearTimeout(timer);
        timer = window.setTimeout(mount, 30);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    timer = window.setTimeout(mount, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      observer.disconnect();
      restoreLegacy();
      portalHost?.remove();
      setHost(null);
    };
  }, []);

  if (!host || !storeId) return null;
  return createPortal(
    <LocalAttendanceWorkspace
      storeId={storeId}
      serviceLocations={serviceLocations}
    />,
    host
  );
};