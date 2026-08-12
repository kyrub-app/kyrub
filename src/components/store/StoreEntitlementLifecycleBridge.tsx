import { useEffect } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { invalidateKyrubErpContext } from '../../actions/erpReadActionService';
import { reconcileOwnStoreEntitlement } from '../../utils/couponRedemption';
import { auth } from '../../utils/firebase';
import {
  loadCachedUserStore,
  saveCachedUserStore,
} from '../../utils/storePersistence';

const sessionKey = (uid: string): string =>
  `kyrub_store_entitlement_reconciled_${uid}`;

export function StoreEntitlementLifecycleBridge() {
  useEffect(() => {
    let cancelled = false;
    const unsubscribe = onAuthStateChanged(auth, user => {
      if (!user || cancelled) return;
      const key = sessionKey(user.uid);
      try {
        if (sessionStorage.getItem(key) === '1') return;
        sessionStorage.setItem(key, '1');
      } catch {
        // The session guard only avoids duplicate maintenance calls. The
        // server remains authoritative and action execution reconciles again.
      }

      void reconcileOwnStoreEntitlement(user)
        .then(result => {
          if (cancelled || !result.changed || !result.plan) return;
          const cached = loadCachedUserStore(
            localStorage,
            user.uid,
            user.email ?? ''
          );
          if (cached) {
            saveCachedUserStore(
              localStorage,
              user.uid,
              { ...cached, plan: result.plan },
              false
            );
          }
          invalidateKyrubErpContext(user.uid);
          window.dispatchEvent(
            new CustomEvent('kyrub:store-entitlement-updated', {
              detail: {
                plan: result.plan,
                source: 'expiry_reconciliation',
              },
            })
          );
        })
        .catch(error => {
          try {
            sessionStorage.removeItem(key);
          } catch {
            // A failed client reconciliation never weakens server enforcement.
          }
          console.warn(
            '[Kyrub Plans] Store entitlement lifecycle reconciliation is unavailable.',
            error
          );
        });
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return null;
}
