import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from '../../utils/firebase';
import { StoreInstitutionalIdentityPanel } from './StoreInstitutionalIdentityPanel';

export function StoreInstitutionalIdentityBridge() {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  useEffect(() => {
    let cancelled = false;
    let currentHost: HTMLDivElement | null = null;
    let currentContainer: HTMLElement | null = null;

    const teardown = (): void => {
      currentHost?.remove();
      currentHost = null;
      currentContainer = null;
      setHost(null);
    };

    const synchronize = (): void => {
      if (cancelled) return;
      const managementContainer = document.getElementById('erp-gerencial-tab');
      if (!(managementContainer instanceof HTMLElement)) {
        if (currentHost) teardown();
        return;
      }

      if (currentContainer !== managementContainer || !currentHost?.isConnected) {
        teardown();
        currentContainer = managementContainer;
        const nextHost = document.createElement('div');
        nextHost.id = 'kyrub-store-institutional-identity-host';
        nextHost.className = 'mb-5 min-w-0';
        managementContainer.prepend(nextHost);
        currentHost = nextHost;
        setHost(nextHost);
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
  return createPortal(<StoreInstitutionalIdentityPanel user={user} />, host);
}
