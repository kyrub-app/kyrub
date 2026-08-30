import { useEffect, useRef } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import type { User } from 'firebase/auth';
import type { DeliveryJob } from '../../types';
import { auth } from '../../utils/firebase';
import {
  updateKyrubDeliveryOpportunityStatus,
  type KyrubDeliveryOperationalStatus,
} from '../../utils/deliveryOpportunities';

const DELIVERY_STORAGE_KEY = 'kyrub_deliveries';
const SYNC_INTERVAL_MS = 1_000;
const RETRY_DELAY_MS = 10_000;
const CLOUD_STATUSES = new Set<KyrubDeliveryOperationalStatus>([
  'accepted',
  'done',
]);

const normalize = (value: string): string =>
  value.trim().toLocaleLowerCase('pt-BR');

const belongsToAuthenticatedCourier = (
  delivery: DeliveryJob,
  user: Pick<User, 'uid' | 'displayName' | 'email'>
): boolean => {
  const acceptedBy = normalize(delivery.acceptedBy ?? '');
  if (!acceptedBy) return false;
  const identities = new Set(
    [user.uid, user.displayName ?? '', user.email ?? '', 'Você']
      .map(normalize)
      .filter(Boolean)
  );
  return identities.has(acceptedBy);
};

const readCachedDeliveries = (): DeliveryJob[] => {
  try {
    const value = localStorage.getItem(DELIVERY_STORAGE_KEY);
    if (!value) return [];
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed as DeliveryJob[] : [];
  } catch {
    return [];
  }
};

export function KyrubDeliveryStatusSyncBridge() {
  const synchronized = useRef(new Map<string, DeliveryJob['status']>());
  const inFlight = useRef(new Set<string>());
  const retryAt = useRef(new Map<string, number>());

  useEffect(() => {
    let interval = 0;

    const unsubscribeAuth = onAuthStateChanged(auth, user => {
      window.clearInterval(interval);
      synchronized.current.clear();
      inFlight.current.clear();
      retryAt.current.clear();
      if (!user) return;

      const synchronize = (): void => {
        for (const delivery of readCachedDeliveries()) {
          if (!delivery.id.startsWith('order-')) continue;
          if (!CLOUD_STATUSES.has(delivery.status as KyrubDeliveryOperationalStatus)) {
            continue;
          }
          if (!belongsToAuthenticatedCourier(delivery, user)) continue;
          if (synchronized.current.get(delivery.id) === delivery.status) continue;
          if (inFlight.current.has(delivery.id)) continue;
          if ((retryAt.current.get(delivery.id) ?? 0) > Date.now()) continue;

          inFlight.current.add(delivery.id);
          void updateKyrubDeliveryOpportunityStatus(
            delivery.id,
            delivery.status as KyrubDeliveryOperationalStatus,
            user
          )
            .then(() => {
              synchronized.current.set(delivery.id, delivery.status);
              retryAt.current.delete(delivery.id);
            })
            .catch(error => {
              retryAt.current.set(delivery.id, Date.now() + RETRY_DELAY_MS);
              console.warn(
                'A ação do entregador ainda não foi confirmada no mural Kyrub.',
                error
              );
            })
            .finally(() => {
              inFlight.current.delete(delivery.id);
            });
        }
      };

      synchronize();
      interval = window.setInterval(synchronize, SYNC_INTERVAL_MS);
    });

    return () => {
      unsubscribeAuth();
      window.clearInterval(interval);
    };
  }, []);

  return null;
}
