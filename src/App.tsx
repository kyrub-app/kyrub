import { useEffect } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import LegacyApp from './LegacyApp';
import AdminControlPlaneApp from './components/admin/AdminControlPlaneApp';
import { useFontSizeAccessibility } from './hooks/useFontSizeAccessibility';
import { auth } from './utils/firebase';
import { isAdminControlPlaneLocation } from './utils/adminControlPlane';
import {
  hasPendingUserStoreSync,
  loadCachedUserStore,
  persistPrivateUserStore,
  saveCachedUserStore,
} from './utils/storePersistence';

function StorePersistenceBridge() {
  useEffect(() => {
    let cancelled = false;

    const unsubscribe = onAuthStateChanged(auth, user => {
      if (!user || cancelled) return;
      if (!hasPendingUserStoreSync(localStorage, user.uid)) return;

      const cachedStore = loadCachedUserStore(
        localStorage,
        user.uid,
        user.email ?? ''
      );
      if (!cachedStore) return;

      void persistPrivateUserStore(user, cachedStore)
        .then(() => {
          if (cancelled) return;
          saveCachedUserStore(
            localStorage,
            user.uid,
            cachedStore,
            false
          );

          // The legacy app may finish an older remote read after this bridge.
          // Re-assert the reconciled cache once its initial sync has settled.
          window.setTimeout(() => {
            if (!cancelled) {
              saveCachedUserStore(
                localStorage,
                user.uid,
                cachedStore,
                false
              );
            }
          }, 1200);
        })
        .catch(error => {
          console.warn('Pending user store sync remains queued.', error);
        });
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return null;
}

export default function App() {
  useFontSizeAccessibility();

  const adminControlPlane = isAdminControlPlaneLocation(
    window.location.hostname,
    window.location.pathname
  );

  if (adminControlPlane) return <AdminControlPlaneApp />;

  return (
    <>
      <StorePersistenceBridge />
      <LegacyApp />
    </>
  );
}
