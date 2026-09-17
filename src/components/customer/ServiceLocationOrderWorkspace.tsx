import { useMemo } from 'react';
import { Clock3, MapPin, ReceiptText, Users, X } from 'lucide-react';
import type { ResolvedOrderServiceLocation } from '../../../shared/serviceLocation';
import {
  getCustomerOrderItemOpenQuantity,
  getCustomerOrderOutstandingTotal,
  getCustomerOrderStatusLabel,
  type CustomerOrder,
} from '../../utils/customerOrders';
import { getActiveServiceLocationOrders } from '../../utils/serviceLocationOrders';

interface ServiceLocationOrderWorkspaceProps {
  location: ResolvedOrderServiceLocation;
  orders: CustomerOrder[];
  onClose: () => void;
}

const money = (value: number): string =>
  new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);

const kindLabel = (location: ResolvedOrderServiceLocation): string => {
  switch (location.kind) {
    case 'counter': return 'Balcão';
    case 'parking_spot': return 'Vaga';
    case 'room': return 'Quarto';
    case 'chair': return 'Cadeira';
    case 'box': return 'Box';
    case 'service_window': return 'Guichê';
    case 'table': return 'Mesa';
    default: return 'Local';
  }
};

const dateTime = (value: string): string => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Horário indisponível'
    : new Intl.DateTimeFormat('pt-BR', {
        dateStyle: 'short',
        timeStyle: 'short',
      }).format(date);
};

export const ServiceLocationOrderWorkspace = ({
  location,
  orders,
  onClose,
}: ServiceLocationOrderWorkspaceProps) => {
  const activeOrders = useMemo(
    () => getActiveServiceLocationOrders(orders, location),
    [orders, location]
  );
  const outstanding = useMemo(
    () => activeOrders.reduce(
      (sum, order) => sum + getCustomerOrderOutstandingTotal(order),
      0
    ),
    [activeOrders]
  );
  const buyers = useMemo(
    () => Array.from(new Set(activeOrders.map(order => order.buyerName.trim()).filter(Boolean))),
    [activeOrders]
  );

  return (
    <div className="fixed inset-0 z-[120] bg-slate-950/90 backdrop-blur-sm">
      <div className="relative mx-auto flex h-full w-full max-w-5xl flex-col overflow-hidden bg-slate-900 shadow-2xl lg:my-4 lg:h-[calc(100%-2rem)] lg:rounded-3xl lg:border lg:border-slate-800">
        <header className="flex items-start justify-between gap-4 border-b border-slate-800 bg-slate-900/95 px-4 py-4 sm:px-6">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-orange-500 text-slate-950">
              <MapPin className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <span className="font-mono text-[9px] font-black uppercase tracking-[0.18em] text-orange-300">
                Atendimento presencial · {kindLabel(location)}
              </span>
              <h2 className="mt-1 truncate text-lg font-black text-white">
                {location.label}
              </h2>
              <p className="mt-1 text-[9px] text-slate-500">
                Identidade {location.source === 'canonical' ? 'canônica' : 'legada'} do local preservada no pedido.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-800 bg-slate-950 text-slate-400 hover:text-white"
            aria-label="Fechar atendimento do local"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
              <ReceiptText className="h-4 w-4 text-orange-300" />
              <strong className="mt-2 block text-lg text-white">{activeOrders.length}</strong>
              <span className="text-[8px] font-black uppercase text-slate-500">Pedidos ativos</span>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
              <Users className="h-4 w-4 text-cyan-300" />
              <strong className="mt-2 block text-lg text-white">{buyers.length}</strong>
              <span className="text-[8px] font-black uppercase text-slate-500">Clientes identificados</span>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
              <span className="font-mono text-[9px] font-black uppercase text-emerald-300">Conta em aberto</span>
              <strong className="mt-2 block font-mono text-lg text-white">{money(outstanding)}</strong>
              <span className="text-[8px] text-slate-600">Projeção dos itens ainda não liquidados.</span>
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-amber-500/20 bg-amber-500/[0.055] px-4 py-3 text-[9px] leading-relaxed text-amber-100/80">
            Este local não é uma mesa. Por segurança, controles legados de pagamento, transferência de itens e criação de pedido por `tableCode` não são exibidos aqui. “Fechar conta” continua sendo apenas um chamado operacional; o pagamento permanece no domínio financeiro próprio.
          </div>

          <section className="mt-5 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-[10px] font-black uppercase tracking-wider text-slate-300">Pedidos deste local</h3>
              <span className="rounded-full border border-slate-800 bg-slate-950 px-2.5 py-1 text-[8px] font-black text-slate-500">
                {location.label}
              </span>
            </div>

            {activeOrders.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-950/50 px-4 py-10 text-center text-[10px] text-slate-500">
                Nenhum pedido ativo permanece neste local.
              </div>
            ) : activeOrders.map(order => (
              <article key={order.id} className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong className="text-xs text-white">{order.buyerName || 'Atendimento presencial'}</strong>
                      <span className="rounded-full border border-slate-700 px-2 py-1 text-[7px] font-black uppercase text-slate-400">
                        {getCustomerOrderStatusLabel(order.status)}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[8px] text-slate-600">
                      <span>Pedido {order.id.slice(-8)}</span>
                      <span className="flex items-center gap-1"><Clock3 className="h-3 w-3" /> {dateTime(order.createdAt)}</span>
                    </div>
                    {order.customerNote && (
                      <p className="mt-2 rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-[9px] italic text-slate-400">
                        Obs.: {order.customerNote}
                      </p>
                    )}
                  </div>
                  <strong className="shrink-0 font-mono text-sm text-white">
                    {money(getCustomerOrderOutstandingTotal(order))}
                  </strong>
                </div>

                <div className="mt-3 space-y-2 border-t border-white/5 pt-3">
                  {order.items.flatMap(item => {
                    const openQuantity = getCustomerOrderItemOpenQuantity(item);
                    if (openQuantity <= 0) return [];
                    return [(
                      <div key={item.lineId} className="flex items-start justify-between gap-3 text-[9px]">
                        <div className="min-w-0">
                          <strong className="block truncate text-slate-300">{openQuantity}× {item.name}</strong>
                          {item.note && <span className="mt-0.5 block italic text-amber-300">{item.note}</span>}
                        </div>
                        <span className="shrink-0 font-mono text-slate-400">{money(item.price * openQuantity)}</span>
                      </div>
                    )];
                  })}
                </div>
              </article>
            ))}
          </section>
        </main>
      </div>
    </div>
  );
};
