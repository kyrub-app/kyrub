import { useEffect, useMemo, useState } from 'react';
import {
  BellRing,
  CheckCircle2,
  ChefHat,
  Clock3,
  ReceiptText,
  Utensils,
  Users,
} from 'lucide-react';
import type { CustomerOrder } from '../../utils/customerOrders';
import {
  buildCustomerTableCards,
  getCustomerTableStateLabel,
  type CustomerTableCard,
} from '../../utils/customerTables';

interface CustomerTableBoardProps {
  orders: CustomerOrder[];
  onOpenOrders: (tableCode: string) => void;
}

const formatElapsedTime = (value: string, now: number): string => {
  const startedAt = new Date(value).getTime();
  if (!Number.isFinite(startedAt)) return '--:--';

  const elapsedMinutes = Math.max(0, Math.floor((now - startedAt) / 60000));
  const hours = Math.floor(elapsedMinutes / 60);
  const minutes = elapsedMinutes % 60;

  return hours > 0 ? `${hours}h ${minutes}min` : `${minutes}min`;
};

const cardPresentation = (table: CustomerTableCard) => {
  switch (table.state) {
    case 'pending':
      return {
        card: 'border-amber-400/80 bg-amber-500/10 shadow-amber-950/40',
        badge: 'border-amber-400/30 bg-amber-500/15 text-amber-200',
        button: 'border-amber-400/50 bg-amber-500 text-slate-950 animate-pulse',
        icon: <BellRing className="h-4 w-4" />,
      };
    case 'ready':
      return {
        card: 'border-emerald-400/70 bg-emerald-500/10 shadow-emerald-950/30',
        badge: 'border-emerald-400/30 bg-emerald-500/15 text-emerald-200',
        button: 'border-emerald-400/50 bg-emerald-600 text-white',
        icon: <CheckCircle2 className="h-4 w-4" />,
      };
    case 'preparing':
      return {
        card: 'border-blue-400/60 bg-blue-500/10 shadow-blue-950/30',
        badge: 'border-blue-400/30 bg-blue-500/15 text-blue-200',
        button: 'border-blue-400/40 bg-blue-600 text-white',
        icon: <ChefHat className="h-4 w-4" />,
      };
    default:
      return {
        card: 'border-slate-700 bg-slate-950 shadow-slate-950/30',
        badge: 'border-slate-700 bg-slate-900 text-slate-300',
        button: 'border-slate-700 bg-slate-800 text-slate-200',
        icon: <ReceiptText className="h-4 w-4" />,
      };
  }
};

export const CustomerTableBoard = ({
  orders,
  onOpenOrders,
}: CustomerTableBoardProps) => {
  const [now, setNow] = useState(() => Date.now());
  const tables = useMemo(() => buildCustomerTableCards(orders), [orders]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <section className="space-y-4 rounded-3xl border border-slate-800 bg-slate-900/70 p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <span className="font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-orange-400">
            Painel de mesas
          </span>
          <h3 className="mt-1 flex items-center gap-2 text-base font-black text-white">
            <Utensils className="h-5 w-5 text-orange-400" />
            Mesas do autoatendimento
          </h3>
          <p className="mt-1 text-[11px] text-slate-500">
            Pedidos feitos no local aparecem automaticamente pelo código informado pelo cliente.
          </p>
        </div>
        <span className="w-fit rounded-full border border-slate-800 bg-slate-950 px-3 py-1 font-mono text-[10px] font-bold text-slate-400">
          {tables.length} {tables.length === 1 ? 'mesa ativa' : 'mesas ativas'}
        </span>
      </div>

      {tables.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-slate-800 bg-slate-950/50 px-5 py-10 text-center">
          <Utensils className="mx-auto h-10 w-10 text-slate-700" />
          <p className="mt-3 text-xs font-black uppercase text-slate-500">
            Nenhuma mesa ativa
          </p>
          <p className="mt-1 text-[11px] text-slate-600">
            Um card será criado quando o cliente escolher “No local” e informar a mesa ou código.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {tables.map(table => {
            const presentation = cardPresentation(table);
            const additionalClients = Math.max(0, table.buyerNames.length - 1);

            return (
              <button
                key={table.tableCode.toLocaleLowerCase('pt-BR')}
                type="button"
                onClick={() => onOpenOrders(table.tableCode)}
                className={`group relative flex min-h-52 w-full flex-col overflow-hidden rounded-3xl border-2 p-4 text-left shadow-xl transition-all hover:-translate-y-0.5 hover:border-orange-400 ${presentation.card}`}
                aria-label={`Abrir pedidos da mesa ${table.tableCode}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <span className="font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-slate-500">
                      Mesa/código
                    </span>
                    <h4 className="mt-1 text-2xl font-black text-white">
                      {table.tableCode}
                    </h4>
                  </div>
                  <span className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[9px] font-black uppercase ${presentation.badge}`}>
                    {presentation.icon}
                    {getCustomerTableStateLabel(table.state, table.pendingCount)}
                  </span>
                </div>

                <div className="flex flex-1 flex-col items-center justify-center py-4 text-center">
                  <strong className="font-mono text-xl text-white">
                    R$ {table.total.toFixed(2)}
                  </strong>
                  <span className="mt-1 text-[10px] font-bold uppercase text-slate-500">
                    {table.orderCount} {table.orderCount === 1 ? 'pedido' : 'pedidos'} · {table.itemCount} {table.itemCount === 1 ? 'item' : 'itens'}
                  </span>
                </div>

                <div className={`flex min-h-10 items-center justify-center gap-2 rounded-xl border px-3 py-2 text-[10px] font-black uppercase tracking-wide ${presentation.button}`}>
                  {presentation.icon}
                  Abrir pedidos
                </div>

                <div className="mt-3 flex items-end justify-between gap-3 border-t border-white/5 pt-3 text-[10px] text-slate-500">
                  <span className="flex items-center gap-1.5 font-mono">
                    <Clock3 className="h-3.5 w-3.5" />
                    {formatElapsedTime(table.openedAt, now)}
                  </span>
                  <span className="flex min-w-0 items-center justify-end gap-1.5">
                    <Users className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate font-bold text-slate-300">
                      {table.primaryBuyerName}
                      {additionalClients > 0 ? ` +${additionalClients}` : ''}
                    </span>
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
};
