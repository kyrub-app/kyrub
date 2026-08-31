import { useEffect, useRef, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import type { User } from 'firebase/auth';
import { collection, onSnapshot } from 'firebase/firestore';
import { MapPin } from 'lucide-react';
import type { DeliveryJob } from '../../types';
import { auth, db } from '../../utils/firebase';
import {
  updateKyrubDeliveryOpportunityStatus,
  type KyrubDeliveryOperationalStatus,
} from '../../utils/deliveryOpportunities';

const DELIVERY_STORAGE_KEY = 'kyrub_deliveries';
const DELIVERY_COLLECTION_PATH = 'hub/renda/deliveries';
const SYNC_INTERVAL_MS = 1_000;
const RETRY_DELAY_MS = 10_000;
const CLOUD_STATUSES = new Set<KyrubDeliveryOperationalStatus>([
  'accepted',
]);

interface ActiveCourierDelivery {
  id: string;
  customerHandoffStatus: string;
}

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

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

const notifyCustomerArrival = async (deliveryId: string): Promise<void> => {
  const user = auth.currentUser;
  if (!user) throw new Error('Faça login novamente.');
  const token = await user.getIdToken();
  const response = await fetch(
    `/api/delivery-opportunities/${encodeURIComponent(deliveryId)}/customer-arrival`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    }
  );
  if (response.ok) return;
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  throw new Error(
    typeof payload.error === 'string'
      ? payload.error
      : 'Não foi possível informar sua chegada ao cliente.'
  );
};

export function KyrubDeliveryStatusSyncBridge() {
  const synchronized = useRef(new Map<string, DeliveryJob['status']>());
  const inFlight = useRef(new Set<string>());
  const retryAt = useRef(new Map<string, number>());
  const [activeDelivery, setActiveDelivery] = useState<ActiveCourierDelivery | null>(null);
  const [arrivalBusy, setArrivalBusy] = useState(false);
  const [arrivalError, setArrivalError] = useState('');

  useEffect(() => {
    let interval = 0;
    let unsubscribeDeliveries = () => undefined;

    const unsubscribeAuth = onAuthStateChanged(auth, user => {
      window.clearInterval(interval);
      unsubscribeDeliveries();
      unsubscribeDeliveries = () => undefined;
      synchronized.current.clear();
      inFlight.current.clear();
      retryAt.current.clear();
      setActiveDelivery(null);
      setArrivalError('');
      if (!user) return;

      unsubscribeDeliveries = onSnapshot(
        collection(db, DELIVERY_COLLECTION_PATH),
        snapshot => {
          const matching = snapshot.docs.flatMap(document => {
            const data = document.data() as Record<string, unknown>;
            if (clean(data.acceptedBy) !== user.uid || clean(data.status) !== 'delivering') {
              return [];
            }
            const handoff =
              data.customerHandoff && typeof data.customerHandoff === 'object'
                ? data.customerHandoff as Record<string, unknown>
                : {};
            return [{
              id: clean(data.id) || document.id,
              customerHandoffStatus: clean(handoff.status),
            } satisfies ActiveCourierDelivery];
          });
          setActiveDelivery(matching[0] ?? null);
        },
        error => {
          console.warn('Entrega ativa indisponível para confirmação de chegada.', error);
          setActiveDelivery(null);
        }
      );

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
      unsubscribeDeliveries();
      window.clearInterval(interval);
    };
  }, []);

  const awaitingBuyer =
    activeDelivery?.customerHandoffStatus === 'awaiting_buyer_confirmation';

  if (!activeDelivery) return null;

  return (
    <aside className="fixed bottom-20 left-3 z-[188] w-[min(90vw,320px)] rounded-2xl border border-cyan-500/25 bg-slate-950/95 p-3 text-white shadow-xl backdrop-blur-xl sm:bottom-5 sm:left-5">
      <p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-wide text-cyan-200">
        <MapPin className="h-4 w-4" />
        {awaitingBuyer ? 'Aguardando o cliente' : 'Chegada ao cliente'}
      </p>
      <p className="mt-1 text-[9px] leading-relaxed text-slate-400">
        {awaitingBuyer
          ? 'Sua chegada foi registrada. O cliente precisa confirmar que recebeu o pedido.'
          : 'Ao chegar ao destino, confirme sua chegada. Isso não conclui a entrega nem libera pagamento sozinho.'}
      </p>
      {arrivalError && (
        <p className="mt-2 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-[9px] text-red-300">
          {arrivalError}
        </p>
      )}
      {!awaitingBuyer && (
        <button
          type="button"
          disabled={arrivalBusy}
          onClick={() => {
            setArrivalBusy(true);
            setArrivalError('');
            void notifyCustomerArrival(activeDelivery.id)
              .catch(error => {
                setArrivalError(
                  error instanceof Error
                    ? error.message
                    : 'Não foi possível informar sua chegada ao cliente.'
                );
              })
              .finally(() => setArrivalBusy(false));
          }}
          className="mt-3 w-full rounded-xl bg-cyan-500 py-2.5 text-[9px] font-black uppercase text-slate-950 disabled:opacity-50"
        >
          {arrivalBusy ? 'Registrando chegada…' : 'Cheguei ao cliente'}
        </button>
      )}
    </aside>
  );
}
