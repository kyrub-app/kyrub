import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import type { MarketplaceListingDocument, Store } from '../../types';
import { auth, db } from '../../utils/firebase';
import { getMarketplaceStoreListingDocumentPath } from '../../utils/marketplacePaths';
import { loadCachedUserStore } from '../../utils/storePersistence';
import {
  resetStoreForRestart,
  STORE_RESTART_SESSION_KEY,
  type StoreResetResult,
} from '../../utils/storeReset';
import { StoreSharingPanel } from './StoreSharingPanel';

export function StoreSharingPortalBridge() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [store, setStore] = useState<Store | null>(null);
  const [canonicalPublished, setCanonicalPublished] = useState(false);
  const [fallbackPublished, setFallbackPublished] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  useEffect(() => {
    let currentHost: HTMLElement | null = null;

    const mount = (): void => {
      const mediaControls = document.getElementById('store-drive-media-controls');
      if (!mediaControls?.parentElement) {
        if (currentHost) {
          currentHost.remove();
          currentHost = null;
          setHost(null);
        }
        return;
      }

      if (currentHost?.isConnected) return;
      currentHost = document.createElement('div');
      currentHost.id = 'store-sharing-access-host';
      currentHost.className = 'mt-3';
      mediaControls.insertAdjacentElement('afterend', currentHost);
      setHost(currentHost);
    };

    mount();
    const observer = new MutationObserver(mount);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      currentHost?.remove();
      setHost(null);
    };
  }, []);

  useEffect(() => {
    let unsubscribeCanonical = () => undefined;
    let unsubscribeFallback = () => undefined;

    const refreshCachedStore = (): void => {
      const user = auth.currentUser;
      if (!user) {
        setStore(null);
        return;
      }
      setStore(loadCachedUserStore(localStorage, user.uid, user.email ?? ''));
    };

    const handleStoreSaved = (event: Event): void => {
      const savedStore = (event as CustomEvent<{ store?: Store }>).detail?.store;
      if (savedStore) setStore(savedStore);
      else refreshCachedStore();
    };

    window.addEventListener('kyrub-user-store-saved', handleStoreSaved);

    const unsubscribeAuth = onAuthStateChanged(auth, user => {
      unsubscribeCanonical();
      unsubscribeFallback();
      setCanonicalPublished(false);
      setFallbackPublished(false);

      if (!user) {
        setStore(null);
        return;
      }

      refreshCachedStore();

      unsubscribeCanonical = onSnapshot(
        doc(db, getMarketplaceStoreListingDocumentPath(user.uid)),
        snapshot => {
          const listing = snapshot.data() as MarketplaceListingDocument | undefined;
          setCanonicalPublished(
            listing?.listingType === 'store' &&
              listing.publicationStatus === 'published'
          );
        },
        () => setCanonicalPublished(false)
      );

      unsubscribeFallback = onSnapshot(
        doc(db, 'tenants', user.uid),
        snapshot =>
          setFallbackPublished(
            snapshot.data()?.publicationStatus === 'published'
          ),
        () => setFallbackPublished(false)
      );
    });

    return () => {
      window.removeEventListener('kyrub-user-store-saved', handleStoreSaved);
      unsubscribeAuth();
      unsubscribeCanonical();
      unsubscribeFallback();
    };
  }, []);

  const handleReset = async (): Promise<void> => {
    const user = auth.currentUser;
    if (!user || !store) {
      throw new Error('Faça login novamente para excluir a loja.');
    }

    setIsResetting(true);
    try {
      const result: StoreResetResult = await resetStoreForRestart(
        user,
        store,
        localStorage
      );
      setStore(result.store);
      setCanonicalPublished(false);
      setFallbackPublished(false);

      window.dispatchEvent(
        new CustomEvent<StoreResetResult>('kyrub-user-store-reset', {
          detail: result,
        })
      );
      sessionStorage.setItem(STORE_RESTART_SESSION_KEY, '1');
      window.location.assign('/');
    } finally {
      setIsResetting(false);
    }
  };

  return host
    ? createPortal(
        <StoreSharingPanel
          store={store}
          isPublished={canonicalPublished || fallbackPublished}
          isResetting={isResetting}
          onReset={handleReset}
        />,
        host
      )
    : null;
}
