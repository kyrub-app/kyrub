import { useEffect, useState } from 'react';
import { LoyaltyPromotionCenterBridge } from './LoyaltyPromotionCenterBridge';
import { ManagementCrmAnalyticsBridge } from './ManagementCrmAnalyticsBridge';
import { auth } from '../../utils/firebase';
import {
  subscribeToStoreCustomerOrders,
  type CustomerOrder,
} from '../../utils/customerOrders';

export function ManagementCrmAnalyticsMount() {
  const [orders, setOrders] = useState<CustomerOrder[]>([]);

  useEffect(() => {
    let unsubscribeOrders: (() => void) | null = null;
    let lastUid = '';
    let timer = 0;

    const synchronize = (): void => {
      const user = auth.currentUser;
      const uid = user?.uid ?? '';

      if (uid !== lastUid) {
        unsubscribeOrders?.();
        unsubscribeOrders = null;
        lastUid = uid;
        setOrders([]);

        if (uid) {
          unsubscribeOrders = subscribeToStoreCustomerOrders(
            uid,
            nextOrders => setOrders(nextOrders),
            error => {
              console.warn('CRM/Analytics: pedidos da loja indisponíveis.', error);
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
    };
  }, []);

  return (
    <>
      <ManagementCrmAnalyticsBridge orders={orders} />
      <LoyaltyPromotionCenterBridge />
    </>
  );
}
