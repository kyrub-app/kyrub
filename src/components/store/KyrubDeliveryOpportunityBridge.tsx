import { useEffect, useRef } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import type { DeliveryJob } from '../../types';
import { auth, db } from '../../utils/firebase';
import { assessDeliveryCargo, isCourierVehicleType } from '../../../shared/deliveryVehicleCompatibility';

const DELIVERY_STORAGE_KEY = 'kyrub_deliveries';
const PUBLIC_OFFERS_PATH = 'hub/renda/deliveryOffers';
const PRIVATE_DELIVERIES_PATH = 'hub/renda/deliveries';
const PUBLIC_DESTINATION = 'Destino exato liberado após o aceite';
const PRIVATE_DESTINATION = 'Endereço disponível no painel privado de rastreio';

type OperationalDeliveryJob = DeliveryJob & {
  source?: string;
  orderStatus?: string;
  acceptedByName?: string;
};

interface KyrubDeliveryOpportunityBridgeProps {
  onOpportunitiesChanged: () => void;
}

const clean = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const finite = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) ? value : 0;

const publishOpportunity = async (orderId: string): Promise<void> => {
  const user = auth.currentUser;
  if (!user) return;
  const token = await user.getIdToken();
  const response = await fetch(
    '/api/delivery-opportunities/orders/' + encodeURIComponent(orderId) + '/publish',
    { method: 'POST', headers: { authorization: 'Bearer ' + token } }
  );
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    throw new Error(typeof payload.error === 'string'
      ? payload.error
      : 'Não foi possível publicar a oportunidade de entrega.');
  }
};

export function KyrubDeliveryOpportunityBridge({
  onOpportunitiesChanged,
}: KyrubDeliveryOpportunityBridgeProps) {
  const publicationAttempts = useRef(new Set<string>());

  useEffect(() => {
    let generation = 0;
    let unsubscribeOrders = () => undefined;
    let unsubscribeOffers = () => undefined;
    let unsubscribeAssigned = () => undefined;

    const unsubscribeAuth = onAuthStateChanged(auth, user => {
      const currentGeneration = ++generation;
      unsubscribeOrders();
      unsubscribeOffers();
      unsubscribeAssigned();
      unsubscribeOrders = () => undefined;
      unsubscribeOffers = () => undefined;
      unsubscribeAssigned = () => undefined;
      publicationAttempts.current.clear();
      // Clear historical versions that may have cached the exact buyer address.
      localStorage.removeItem(DELIVERY_STORAGE_KEY);
      onOpportunitiesChanged();
      if (!user) return;

      let publicJobs: OperationalDeliveryJob[] = [];
      let assignedJobs: OperationalDeliveryJob[] = [];
      const refreshCache = () => {
        if (currentGeneration !== generation) return;
        const ownIds = new Set(assignedJobs.map(job => job.id));
        const safeJobs = [...assignedJobs, ...publicJobs.filter(job => !ownIds.has(job.id))];
        localStorage.setItem(DELIVERY_STORAGE_KEY, JSON.stringify(safeJobs));
        onOpportunitiesChanged();
      };

      unsubscribeOrders = onSnapshot(
        collection(db, 'artifacts/' + user.uid + '/public/data/customerOrders'),
        snapshot => {
          if (currentGeneration !== generation) return;
          for (const document of snapshot.docs) {
            const data = document.data() as Record<string, unknown>;
            const status = clean(data.status);
            const attemptKey = document.id + ':' + status;
            if (data.fulfillmentType !== 'delivery' ||
                clean(data.deliveryProvider) !== 'kyrub' ||
                !['preparing', 'ready', 'out_for_delivery'].includes(status) ||
                publicationAttempts.current.has(attemptKey)) continue;
            publicationAttempts.current.add(attemptKey);
            void publishOpportunity(document.id).catch(error => {
              if (currentGeneration !== generation) return;
              publicationAttempts.current.delete(attemptKey);
              console.warn('Oportunidade Kyrub Entregas ainda não publicada.', error);
            });
          }
        },
        error => {
          if (currentGeneration === generation) console.warn('Pedidos para entrega indisponíveis.', error);
        }
      );

      // List only the deliberately redacted public projection.
      unsubscribeOffers = onSnapshot(
        collection(db, PUBLIC_OFFERS_PATH),
        snapshot => {
          if (currentGeneration !== generation) return;
          publicJobs = snapshot.docs.flatMap(document => {
            const data = document.data() as Record<string, unknown>;
            if (clean(data.source) !== 'kyrub-order' || clean(data.status) !== 'available') return [];
            const assessedCargo = assessDeliveryCargo(data.cargo);
            return [{
              id: clean(data.id) || document.id,
              from: clean(data.from),
              to: PUBLIC_DESTINATION,
              distance: finite(data.distance),
              payment: finite(data.payment),
              status: 'available' as const,
              requestedBy: clean(data.requestedBy),
              source: 'kyrub-order' as const,
              orderStatus: clean(data.orderStatus),
              cargo: assessedCargo.cargo,
              cargoReady: data.cargoReady === true && assessedCargo.ready,
              allowedVehicles: assessedCargo.allowedVehicles,
            } satisfies OperationalDeliveryJob];
          });
          refreshCache();
        },
        error => {
          if (currentGeneration !== generation) return;
          console.warn('Mural público de ofertas indisponível.', error);
          publicJobs = [];
          refreshCache();
        }
      );

      // Query authorization by UID; exact customer address never enters shared localStorage.
      unsubscribeAssigned = onSnapshot(
        query(collection(db, PRIVATE_DELIVERIES_PATH), where('acceptedBy', '==', user.uid)),
        snapshot => {
          if (currentGeneration !== generation) return;
          assignedJobs = snapshot.docs.flatMap(document => {
            const data = document.data() as Record<string, unknown>;
            const status = clean(data.status);
            if (clean(data.source) !== 'kyrub-order' ||
                !['accepted', 'delivering', 'done'].includes(status)) return [];
            return [{
              id: clean(data.id) || document.id,
              from: clean(data.from),
              to: PRIVATE_DESTINATION,
              distance: finite(data.distance),
              payment: finite(data.payment),
              status: status as DeliveryJob['status'],
              requestedBy: clean(data.requestedBy),
              acceptedBy: user.uid,
              acceptedByName: clean(data.acceptedByName) || undefined,
              source: 'kyrub-order' as const,
              orderStatus: clean(data.orderStatus),
              cargo: assessDeliveryCargo(data.cargo).cargo,
              cargoReady: data.cargoReady === true,
              allowedVehicles: assessDeliveryCargo(data.cargo).allowedVehicles,
              vehicleType: isCourierVehicleType(data.vehicleType) ? data.vehicleType : undefined,
            } satisfies OperationalDeliveryJob];
          });
          refreshCache();
        },
        error => {
          if (currentGeneration !== generation) return;
          console.warn('Entregas atribuídas indisponíveis.', error);
          assignedJobs = [];
          refreshCache();
        }
      );
    });

    return () => {
      ++generation;
      unsubscribeAuth();
      unsubscribeOrders();
      unsubscribeOffers();
      unsubscribeAssigned();
    };
  }, [onOpportunitiesChanged]);

  return null;
}
