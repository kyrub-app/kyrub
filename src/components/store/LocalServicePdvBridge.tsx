import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { Utensils } from 'lucide-react';
import { buildLocalServiceSummary } from '../../../shared/localService';
import { auth } from '../../utils/firebase';
import {
  subscribeToStoreCustomerOrders,
  type CustomerOrder,
} from '../../utils/customerOrders';
import { InPersonOrderComposer } from './InPersonOrderComposer';
import { InPersonCustomerLinker } from './InPersonCustomerLinker';

export function LocalServicePdvBridge() {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [orders, setOrders] = useState<CustomerOrder[]>([]);
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  useEffect(() => {
    setOrders([]);
    if (!user) return;
    return subscribeToStoreCustomerOrders(
      user.uid,
      setOrders,
      error => {
        console.warn('Atendimento Local indisponível.', error);
        setOrders([]);
      }
    );
  }, [user]);

  const summary = useMemo(
    () => buildLocalServiceSummary(orders),
    [orders]
  );

  useEffect(() => {
    let disposed = false;
    let currentHost: HTMLDivElement | null = null;

    const install = (): void => {
      if (disposed) return;
      const clients = document.getElementById('erp-clientes-tab');
      if (!(clients instanceof HTMLElement)) {
        currentHost?.remove();
        currentHost = null;
        setHost(null);
        return;
      }
      if (currentHost?.isConnected) return;

      const existing = document.getElementById('kyrub-local-service-header-host');
      if (existing instanceof HTMLDivElement) {
        currentHost = existing;
        setHost(existing);
        return;
      }

      currentHost = document.createElement('div');
      currentHost.id = 'kyrub-local-service-header-host';
      currentHost.className = 'mb-4 min-w-0';
      clients.prepend(currentHost);
      setHost(currentHost);
    };

    install();
    const observer = new MutationObserver(install);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      disposed = true;
      observer.disconnect();
      currentHost?.remove();
      setHost(null);
    };
  }, []);

  if (!user || !host) return null;

  return createPortal(
    <section
      id="kyrub-local-service-overview"
      className="rounded-3xl border border-orange-500/20 bg-slate-950/75 p-4 shadow-xl sm:p-5"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <span className="font-mono text-[9px] font-black uppercase tracking-[0.18em] text-orange-300">
            PDV · Atendimento Local
          </span>
          <h2 className="mt-1 flex items-center gap-2 text-base font-black text-white">
            <Utensils className="h-5 w-5 text-orange-400" />
            Salão, balcão e retirada
          </h2>
          <p className="mt-1 max-w-2xl text-[10px] leading-relaxed text-slate-500">
            Esta visão usa os mesmos pedidos canônicos de atendimento presencial e retirada. Entregas não participam deste painel.
          </p>
        </div>
        <span className="w-fit rounded-full border border-orange-500/20 bg-orange-500/10 px-3 py-1 font-mono text-[9px] font-black text-orange-200">
          {summary.activeOrders} pedido{summary.activeOrders === 1 ? '' : 's'} local{summary.activeOrders === 1 ? '' : 'is'}
        </span>
      </div>

      <InPersonOrderComposer storeId={user.uid} />
      <InPersonCustomerLinker storeId={user.uid} orders={orders} />
    </section>,
    host
  );
}
