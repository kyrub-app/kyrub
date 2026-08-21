import { useEffect, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { Truck } from 'lucide-react';
import { auth, db } from '../../utils/firebase';
import { AuthorizedDeliveryTrackingViewer } from './AuthorizedDeliveryTrackingViewer';

const DELIVERY_COLLECTION_PATH = 'hub/renda/deliveries';

interface StoreDeliveryTrackingBridgeProps {
  storeId: string;
}

interface StoreDelivery {
  id: string;
  from: string;
  to: string;
}

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

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
