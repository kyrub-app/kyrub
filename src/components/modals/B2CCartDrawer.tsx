import { useEffect, useRef, useState } from 'react';
import type React from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { CheckCircle2, Clock3, LoaderCircle, WalletCards } from 'lucide-react';
import { B2CCartDrawer as ApprovalBaseB2CCartDrawer } from './B2CCartDrawerApprovalBase';
import { auth } from '../../utils/firebase';
import {
  loadLastCustomerOrderId,
  resolveCanonicalCustomerOrderStoreId,
  subscribeToCustomerOrder,
  type CustomerOrder,
} from '../../utils/customerOrders';
import { resumeMarketplaceApprovedPayment } from '../../utils/marketplaceApprovedPayment';
import { syncCanonicalOrderToStoreCrm } from '../../utils/storeCrm';

type B2CCartDrawerProps = React.ComponentProps<typeof ApprovalBaseB2CCartDrawer>;

export const B2CCartDrawer: React.FC<B2CCartDrawerProps> = props => {
  const { isOpen, visitingStore, cart, updateCartQty } = props;
  const [user, setUser] = useState<User | null>(() => auth.currentUser);
  const [trackedOrderId, setTrackedOrderId] = useState('');
  const [trackedOrder, setTrackedOrder] = useState<CustomerOrder | null>(null);
  const [submittedThisOpen, setSubmittedThisOpen] = useState(false);
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [paymentError, setPaymentError] = useState('');
  const initialOrderIdRef = useRef('');
  const crmSyncAttemptedOrderIdRef = useRef('');

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  useEffect(() => {
    if (!isOpen || !visitingStore || !user || typeof localStorage === 'undefined') {
      setTrackedOrderId('');
      setTrackedOrder(null);
      setSubmittedThisOpen(false);
      initialOrderIdRef.current = '';
      crmSyncAttemptedOrderIdRef.current = '';
      return;
    }

    const readOrderId = (): string =>
      loadLastCustomerOrderId(localStorage, user.uid, visitingStore.id);
    const initialOrderId = readOrderId();
    initialOrderIdRef.current = initialOrderId;
    setTrackedOrderId(initialOrderId);
    setSubmittedThisOpen(false);

    const timer = window.setInterval(() => {
      const nextOrderId = readOrderId();
      if (!nextOrderId || nextOrderId === initialOrderIdRef.current) return;
      setTrackedOrderId(current => {
        if (current === nextOrderId) return current;
        setSubmittedThisOpen(true);
        setPaymentError('');
        return nextOrderId;
      });
    }, 200);

    return () => window.clearInterval(timer);
  }, [isOpen, visitingStore?.id, user?.uid]);

  useEffect(() => {
    if (!isOpen || !visitingStore || !trackedOrderId) {
      setTrackedOrder(null);
      return;
    }
    return subscribeToCustomerOrder(
      visitingStore.id,
      trackedOrderId,
      setTrackedOrder,
      error => console.warn('Acompanhamento do pedido para liberação do Pix indisponível.', error)
    );
  }, [isOpen, visitingStore?.id, trackedOrderId]);

  useEffect(() => {
    if (!user || !visitingStore || !trackedOrder || trackedOrder.buyerId !== user.uid) return;
    if (crmSyncAttemptedOrderIdRef.current === trackedOrder.id) return;
    crmSyncAttemptedOrderIdRef.current = trackedOrder.id;

    void (async () => {
      try {
        const canonicalStoreId = await resolveCanonicalCustomerOrderStoreId(visitingStore.id);
        await syncCanonicalOrderToStoreCrm(
          user,
          canonicalStoreId || visitingStore.id,
          trackedOrder.id
        );
      } catch (error) {
        console.warn(
          '[customer-order-crm] Pedido persistido; sincronização imediata do CRM ficará para a reconciliação.',
          error
        );
      }
    })();
  }, [user?.uid, visitingStore?.id, trackedOrder?.id]);

  useEffect(() => {
    if (!submittedThisOpen || !trackedOrder || cart.length === 0) return;
    for (const item of cart) updateCartQty(item.product.id, 0);
  }, [submittedThisOpen, trackedOrder?.id]);

  useEffect(() => {
    if (trackedOrder?.paymentStatus === 'paid') setPaymentError('');
  }, [trackedOrder?.paymentStatus]);

  const startApprovedPayment = async (): Promise<void> => {
    if (!user || !visitingStore || !trackedOrder || paymentBusy) return;
    setPaymentBusy(true);
    setPaymentError('');
    try {
      await resumeMarketplaceApprovedPayment(user, {
        storeId: visitingStore.id,
        orderId: trackedOrder.id,
      });
    } catch (error) {
      setPaymentError(
        error instanceof Error ? error.message : 'Não foi possível abrir o Pix deste pedido.'
      );
    } finally {
      setPaymentBusy(false);
    }
  };

  const approvalGatedOrder =
    trackedOrder &&
    trackedOrder.source === 'customer' &&
    trackedOrder.sourceChannel === 'kyrub' &&
    (trackedOrder.fulfillmentType === 'delivery' || trackedOrder.fulfillmentType === 'pickup')
      ? trackedOrder
      : null;

  const remountKey = visitingStore
    ? `${visitingStore.id}:${submittedThisOpen ? trackedOrderId || 'submitting' : 'stable'}:${
        submittedThisOpen ? (cart.length === 0 ? 'empty' : 'clearing') : 'cart-state'
      }`
    : 'no-store';

  return (
    <>
      <ApprovalBaseB2CCartDrawer key={remountKey} {...props} />

      {isOpen && approvalGatedOrder?.paymentStatus !== 'paid' && approvalGatedOrder?.status === 'pending' && (
        <aside
          className="fixed bottom-4 right-4 z-[80] w-[calc(100%-2rem)] max-w-sm rounded-3xl border border-amber-500/30 bg-slate-950/95 p-4 shadow-2xl backdrop-blur-md"
          role="status"
          id="marketplace-order-awaiting-merchant-approval"
        >
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-300">
              <Clock3 className="h-5 w-5" />
            </span>
            <div>
              <strong className="block text-sm font-black text-white">Pedido enviado à loja</strong>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
                Aguardando a loja confirmar que consegue atender. Nenhuma cobrança Pix foi criada ainda.
              </p>
            </div>
          </div>
        </aside>
      )}

      {isOpen && approvalGatedOrder?.paymentStatus !== 'paid' && approvalGatedOrder?.status === 'accepted' && (
        <aside
          className="fixed bottom-4 right-4 z-[80] w-[calc(100%-2rem)] max-w-sm rounded-3xl border border-emerald-500/30 bg-slate-950/95 p-4 shadow-2xl backdrop-blur-md"
          role="status"
          id="marketplace-order-approved-payment"
        >
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-300">
              <CheckCircle2 className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <strong className="block text-sm font-black text-white">Pedido aceito</strong>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
                A loja confirmou o atendimento. Agora o pagamento pode ser feito com segurança.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void startApprovedPayment()}
            disabled={paymentBusy}
            className="mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-cyan-400 px-4 text-xs font-black uppercase text-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {paymentBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <WalletCards className="h-4 w-4" />}
            {paymentBusy ? 'Gerando Pix...' : 'Pagar agora por Pix'}
          </button>
          {paymentError && (
            <p className="mt-2 rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-[10px] leading-relaxed text-red-300">
              {paymentError}
            </p>
          )}
        </aside>
      )}
    </>
  );
};
