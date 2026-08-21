import { useEffect, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { Truck } from 'lucide-react';
import { auth, db } from '../../utils/firebase';
import { AuthorizedDeliveryTrackingViewer } from './AuthorizedDeliveryTrackingViewer';

const DELIVERY_COLLECTION_PATH = 'hub/renda/deliveries';

interface BuyerDeliveryTrackingBridgeProps {
  storeId: string;
  buyerId: string;
}

interface BuyerDelivery {
  id: string;
  from: string;
  to: string;
}

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

export function BuyerDeliveryTrackingBridge({
  storeId,
  buyerId,
}: BuyerDeliveryTrackingBridgeProps) {
  const [deliveries, setDeliveries] = useState<BuyerDelivery[]>([]);

  useEffect(() => {
    const user = auth.currentUser;
    if (!user || user.uid !== buyerId.trim() || !storeId.trim()) {
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
              clean(data.buyerId) !== buyerId ||
              !['accepted', 'delivering'].includes(status)
            ) {
              return [];
            }
            return [{
              id: clean(data.id) || document.id,
              from: clean(data.from),
              to: clean(data.to),
            } satisfies BuyerDelivery];
          })
        );
      },
      error => {
        console.warn('Entrega em andamento indisponível para o comprador.', error);
        setDeliveries([]);
      }
    );
  }, [buyerId, storeId]);

  if (deliveries.length === 0) return null;

  return (
    <section className="mx-auto mb-4 w-full max-w-5xl px-3 pt-4 sm:px-5">
      <div className="space-y-3 rounded-3xl border border-cyan-500/25 bg-slate-900/95 p-4 shadow-xl">
        <div>
          <span className="font-mono text-[8px] font-black uppercase tracking-[0.18em] text-cyan-300">
            Acompanhe sua entrega
          </span>
          <h2 className="mt-1 flex items-center gap-2 text-sm font-black text-white">
            <Truck className="h-4 w-4 text-orange-400" />
            Entregador Kyrub a caminho
          </h2>
        </div>
        {deliveries.map(delivery => (
          <AuthorizedDeliveryTrackingViewer
            key={delivery.id}
            deliveryId={delivery.id}
            origin={delivery.from}
            destination={delivery.to}
          />
        ))}
      </div>
    </section>
  );
}
