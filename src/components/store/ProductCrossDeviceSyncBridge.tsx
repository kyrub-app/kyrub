import { useEffect, useRef } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../../utils/firebase';
import { parsePublicProducts } from '../../utils/publicProducts';
import {
  LEGACY_PRODUCT_CACHE_KEY,
  mergeCloudProductsIntoLegacyCache,
  parseLegacyProductCache,
  productCacheSignature,
} from '../../utils/productCrossDeviceSync';

interface ProductCrossDeviceSyncBridgeProps {
  onCloudProductsApplied: () => void;
}

export function ProductCrossDeviceSyncBridge({
  onCloudProductsApplied,
}: ProductCrossDeviceSyncBridgeProps) {
  const callbackRef = useRef(onCloudProductsApplied);
  const lastAppliedSignatureRef = useRef('');
  const refreshTimerRef = useRef<number | null>(null);

  useEffect(() => {
    callbackRef.current = onCloudProductsApplied;
  }, [onCloudProductsApplied]);

  useEffect(() => {
    let cancelled = false;
    let unsubscribeProducts = () => undefined;

    const clearRefreshTimer = (): void => {
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };

    const refreshLegacyStateWhenSafe = (): void => {
      clearRefreshTimer();
      const productModalOpen = Boolean(
        document.getElementById('unified-product-modal')
      );

      if (productModalOpen) {
        refreshTimerRef.current = window.setTimeout(
          refreshLegacyStateWhenSafe,
          250
        );
        return;
      }

      if (!cancelled) callbackRef.current();
    };

    const unsubscribeAuth = onAuthStateChanged(auth, user => {
      unsubscribeProducts();
      unsubscribeProducts = () => undefined;
      clearRefreshTimer();
      lastAppliedSignatureRef.current = '';

      if (!user || cancelled) return;

      unsubscribeProducts = onSnapshot(
        doc(db, 'tenants', user.uid),
        { includeMetadataChanges: true },
        snapshot => {
          if (
            cancelled ||
            !snapshot.exists() ||
            snapshot.metadata.fromCache ||
            snapshot.metadata.hasPendingWrites
          ) {
            return;
          }

          const cloudProducts = parsePublicProducts(
            snapshot.data()?.publicProducts
          );
          const cachedProducts = parseLegacyProductCache(
            localStorage.getItem(LEGACY_PRODUCT_CACHE_KEY)
          );
          const nextProducts = mergeCloudProductsIntoLegacyCache(
            cachedProducts,
            cloudProducts,
            user.uid
          );
          const currentSignature = productCacheSignature(cachedProducts);
          const nextSignature = productCacheSignature(nextProducts);

          if (
            nextSignature === currentSignature ||
            nextSignature === lastAppliedSignatureRef.current
          ) {
            return;
          }

          lastAppliedSignatureRef.current = nextSignature;
          localStorage.setItem(
            LEGACY_PRODUCT_CACHE_KEY,
            JSON.stringify(nextProducts)
          );
          window.dispatchEvent(
            new CustomEvent('kyrub-products-cloud-cache-updated', {
              detail: {
                uid: user.uid,
                products: cloudProducts,
              },
            })
          );
          refreshLegacyStateWhenSafe();
        },
        error => {
          console.warn(
            'Não foi possível sincronizar os produtos entre dispositivos.',
            error
          );
        }
      );
    });

    return () => {
      cancelled = true;
      clearRefreshTimer();
      unsubscribeAuth();
      unsubscribeProducts();
    };
  }, []);

  return null;
}
