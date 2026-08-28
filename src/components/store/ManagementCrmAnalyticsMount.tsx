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
import {
  reconcileOrderLoyalty,
  subscribeToStoreLoyaltyLedger,
  type LoyaltyLedgerEvent,
} from '../../utils/loyaltyLedger';
import {
  subscribeToLoyaltyChallenges,
  type LoyaltyChallenge,
} from '../../utils/loyaltyChallenges';
import { reconcileActiveLoyaltyChallenges } from '../../utils/loyaltyChallengeEngine';

export function ManagementCrmAnalyticsMount() {
  const [orders, setOrders] = useState<CustomerOrder[]>([]);
  const loyaltyRef = useRef<ProductLoyaltyMap>({});
  const loyaltyReadyRef = useRef(false);
  const ordersRef = useRef<CustomerOrder[]>([]);
  const challengesRef = useRef<LoyaltyChallenge[]>([]);
  const ledgerRef = useRef<LoyaltyLedgerEvent[]>([]);
  const challengesReadyRef = useRef(false);
  const ledgerReadyRef = useRef(false);
  const challengeReconcilingRef = useRef(false);
  const challengeReconcileQueuedRef = useRef(false);
  const reconciliationRef = useRef(new Set<string>());

  useEffect(() => {
    let unsubscribeOrders: (() => void) | null = null;
    let unsubscribeLoyalty: (() => void) | null = null;
    let unsubscribeChallenges: (() => void) | null = null;
    let unsubscribeLedger: (() => void) | null = null;
    let lastUid = '';
    let timer = 0;

    const reconcileChallenges = (uid: string): void => {
      const user = auth.currentUser;
      if (
        !user ||
        user.uid !== uid ||
        !challengesReadyRef.current ||
        !ledgerReadyRef.current
      ) return;

      if (challengeReconcilingRef.current) {
        challengeReconcileQueuedRef.current = true;
        return;
      }

      challengeReconcilingRef.current = true;
      challengeReconcileQueuedRef.current = false;
      void reconcileActiveLoyaltyChallenges(
        user,
        challengesRef.current,
        ordersRef.current,
        ledgerRef.current
      )
        .catch(error => {
          console.warn('Fidelidade: não foi possível reconciliar desafios.', error);
        })
        .finally(() => {
          challengeReconcilingRef.current = false;
          if (challengeReconcileQueuedRef.current) reconcileChallenges(uid);
        });
    };

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
      reconcileChallenges(uid);
    };

    const synchronize = (): void => {
      const user = auth.currentUser;
      const uid = user?.uid ?? '';

      if (uid !== lastUid) {
        unsubscribeOrders?.();
        unsubscribeLoyalty?.();
        unsubscribeChallenges?.();
        unsubscribeLedger?.();
        unsubscribeOrders = null;
        unsubscribeLoyalty = null;
        unsubscribeChallenges = null;
        unsubscribeLedger = null;
        lastUid = uid;
        setOrders([]);
        ordersRef.current = [];
        loyaltyRef.current = {};
        challengesRef.current = [];
        ledgerRef.current = [];
        loyaltyReadyRef.current = false;
        challengesReadyRef.current = false;
        ledgerReadyRef.current = false;
        challengeReconcilingRef.current = false;
        challengeReconcileQueuedRef.current = false;
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

          unsubscribeChallenges = subscribeToLoyaltyChallenges(
            uid,
            challenges => {
              challengesRef.current = challenges;
              challengesReadyRef.current = true;
              reconcileChallenges(uid);
            },
            error => {
              challengesReadyRef.current = false;
              console.warn('Fidelidade: desafios indisponíveis.', error);
            }
          );

          unsubscribeLedger = subscribeToStoreLoyaltyLedger(
            uid,
            ledger => {
              ledgerRef.current = ledger;
              ledgerReadyRef.current = true;
              reconcileChallenges(uid);
            },
            error => {
              ledgerReadyRef.current = false;
              console.warn('Fidelidade: ledger indisponível.', error);
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
      unsubscribeChallenges?.();
      unsubscribeLedger?.();
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
