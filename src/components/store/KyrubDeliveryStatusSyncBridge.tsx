import { useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, onSnapshot } from 'firebase/firestore';
import { MapPin } from 'lucide-react';
import { auth, db } from '../../utils/firebase';

const DELIVERY_COLLECTION_PATH = 'hub/renda/deliveries';

interface ActiveCourierDelivery {
  id: string;
  customerHandoffStatus: string;
}

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

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
  const [activeDelivery, setActiveDelivery] = useState<ActiveCourierDelivery | null>(null);
  const [arrivalBusy, setArrivalBusy] = useState(false);
  const [arrivalError, setArrivalError] = useState('');

  useEffect(() => {
    let unsubscribeDeliveries = () => undefined;

    const unsubscribeAuth = onAuthStateChanged(auth, user => {
      unsubscribeDeliveries();
      unsubscribeDeliveries = () => undefined;
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

      // Cached opportunities are read models, never commands to accept deliveries.
    });

    return () => {
      unsubscribeAuth();
      unsubscribeDeliveries();
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
