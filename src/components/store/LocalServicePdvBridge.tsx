import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  BellRing,
  ChefHat,
  CircleDot,
  PackageCheck,
  Utensils,
} from 'lucide-react';
import { buildLocalServiceSummary } from '../../../shared/localService';
import { auth } from '../../utils/firebase';
import {
  subscribeToStoreCustomerOrders,
  type CustomerOrder,
} from '../../utils/customerOrders';

const focusElement = (id: string): void => {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLElement)) return;
  element.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

const clickPickup = (): void => {
  const button = document.getElementById('kyrub-pdv-pickup-tab');
  if (button instanceof HTMLButtonElement) button.click();
};

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
            Esta visão usa os mesmos pedidos canônicos de mesas e retirada. Entregas não participam deste painel.
          </p>
        </div>
        <span className="w-fit rounded-full border border-orange-500/20 bg-orange-500/10 px-3 py-1 font-mono text-[9px] font-black text-orange-200">
          {summary.activeOrders} pedido{summary.activeOrders === 1 ? '' : 's'} local{summary.activeOrders === 1 ? '' : 'is'}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <button
          type="button"
          onClick={() => focusElement('kyrub-customer-table-board-host')}
          className="rounded-2xl border border-slate-800 bg-slate-900 p-3 text-left transition-colors hover:border-orange-500/30"
        >
          <Utensils className="h-4 w-4 text-orange-400" />
          <strong className="mt-2 block text-lg font-black text-white">{summary.activeTables}</strong>
          <span className="text-[8px] font-black uppercase text-slate-500">Mesas/códigos ativos</span>
        </button>

        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-3">
          <BellRing className="h-4 w-4 text-amber-400" />
          <strong className="mt-2 block text-lg font-black text-white">{summary.pendingApprovals}</strong>
          <span className="text-[8px] font-black uppercase text-slate-500">Aguardando aprovação</span>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-3">
          <ChefHat className="h-4 w-4 text-blue-400" />
          <strong className="mt-2 block text-lg font-black text-white">{summary.inProduction + summary.readyForTable}</strong>
          <span className="text-[8px] font-black uppercase text-slate-500">Em fluxo local</span>
        </div>

        <button
          type="button"
          onClick={clickPickup}
          className="rounded-2xl border border-cyan-500/20 bg-cyan-500/[0.05] p-3 text-left transition-colors hover:border-cyan-400/40"
        >
          <PackageCheck className="h-4 w-4 text-cyan-300" />
          <strong className="mt-2 block text-lg font-black text-white">{summary.waitingPickup}</strong>
          <span className="text-[8px] font-black uppercase text-slate-500">Aguardando retirada</span>
        </button>
      </div>

      {summary.waitingPickup > 0 && (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-cyan-500/20 bg-cyan-500/[0.05] px-3 py-2 text-[9px] leading-relaxed text-cyan-100/70">
          <CircleDot className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-300" />
          Pedido pronto para retirada continua aberto até o handoff seguro com o código de 6 dígitos do cliente.
        </div>
      )}
    </section>,
    host
  );
}
