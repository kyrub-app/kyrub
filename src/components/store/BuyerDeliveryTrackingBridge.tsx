import { useEffect, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { CheckCircle2, Truck } from 'lucide-react';
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
  status: string;
  customerHandoffStatus: string;
}

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const confirmDeliveryReceived = async (deliveryId: string): Promise<void> => {
  const user = auth.currentUser;
  if (!user) throw new Error('Faça login novamente.');
  const token = await user.getIdToken();
  const response = await fetch(
    `/api/delivery-opportunities/${encodeURIComponent(deliveryId)}/buyer-confirmation`,
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
      : 'Não foi possível confirmar o recebimento.'
  );
};

export function BuyerDeliveryTrackingBridge({
  storeId,
  buyerId,
}: BuyerDeliveryTrackingBridgeProps) {
  const [deliveries, setDeliveries] = useState<BuyerDelivery[]>([]);
  const [confirmingId, setConfirmingId] = useState('');
  const [confirmationError, setConfirmationError] = useState('');

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
            const handoff =
              data.customerHandoff && typeof data.customerHandoff === 'object'
                ? data.customerHandoff as Record<string, unknown>
                : {};
            return [{
              id: clean(data.id) || document.id,
              from: clean(data.from),
              to: clean(data.to),
              status,
              customerHandoffStatus: clean(handoff.status),
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
        {deliveries.map(delivery => {
          const canConfirm =
            delivery.status === 'delivering' &&
            delivery.customerHandoffStatus === 'awaiting_buyer_confirmation';
          return (
            <div key={delivery.id} className="space-y-3">
              <AuthorizedDeliveryTrackingViewer
                deliveryId={delivery.id}
                origin={delivery.from}
                destination={delivery.to}
              />
              {canConfirm && (
                <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.07] p-3">
                  <p className="flex items-center gap-2 text-[10px] font-black text-emerald-200">
                    <CheckCircle2 className="h-4 w-4" />
                    O entregador informou que chegou
                  </p>
                  <p className="mt-1 text-[9px] leading-relaxed text-emerald-100/70">
                    Confirme somente depois de receber o pedido em mãos. Esta confirmação conclui a entrega e libera a elegibilidade econômica do entregador, mas não executa pagamento nem transferência.
                  </p>
                  {confirmationError && (
                    <p className="mt-2 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-[9px] text-red-300">
                      {confirmationError}
                    </p>
                  )}
                  <button
                    type="button"
                    disabled={confirmingId === delivery.id}
                    onClick={() => {
                      setConfirmingId(delivery.id);
                      setConfirmationError('');
                      void confirmDeliveryReceived(delivery.id)
                        .catch(error => {
                          setConfirmationError(
                            error instanceof Error
                              ? error.message
                              : 'Não foi possível confirmar o recebimento.'
                          );
                        })
                        .finally(() => setConfirmingId(''));
                    }}
                    className="mt-3 w-full rounded-xl bg-emerald-500 py-3 text-[10px] font-black uppercase text-slate-950 disabled:opacity-50"
                  >
                    {confirmingId === delivery.id ? 'Confirmando…' : 'Recebi meu pedido'}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
