import { useEffect } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import LegacyApp from './LegacyApp';
import AdminControlPlaneApp from './components/admin/AdminControlPlaneApp';
import { NoteInvitationOutboxBridge } from './components/NoteInvitationOutboxBridge';
import { useFontSizeAccessibility } from './hooks/useFontSizeAccessibility';
import { auth, db } from './utils/firebase';
import { isAdminControlPlaneLocation } from './utils/adminControlPlane';
import {
  hasPendingUserStoreSync,
  loadCachedUserStore,
  persistPrivateUserStore,
  saveCachedUserStore,
} from './utils/storePersistence';
import { getPrimaryUserStoreDocumentPath } from './utils/storePaths';

function StorePersistenceBridge() {
  useEffect(() => {
    let cancelled = false;
    let unsubscribeStore = () => undefined;
    let syncing = false;

    const unsubscribeAuth = onAuthStateChanged(auth, user => {
      unsubscribeStore();
      unsubscribeStore = () => undefined;
      syncing = false;

      if (!user || cancelled) return;
      if (!hasPendingUserStoreSync(localStorage, user.uid)) return;

      const cachedStore = loadCachedUserStore(
        localStorage,
        user.uid,
        user.email ?? ''
      );
      if (!cachedStore) return;

      const storeReference = doc(
        db,
        getPrimaryUserStoreDocumentPath(user.uid)
      );

      // LegacyApp owns the initial create/read bootstrap for the private store.
      // Wait until that document is confirmed by the server before replaying an
      // offline pending update. This prevents two clients in the same page from
      // both observing a missing document and racing to create it, where the
      // losing full-document write would be evaluated as a forbidden update.
      unsubscribeStore = onSnapshot(
        storeReference,
        { includeMetadataChanges: true },
        snapshot => {
          if (
            cancelled ||
            syncing ||
            !snapshot.exists() ||
            snapshot.metadata.fromCache
          ) {
            return;
          }

          syncing = true;
          void persistPrivateUserStore(user, cachedStore)
            .then(() => {
              if (cancelled) return;
              saveCachedUserStore(
                localStorage,
                user.uid,
                cachedStore,
                false
              );
              unsubscribeStore();
              unsubscribeStore = () => undefined;
            })
            .catch(error => {
              console.warn('Pending user store sync remains queued.', error);
            })
            .finally(() => {
              syncing = false;
            });
        },
        error => {
          console.warn('Primary user store bootstrap is unavailable.', error);
        }
      );
    });

    return () => {
      cancelled = true;
      unsubscribeAuth();
      unsubscribeStore();
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
      <NoteInvitationOutboxBridge />
      <LegacyApp />
    </>
  );
}
