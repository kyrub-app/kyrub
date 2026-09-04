import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { auth } from '../../utils/firebase';
import {
  cancelCanonicalOrderNavigation,
  KYRUB_CANONICAL_ORDER_NAVIGATION_CHANGED_EVENT,
  readCanonicalOrderNavigation,
} from '../../utils/canonicalOrderNavigation';

interface CanonicalOrderLocationControlProps {
  storeId: string;
}

const clean = (value: string): string => value.trim().slice(0, 240);

export function CanonicalOrderLocationControl({
  storeId,
}: CanonicalOrderLocationControlProps) {
  const [orderId, setOrderId] = useState('');

  useEffect(() => {
    const refresh = (): void => {
      const normalizedStoreId = clean(storeId);
      const user = auth.currentUser;
      if (!normalizedStoreId || !user || user.uid !== normalizedStoreId) {
        setOrderId('');
        return;
      }
      setOrderId(readCanonicalOrderNavigation(normalizedStoreId)?.orderId ?? '');
    };

    refresh();
    window.addEventListener(KYRUB_CANONICAL_ORDER_NAVIGATION_CHANGED_EVENT, refresh);
    return () => {
      window.removeEventListener(
        KYRUB_CANONICAL_ORDER_NAVIGATION_CHANGED_EVENT,
        refresh
      );
    };
  }, [storeId]);

  if (!orderId) return null;

  const cancelLocation = (): void => {
    const normalizedStoreId = clean(storeId);
    const targetOrderId = clean(orderId);
    if (!normalizedStoreId || !targetOrderId) return;

    if (!cancelCanonicalOrderNavigation(normalizedStoreId, targetOrderId)) {
      setOrderId(
        readCanonicalOrderNavigation(normalizedStoreId)?.orderId ?? ''
      );
      return;
    }

    setOrderId('');
  };

  return (
    <div
      id="kyrub-canonical-order-location-control"
      className="mb-3 flex flex-col gap-2 rounded-2xl border border-slate-700 bg-slate-950/80 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
      role="status"
    >
      <span className="min-w-0 text-[9px] leading-relaxed text-slate-400">
        Localização ativa do pedido{' '}
        <strong className="break-all font-mono text-slate-200">{orderId}</strong>.
        Cancelar remove somente este destino da interface; o pedido continua inalterado.
      </span>
      <button
        id="kyrub-cancel-canonical-order-location"
        type="button"
        onClick={cancelLocation}
        className="inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900 px-3 text-[9px] font-black uppercase text-slate-300 hover:border-slate-500 hover:text-white"
      >
        <X className="h-3.5 w-3.5" />
        Cancelar localização
      </button>
    </div>
  );
}
