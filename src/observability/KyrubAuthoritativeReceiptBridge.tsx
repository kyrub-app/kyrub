import { useEffect } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../utils/firebase';
import { KYRUB_ACTIVITY_UPDATED_EVENT } from './kyrubActivityBrowser';
import { rehydrateKyrubiaAuthoritativeReceipt } from './kyrubAuthoritativeReceiptRehydration';

export function KyrubAuthoritativeReceiptBridge() {
  useEffect(() => {
    if (typeof window === 'undefined') return;

    let disposed = false;
    let rehydrating = false;

    const rehydrate = async () => {
      if (disposed || rehydrating) return;
      const user = auth.currentUser;
      if (!user) return;
      rehydrating = true;
      try {
        await rehydrateKyrubiaAuthoritativeReceipt(window.localStorage, user);
      } catch (error) {
        console.warn('[Kyrubia] authoritative receipt rehydration unavailable.', error);
      } finally {
        rehydrating = false;
      }
    };

    const unsubscribeAuth = onAuthStateChanged(auth, user => {
      if (!user || disposed) return;
      void rehydrate();
    });
    const handleActivity = () => void rehydrate();
    const handleFocus = () => void rehydrate();

    window.addEventListener(KYRUB_ACTIVITY_UPDATED_EVENT, handleActivity);
    window.addEventListener('focus', handleFocus);
    void rehydrate();

    return () => {
      disposed = true;
      unsubscribeAuth();
      window.removeEventListener(KYRUB_ACTIVITY_UPDATED_EVENT, handleActivity);
      window.removeEventListener('focus', handleFocus);
    };
  }, []);

  return null;
}
