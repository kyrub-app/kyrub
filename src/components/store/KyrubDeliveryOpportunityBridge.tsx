import { useEffect, useRef } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import type { DeliveryJob } from '../../types';
import { auth, db } from '../../utils/firebase';

const DELIVERY_STORAGE_KEY = 'kyrub_deliveries';
const DELIVERY_COLLECTION_PATH = 'hub/renda/deliveries';

type OperationalDeliveryJob = DeliveryJob & {
  source?: string;
  sourceOrderId?: string;
  orderStatus?: string;
};

interface KyrubDeliveryOpportunityBridgeProps {
  onOpportunitiesChanged: () => void;
}

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const finite = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;

const publishOpportunity = async (orderId: string): Promise<void> => {
  const user = auth.currentUser;
  if (!user) return;
  const token = await user.getIdToken();
  const response = await fetch(
    `/api/delivery-opportunities/orders/${encodeURIComponent(orderId)}/publish`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    }
  );
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    throw new Error(
      typeof payload.error === 'string'
        ? payload.error
        : 'Não foi possível publicar a oportunidade de entrega.'
    );
  }
};

export function KyrubDeliveryOpportunityBridge({
  onOpportunitiesChanged,
}: KyrubDeliveryOpportunityBridgeProps) {
  const publicationAttempts = useRef(new Set<string>());

  useEffect(() => {
    let unsubscribeOrders = () => undefined;
    let unsubscribeJobs = () => undefined;

    const unsubscribeAuth = onAuthStateChanged(auth, user => {
      unsubscribeOrders();
      unsubscribeJobs();
      unsubscribeOrders = () => undefined;
      unsubscribeJobs = () => undefined;
      publicationAttempts.current.clear();
      if (!user) return;

      unsubscribeOrders = onSnapshot(
        collection(db, `artifacts/${user.uid}/public/data/customerOrders`),
        snapshot => {
          for (const document of snapshot.docs) {
            const data = document.data() as Record<string, unknown>;
            const status = clean(data.status);
            const attemptKey = `${document.id}:${status}`;
            if (
              data.fulfillmentType !== 'delivery' ||
              clean(data.deliveryProvider) !== 'kyrub' ||
              !['preparing', 'ready', 'out_for_delivery'].includes(status) ||
              publicationAttempts.current.has(attemptKey)
            ) {
              continue;
            }
            publicationAttempts.current.add(attemptKey);
            void publishOpportunity(document.id).catch(error => {
              publicationAttempts.current.delete(attemptKey);
              console.warn('Oportunidade Kyrub Entregas ainda não publicada.', error);
            });
          }
        },
        error => {
          console.warn('Pedidos para entrega indisponíveis.', error);
        }
      );

      unsubscribeJobs = onSnapshot(
        collection(db, DELIVERY_COLLECTION_PATH),
        snapshot => {
          const jobs = snapshot.docs.flatMap(document => {
            const data = document.data() as Record<string, unknown>;
            if (clean(data.source) !== 'kyrub-order') return [];
            const status = clean(data.status);
            if (!['available', 'accepted', 'delivering', 'done'].includes(status)) {
              return [];
            }
            return [{
              id: clean(data.id) || document.id,
              from: clean(data.from),
              to: clean(data.to),
              distance: finite(data.distance),
              payment: finite(data.payment),
              status: status as DeliveryJob['status'],
              requestedBy: clean(data.requestedBy),
              acceptedBy:
                clean(data.acceptedByName) || clean(data.acceptedBy) || undefined,
              source: clean(data.source),
              sourceOrderId: clean(data.sourceOrderId),
              orderStatus: clean(data.orderStatus),
            } satisfies OperationalDeliveryJob];
          });
          localStorage.setItem(DELIVERY_STORAGE_KEY, JSON.stringify(jobs));
          onOpportunitiesChanged();
        },
        error => {
          console.warn('Mural Kyrub Entregas indisponível.', error);
        }
      );
    });

    return () => {
      unsubscribeAuth();
      unsubscribeOrders();
      unsubscribeJobs();
    };
  }, [onOpportunitiesChanged]);

  return null;
}
