import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { StoreCrmPanel } from '../customer/StoreCrmPanel';
import { auth } from '../../utils/firebase';

export function StoreCrmBridge() {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  useEffect(() => {
    let cancelled = false;
    let currentHost: HTMLDivElement | null = null;
    let currentContainer: HTMLElement | null = null;
    let hiddenEmptyState: HTMLElement | null = null;
    let previousEmptyDisplay = '';

    const teardown = (): void => {
      if (hiddenEmptyState?.isConnected) {
        hiddenEmptyState.style.display = previousEmptyDisplay;
      }
      hiddenEmptyState = null;
      previousEmptyDisplay = '';
      currentHost?.remove();
      currentHost = null;
      currentContainer = null;
      setHost(null);
    };

    const synchronize = (): void => {
      if (cancelled) return;
      const clientsContainer = document.getElementById('erp-clientes-tab');
      if (!(clientsContainer instanceof HTMLElement)) {
        if (currentHost) teardown();
        return;
      }

      if (currentContainer !== clientsContainer || !currentHost?.isConnected) {
        teardown();
        currentContainer = clientsContainer;
        const nextHost = document.createElement('div');
        nextHost.id = 'kyrub-store-crm-host';
        nextHost.className = 'mb-4 min-w-0';
        clientsContainer.prepend(nextHost);
        currentHost = nextHost;
        setHost(nextHost);

        const emptyState = document.getElementById('empty-clients');
        if (emptyState instanceof HTMLElement) {
          hiddenEmptyState = emptyState;
          previousEmptyDisplay = emptyState.style.display;
          emptyState.style.display = 'none';
        }
      }
    };

    synchronize();
    const observer = new MutationObserver(synchronize);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      cancelled = true;
      observer.disconnect();
      teardown();
    };
  }, []);

  if (!user || !host) return null;
  return createPortal(<StoreCrmPanel storeId={user.uid} />, host);
}
