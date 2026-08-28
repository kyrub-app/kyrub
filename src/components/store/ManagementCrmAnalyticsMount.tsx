import { useEffect, useRef, useState } from 'react';
import { CrmLoyaltyBalanceBridge } from './CrmLoyaltyBalanceBridge';
import { LoyaltyPromotionCenterBridge } from './LoyaltyPromotionCenterBridge';
import { ManagementCrmAnalyticsBridge } from './ManagementCrmAnalyticsBridge';
import { auth } from '../../utils/firebase';
import {
  subscribeToStoreCustomerOrders,
  type CustomerOrder,
} from '../../utils/customerOrders';
import {
  subscribeToProductLoyalty,
  type ProductLoyaltyMap,
} from '../../utils/productLoyalty';
import { reconcileOrderLoyalty } from '../../utils/loyaltyLedger';

export function ManagementCrmAnalyticsMount() {
  const [orders, setOrders] = useState<CustomerOrder[]>([]);
  const loyaltyRef = useRef<ProductLoyaltyMap>({});
  const loyaltyReadyRef = useRef(false);
  const ordersRef = useRef<CustomerOrder[]>([]);
  const reconciliationRef = useRef(new Set<string>());

  useEffect(() => {
    let unsubscribeOrders: (() => void) | null = null;
    let unsubscribeLoyalty: (() => void) | null = null;
    let lastUid = '';
    let timer = 0;

    const reconcileOrders = (uid: string): void => {
      const user = auth.currentUser;
      if (!user || user.uid !== uid || !loyaltyReadyRef.current) return;

      ordersRef.current.forEach(order => {
        const signature = `${order.id}:${order.status}:${order.paymentStatus}:${order.updatedAt}`;
        if (reconciliationRef.current.has(signature)) return;
        reconciliationRef.current.add(signature);
        void reconcileOrderLoyalty(user, order, loyaltyRef.current).catch(error => {
          reconciliationRef.current.delete(signature);
          console.warn('Fidelidade: não foi possível reconciliar pontos do pedido.', error);
        });
      });
    };

    const synchronize = (): void => {
      const user = auth.currentUser;
      const uid = user?.uid ?? '';

      if (uid !== lastUid) {
        unsubscribeOrders?.();
        unsubscribeLoyalty?.();
        unsubscribeOrders = null;
        unsubscribeLoyalty = null;
        lastUid = uid;
        setOrders([]);
        ordersRef.current = [];
        loyaltyRef.current = {};
        loyaltyReadyRef.current = false;
        reconciliationRef.current.clear();

        if (uid) {
          unsubscribeLoyalty = subscribeToProductLoyalty(
            uid,
            loyalty => {
              loyaltyRef.current = loyalty;
              loyaltyReadyRef.current = true;
              reconcileOrders(uid);
            },
            error => {
              loyaltyReadyRef.current = false;
              console.warn('Fidelidade: regras de pontos indisponíveis.', error);
            }
          );

          unsubscribeOrders = subscribeToStoreCustomerOrders(
            uid,
            nextOrders => {
              ordersRef.current = nextOrders;
              setOrders(nextOrders);
              reconcileOrders(uid);
            },
            error => {
              console.warn('CRM/Analytics: pedidos da loja indisponíveis.', error);
              ordersRef.current = [];
              setOrders([]);
            }
          );
        }
      }

      timer = window.setTimeout(synchronize, 500);
    };

    synchronize();
    return () => {
      window.clearTimeout(timer);
      unsubscribeOrders?.();
      unsubscribeLoyalty?.();
    };
  }, []);

  return (
    <>
      <ManagementCrmAnalyticsBridge orders={orders} />
      <CrmLoyaltyBalanceBridge orders={orders} />
      <LoyaltyPromotionCenterBridge />
    </>
  );
}
