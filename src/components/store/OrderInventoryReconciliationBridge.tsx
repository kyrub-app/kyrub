import { useEffect, useRef } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, db } from '../../utils/firebase';

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const inventoryFingerprint = (value: Record<string, unknown>): string => {
  const items = Array.isArray(value.items)
    ? value.items.map(candidate => {
        const item = candidate && typeof candidate === 'object'
          ? candidate as Record<string, unknown>
          : {};
        return {
          productId: clean(item.productId),
          quantity: item.quantity,
          transferredQuantity: item.transferredQuantity,
        };
      })
    : [];
  return JSON.stringify({
    status: clean(value.status),
    items,
    updatedAt: clean(value.updatedAt),
  });
};

const reconcileOrder = async (orderId: string): Promise<void> => {
  const user = auth.currentUser;
  if (!user) return;
  const token = await user.getIdToken();
  const response = await fetch(
    `/api/orders/${encodeURIComponent(orderId)}/reconcile-inventory`,
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
      : 'Não foi possível conciliar a alteração do pedido com o estoque.'
  );
};

export function OrderInventoryReconciliationBridge() {
  const fingerprints = useRef(new Map<string, string>());
  const inFlight = useRef(new Set<string>());

  useEffect(() => {
    let unsubscribeOrders = () => undefined;

    const unsubscribeAuth = onAuthStateChanged(auth, user => {
      unsubscribeOrders();
      unsubscribeOrders = () => undefined;
      fingerprints.current.clear();
      inFlight.current.clear();
      if (!user) return;

      unsubscribeOrders = onSnapshot(
        collection(db, `artifacts/${user.uid}/public/data/customerOrders`),
        { includeMetadataChanges: true },
        snapshot => {
          for (const change of snapshot.docChanges({ includeMetadataChanges: true })) {
            const data = change.doc.data() as Record<string, unknown>;
            const fingerprint = inventoryFingerprint(data);
            const previous = fingerprints.current.get(change.doc.id);
            fingerprints.current.set(change.doc.id, fingerprint);

            if (
              !change.doc.metadata.hasPendingWrites ||
              (change.type !== 'added' && change.type !== 'modified') ||
              fingerprint === previous ||
              inFlight.current.has(change.doc.id)
            ) {
              continue;
            }

            inFlight.current.add(change.doc.id);
            void reconcileOrder(change.doc.id)
              .catch(error => {
                console.warn(
                  `O pedido ${change.doc.id} foi salvo, mas a conciliação de estoque requer atenção.`,
                  error
                );
              })
              .finally(() => {
                inFlight.current.delete(change.doc.id);
              });
          }
        },
        error => {
          console.warn('A conciliação automática de pedidos está indisponível.', error);
        }
      );
    });

    return () => {
      unsubscribeAuth();
      unsubscribeOrders();
    };
  }, []);

  return null;
}
