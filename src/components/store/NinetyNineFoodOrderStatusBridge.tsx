import { useEffect, useRef, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, db } from '../../utils/firebase';
import { sendNinetyNineFoodOrderStatus } from '../../utils/ninetyNineFoodIntegration';

const OUTBOUND_STATUSES = new Set([
  'accepted',
  'preparing',
  'ready',
  'out_for_delivery',
  'completed',
  'rejected',
  'cancelled',
]);

const cleanString = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

export function NinetyNineFoodOrderStatusBridge() {
  const previousStatuses = useRef(new Map<string, string>());
  const initialized = useRef(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let clearMessageTimer: number | null = null;
    let unsubscribeOrders = () => undefined;

    const unsubscribeAuth = onAuthStateChanged(auth, user => {
      unsubscribeOrders();
      unsubscribeOrders = () => undefined;
      previousStatuses.current.clear();
      initialized.current = false;
      if (!user) return;

      unsubscribeOrders = onSnapshot(
        collection(db, `artifacts/${user.uid}/public/data/customerOrders`),
        { includeMetadataChanges: true },
        snapshot => {
          for (const change of snapshot.docChanges({ includeMetadataChanges: true })) {
            const data = change.doc.data() as Record<string, unknown>;
            const integration = data.integration && typeof data.integration === 'object'
              ? data.integration as Record<string, unknown>
              : {};
            const provider = cleanString(integration.provider);
            const externalOrderId = cleanString(integration.externalOrderId);
            const status = cleanString(data.status);
            const previous = previousStatuses.current.get(change.doc.id);
            previousStatuses.current.set(change.doc.id, status);

            if (
              !initialized.current ||
              change.type !== 'modified' ||
              !change.doc.metadata.hasPendingWrites ||
              provider !== '99food' ||
              !externalOrderId ||
              !OUTBOUND_STATUSES.has(status) ||
              status === previous
            ) {
              continue;
            }

            void sendNinetyNineFoodOrderStatus(externalOrderId, status)
              .then(() => {
                setMessage(`Status do pedido ${externalOrderId} enviado à 99Food.`);
              })
              .catch(error => {
                setMessage(
                  `O pedido foi atualizado no Kyrub, mas a 99Food não confirmou: ${
                    error instanceof Error ? error.message : String(error)
                  }`
                );
              })
              .finally(() => {
                if (clearMessageTimer !== null) {
                  window.clearTimeout(clearMessageTimer);
                }
                clearMessageTimer = window.setTimeout(() => setMessage(''), 7000);
              });
          }
          initialized.current = true;
        },
        error => {
          console.warn('99Food status bridge is unavailable.', error);
        }
      );
    });

    return () => {
      unsubscribeAuth();
      unsubscribeOrders();
      if (clearMessageTimer !== null) window.clearTimeout(clearMessageTimer);
    };
  }, []);

  if (!message) return null;

  return (
    <div className="fixed bottom-24 left-1/2 z-[125] w-[min(92vw,34rem)] -translate-x-1/2 rounded-2xl border border-yellow-500/30 bg-slate-950 px-5 py-4 text-center shadow-2xl">
      <strong className="block text-[9px] font-black uppercase tracking-wide text-yellow-300">
        Sincronização 99Food
      </strong>
      <span className="mt-1 block text-[10px] leading-relaxed text-slate-300">
        {message}
      </span>
    </div>
  );
}
