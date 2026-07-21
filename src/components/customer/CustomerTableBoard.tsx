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
  onOpenTable: (tableCode: string) => void;
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
        icon: <BellRing className="h-3.5 w-3.5" />,
      };
    case 'ready':
      return {
        card: 'border-emerald-400/70 bg-emerald-500/10 shadow-emerald-950/30',
        badge: 'border-emerald-400/30 bg-emerald-500/15 text-emerald-200',
        button: 'border-emerald-400/50 bg-emerald-600 text-white',
        icon: <CheckCircle2 className="h-3.5 w-3.5" />,
      };
    case 'preparing':
      return {
        card: 'border-blue-400/60 bg-blue-500/10 shadow-blue-950/30',
        badge: 'border-blue-400/30 bg-blue-500/15 text-blue-200',
        button: 'border-blue-400/40 bg-blue-600 text-white',
        icon: <ChefHat className="h-3.5 w-3.5" />,
      };
    default:
      return {
        card: 'border-slate-700 bg-slate-950 shadow-slate-950/30',
        badge: 'border-slate-700 bg-slate-900 text-slate-300',
        button: 'border-slate-700 bg-slate-800 text-slate-200',
        icon: <ReceiptText className="h-3.5 w-3.5" />,
      };
  }
};

export const CustomerTableBoard = ({
  orders,
  onOpenTable,
}: CustomerTableBoardProps) => {
  const [now, setNow] = useState(() => Date.now());
  const tables = useMemo(() => buildCustomerTableCards(orders), [orders]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  if (tables.length === 0) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-[10px] font-black uppercase tracking-wider text-slate-300">
          <Utensils className="h-4 w-4 text-orange-400" />
          Mesas abertas
        </h3>
        <span className="rounded-full border border-slate-800 bg-slate-950 px-2.5 py-1 font-mono text-[9px] font-bold text-slate-500">
          {tables.length} ativa{tables.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
        {tables.map(table => {
          const presentation = cardPresentation(table);
          const additionalClients = Math.max(0, table.buyerNames.length - 1);

          return (
            <button
              key={table.tableCode.toLocaleLowerCase('pt-BR')}
              type="button"
              onClick={() => onOpenTable(table.tableCode)}
              className={`group relative flex min-h-44 w-full min-w-0 flex-col overflow-hidden rounded-2xl border-2 p-3 text-left shadow-xl transition-all hover:-translate-y-0.5 hover:border-orange-400 sm:min-h-48 sm:p-4 ${presentation.card}`}
              aria-label={`Abrir atendimento da mesa ${table.tableCode}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <span className="font-mono text-[7px] font-bold uppercase tracking-[0.14em] text-slate-500 sm:text-[8px]">
                    Mesa/código
                  </span>
                  <h4 className="mt-0.5 truncate text-xl font-black text-white sm:text-2xl">
                    {table.tableCode}
                  </h4>
                </div>
                <span className={`flex max-w-[58%] items-center gap-1 rounded-full border px-1.5 py-1 text-[7px] font-black uppercase sm:px-2 sm:text-[8px] ${presentation.badge}`}>
                  {presentation.icon}
                  <span className="truncate">
                    {getCustomerTableStateLabel(table.state, table.pendingCount)}
                  </span>
                </span>
              </div>

              <div className="flex flex-1 flex-col items-center justify-center py-2 text-center sm:py-3">
                <strong className="font-mono text-base text-white sm:text-lg">
                  R$ {table.total.toFixed(2)}
                </strong>
                <span className="mt-1 text-[7px] font-bold uppercase leading-tight text-slate-500 sm:text-[8px]">
                  {table.orderCount} {table.orderCount === 1 ? 'pedido' : 'pedidos'} · {table.itemCount} {table.itemCount === 1 ? 'item' : 'itens'}
                </span>
              </div>

              <div className={`flex min-h-9 items-center justify-center gap-1.5 rounded-xl border px-2 py-2 text-[8px] font-black uppercase tracking-wide sm:text-[9px] ${presentation.button}`}>
                <Utensils className="h-3.5 w-3.5" />
                Abrir mesa
              </div>

              <div className="mt-2 flex items-end justify-between gap-2 border-t border-white/5 pt-2 text-[8px] text-slate-500 sm:text-[9px]">
                <span className="flex items-center gap-1 font-mono">
                  <Clock3 className="h-3 w-3" />
                  {formatElapsedTime(table.openedAt, now)}
                </span>
                <span className="flex min-w-0 items-center justify-end gap-1">
                  <Users className="h-3 w-3 shrink-0" />
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
    </section>
  );
};
