import { PackageOpen, ReceiptText, StickyNote, UserRound } from 'lucide-react';
import {
  getCustomerOrderStatusLabel,
  type CustomerOrder,
} from '../../utils/customerOrders';

const money = (value: number): string =>
  new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);

const sourceLabel = (order: CustomerOrder): string => {
  if (order.source === 'staff') return 'Criado pelo atendimento';
  if (order.source === 'transfer') return 'Transferido';
  return 'Autoatendimento';
};

export function ServiceLocationOrderList({ orders }: { orders: CustomerOrder[] }) {
  if (orders.length === 0) {
    return (
      <div className="mt-5 rounded-2xl border border-dashed border-slate-800 bg-slate-950/60 px-4 py-8 text-center text-[10px] text-slate-500">
        Não há pedidos ativos neste local.
      </div>
    );
  }

  return (
    <section className="mt-5 space-y-2" id="service-location-order-details">
      <div className="flex items-center gap-2 text-[9px] font-black uppercase text-slate-400">
        <ReceiptText className="h-4 w-4 text-orange-300" />
        Pedidos deste local
      </div>

      {orders.map(order => (
        <article
          key={order.id}
          className="rounded-2xl border border-slate-800 bg-slate-950 p-3"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <span className="flex items-center gap-1.5 text-[9px] text-slate-500">
                <UserRound className="h-3.5 w-3.5" />
                {order.buyerName || 'Cliente'}
              </span>
              <strong className="mt-1 block truncate text-xs text-white">
                Pedido {order.id.slice(-8)}
              </strong>
              <span className="mt-1 block text-[8px] text-slate-600">
                {sourceLabel(order)}
                {order.operatorName ? ` · ${order.operatorName}` : ''}
              </span>
            </div>
            <span className="rounded-full border border-slate-700 bg-slate-900 px-2 py-1 text-[8px] font-black uppercase text-slate-300">
              {getCustomerOrderStatusLabel(order.status)}
            </span>
          </div>

          <div className="mt-3 space-y-2 border-t border-white/5 pt-3">
            {order.items.map(item => (
              <div
                key={item.lineId}
                className="rounded-xl border border-slate-800/80 bg-slate-900/50 px-3 py-2"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <strong className="flex items-center gap-1.5 text-[10px] text-slate-200">
                      <PackageOpen className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                      <span className="truncate">{item.quantity}× {item.name}</span>
                    </strong>
                    {item.note && (
                      <span className="mt-1 flex items-start gap-1 text-[8px] italic leading-relaxed text-amber-200/80">
                        <StickyNote className="mt-0.5 h-3 w-3 shrink-0" />
                        {item.note}
                      </span>
                    )}
                  </div>
                  <span className="shrink-0 font-mono text-[9px] text-slate-300">
                    {money(item.price * item.quantity)}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {order.customerNote && (
            <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-500/15 bg-amber-500/[0.05] px-3 py-2 text-[8px] leading-relaxed text-amber-100/75">
              <StickyNote className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span><strong>Observação do pedido:</strong> {order.customerNote}</span>
            </div>
          )}

          <div className="mt-3 flex items-center justify-between border-t border-white/5 pt-3 text-[8px] text-slate-500">
            <span>{order.items.length} linha{order.items.length === 1 ? '' : 's'}</span>
            <span>
              Total do pedido: <strong className="font-mono text-[10px] text-white">{money(order.total)}</strong>
            </span>
          </div>
        </article>
      ))}

      <p className="text-[8px] leading-relaxed text-slate-600">
        Esta lista é somente leitura operacional. Produção continua no KDS; pagamento, transferência e estoque permanecem nas autoridades já existentes.
      </p>
    </section>
  );
}
