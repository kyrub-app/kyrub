import { useEffect, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { KeyRound, Truck } from 'lucide-react';
import { auth, db } from '../../utils/firebase';
import { AuthorizedDeliveryTrackingViewer } from './AuthorizedDeliveryTrackingViewer';

const DELIVERY_COLLECTION_PATH = 'hub/renda/deliveries';

interface StoreDeliveryTrackingBridgeProps {
  storeId: string;
}

interface StoreDelivery {
  id: string;
  status: 'accepted' | 'delivering';
  from: string;
  to: string;
}

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

function StoreDeliveryPickupCode({ deliveryId }: { deliveryId: string }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let disposed = false;
    const load = async (): Promise<void> => {
      const user = auth.currentUser;
      if (!user) return;
      try {
        const token = await user.getIdToken();
        const response = await fetch(
          `/api/delivery-opportunities/${encodeURIComponent(deliveryId)}/pickup-code`,
          {
            headers: { authorization: `Bearer ${token}` },
            cache: 'no-store',
          }
        );
        const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
        if (!response.ok) {
          throw new Error(
            typeof payload.error === 'string'
              ? payload.error
              : 'Código de coleta indisponível.'
          );
        }
        if (!disposed) {
          setCode(typeof payload.code === 'string' ? payload.code : '');
          setError('');
        }
      } catch (cause) {
        if (!disposed) {
          setError(cause instanceof Error ? cause.message : 'Código de coleta indisponível.');
        }
      }
    };
    void load();
    return () => {
      disposed = true;
    };
  }, [deliveryId]);

  return (
    <div className="rounded-2xl border border-orange-500/25 bg-orange-500/[0.06] p-3">
      <span className="flex items-center gap-2 text-[8px] font-black uppercase tracking-[0.16em] text-orange-300">
        <KeyRound className="h-3.5 w-3.5" />
        Código de coleta do entregador
      </span>
      {code ? (
        <>
          <strong className="mt-2 block font-mono text-2xl tracking-[0.28em] text-white">
            {code}
          </strong>
          <p className="mt-1 text-[9px] leading-relaxed text-orange-100/70">
            Informe este código ao entregador somente após entregar fisicamente o pedido.
          </p>
        </>
      ) : (
        <p className="mt-2 text-[9px] text-slate-500">
          {error || 'Emitindo código seguro…'}
        </p>
      )}
    </div>
  );
}

export function StoreDeliveryTrackingBridge({
  storeId,
}: StoreDeliveryTrackingBridgeProps) {
  const [deliveries, setDeliveries] = useState<StoreDelivery[]>([]);

  useEffect(() => {
    const user = auth.currentUser;
    if (!user || user.uid !== storeId.trim()) {
      setDeliveries([]);
      return;
    }

    return onSnapshot(
      collection(db, DELIVERY_COLLECTION_PATH),
      snapshot => {
        setDeliveries(
          snapshot.docs.flatMap(document => {
            const data = document.data() as Record<string, unknown>;
            const status = clean(data.status);
            if (
              clean(data.storeId) !== storeId ||
              !['accepted', 'delivering'].includes(status)
            ) {
              return [];
            }
            return [{
              id: clean(data.id) || document.id,
              status: status as StoreDelivery['status'],
              from: clean(data.from),
              to: clean(data.to),
            } satisfies StoreDelivery];
          })
        );
      },
      error => {
        console.warn('Entregas em andamento indisponíveis para o lojista.', error);
        setDeliveries([]);
      }
    );
  }, [storeId]);

  if (deliveries.length === 0) return null;

  return (
    <section className="mb-4 space-y-3 rounded-3xl border border-cyan-500/20 bg-cyan-500/5 p-4">
      <div>
        <span className="font-mono text-[8px] font-black uppercase tracking-[0.18em] text-cyan-300">
          Kyrub Entregas
        </span>
        <h3 className="mt-1 flex items-center gap-2 text-sm font-black text-white">
          <Truck className="h-4 w-4 text-orange-400" />
          Entregas em deslocamento
        </h3>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {deliveries.map(delivery => (
          <article key={delivery.id} className="space-y-3 rounded-2xl border border-slate-800 bg-slate-950 p-3">
            <div className="text-[9px] leading-relaxed text-slate-400">
              <p className="truncate"><strong className="text-slate-500">Coleta:</strong> {delivery.from}</p>
              <p className="truncate"><strong className="text-slate-500">Destino:</strong> {delivery.to}</p>
            </div>
            {delivery.status === 'accepted' && (
              <StoreDeliveryPickupCode deliveryId={delivery.id} />
            )}
            <AuthorizedDeliveryTrackingViewer
              deliveryId={delivery.id}
              origin={delivery.from}
              destination={delivery.to}
              compact
            />
          </article>
        ))}
      </div>
    </section>
  );
}
