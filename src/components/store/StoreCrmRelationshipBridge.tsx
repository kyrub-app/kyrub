import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../../utils/firebase';
import { StoreCrmRelationshipPanel } from './StoreCrmRelationshipPanel';

export const StoreCrmRelationshipBridge = () => {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [storeId, setStoreId] = useState('');

  useEffect(() => onAuthStateChanged(auth, user => setStoreId(user?.uid ?? '')), []);

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    let portalHost: HTMLDivElement | null = null;

    const mount = () => {
      if (cancelled) return;
      const container = document.getElementById('erp-clientes-tab');
      if (!container) {
        timer = window.setTimeout(mount, 60);
        return;
      }
      portalHost = document.createElement('div');
      portalHost.id = 'store-crm-relationship-host';
      portalHost.className = 'mb-4 min-w-0';
      container.insertBefore(portalHost, container.firstChild);
      setHost(portalHost);
    };

    timer = window.setTimeout(mount, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      portalHost?.remove();
      setHost(null);
    };
  }, []);

  if (!host || !storeId) return null;
  return createPortal(<StoreCrmRelationshipPanel storeId={storeId} />, host);
};
