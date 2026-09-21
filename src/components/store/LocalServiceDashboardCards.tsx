import { useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  BellRing,
  ChefHat,
  CircleDot,
  MapPin,
  PackageCheck,
} from 'lucide-react';
import { buildLocalServiceSummary } from '../../../shared/localService';
import { auth } from '../../utils/firebase';
import {
  subscribeToStoreCustomerOrders,
  type CustomerOrder,
} from '../../utils/customerOrders';

export function LocalServiceDashboardCards() {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [orders, setOrders] = useState<CustomerOrder[]>([]);

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  useEffect(() => {
    setOrders([]);
    if (!user) return;

    return subscribeToStoreCustomerOrders(
      user.uid,
      setOrders,
      error => {
        console.warn('Resumo do atendimento local indisponível.', error);
        setOrders([]);
      }
    );
  }, [user]);

  const summary = useMemo(
    () => buildLocalServiceSummary(orders),
    [orders]
  );

  if (!user) return null;

  return (
    <section
      id="kyrub-renda-local-service-dashboard"
      className="space-y-3 border-t border-slate-800 pt-4"
      aria-label="Resumo operacional da loja"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <span className="font-mono text-[8px] font-black uppercase tracking-[0.16em] text-orange-300">
            Resumo operacional
          </span>
          <p className="mt-0.5 text-[9px] leading-relaxed text-slate-500">
            Atendimento presencial e retirada da sua loja.
          </p>
        </div>
        <span className="shrink-0 rounded-full border border-orange-500/20 bg-orange-500/10 px-2.5 py-1 font-mono text-[8px] font-black text-orange-200">
          {summary.activeOrders} ativo{summary.activeOrders === 1 ? '' : 's'}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-2xl border border-slate-800 bg-slate-950 p-3">
          <MapPin className="h-4 w-4 text-orange-400" />
          <strong className="mt-2 block text-lg font-black text-white">
            {summary.activeServiceLocations}
          </strong>
          <span className="text-[8px] font-black uppercase text-slate-500">
            Locais ativos
          </span>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-950 p-3">
          <BellRing className="h-4 w-4 text-amber-400" />
          <strong className="mt-2 block text-lg font-black text-white">
            {summary.pendingApprovals}
          </strong>
          <span className="text-[8px] font-black uppercase text-slate-500">
            Aguardando aprovação
          </span>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-950 p-3">
          <ChefHat className="h-4 w-4 text-blue-400" />
          <strong className="mt-2 block text-lg font-black text-white">
            {summary.inProduction + summary.readyForServiceLocation}
          </strong>
          <span className="text-[8px] font-black uppercase text-slate-500">
            Em fluxo local
          </span>
        </div>

        <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/[0.05] p-3">
          <PackageCheck className="h-4 w-4 text-cyan-300" />
          <strong className="mt-2 block text-lg font-black text-white">
            {summary.waitingPickup}
          </strong>
          <span className="text-[8px] font-black uppercase text-slate-500">
            Aguardando retirada
          </span>
        </div>
      </div>

      {summary.waitingPickup > 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-cyan-500/20 bg-cyan-500/[0.05] px-3 py-2 text-[9px] leading-relaxed text-cyan-100/70">
          <CircleDot className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-300" />
          Pedido pronto para retirada permanece aberto até a entrega ao cliente.
        </div>
      )}
    </section>
  );
}
