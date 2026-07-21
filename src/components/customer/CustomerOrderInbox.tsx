import { useMemo, useState } from 'react';
import {
  CheckCircle2,
  ChefHat,
  Clock3,
  MapPin,
  PackageCheck,
  ShoppingBag,
  Truck,
  UserRound,
  XCircle,
} from 'lucide-react';
import {
  getCustomerOrderStatusLabel,
  getFulfillmentLabel,
  type CustomerOrder,
  type CustomerOrderStatus,
} from '../../utils/customerOrders';

interface CustomerOrderInboxProps {
  orders: CustomerOrder[];
  busyOrderId: string;
  onChangeStatus: (
    order: CustomerOrder,
    status: CustomerOrderStatus
  ) => Promise<void>;
}

type InboxFilter = 'active' | 'pending' | 'preparing' | 'ready' | 'finished';

const formatDateTime = (value: string): string => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Horário indisponível'
    : new Intl.DateTimeFormat('pt-BR', {
        dateStyle: 'short',
        timeStyle: 'short',
      }).format(date);
};

const actionForOrder = (
  order: CustomerOrder
): Array<{ label: string; status: CustomerOrderStatus; emphasis?: boolean }> => {
  switch (order.status) {
    case 'pending':
      return [
        { label: 'Recusar', status: 'rejected' },
        { label: 'Aceitar', status: 'accepted', emphasis: true },
      ];
    case 'accepted':
      return [{ label: 'Iniciar preparo', status: 'preparing', emphasis: true }];
    case 'preparing':
      return [{ label: 'Marcar pronto', status: 'ready', emphasis: true }];
    case 'ready':
      return order.fulfillmentType === 'delivery'
        ? [{ label: 'Saiu para entrega', status: 'out_for_delivery', emphasis: true }]
        : [{ label: 'Concluir pedido', status: 'completed', emphasis: true }];
    case 'out_for_delivery':
      return [{ label: 'Confirmar entrega', status: 'completed', emphasis: true }];
    default:
      return [];
  }
};

export const CustomerOrderInbox = ({
  orders,
  busyOrderId,
  onChangeStatus,
}: CustomerOrderInboxProps) => {
  const [filter, setFilter] = useState<InboxFilter>('active');

  const filteredOrders = useMemo(() => {
    switch (filter) {
      case 'pending':
        return orders.filter(order => order.status === 'pending');
      case 'preparing':
        return orders.filter(order =>
          order.status === 'accepted' || order.status === 'preparing'
        );
      case 'ready':
        return orders.filter(order =>
          order.status === 'ready' || order.status === 'out_for_delivery'
        );
      case 'finished':
        return orders.filter(order =>
          order.status === 'completed' ||
          order.status === 'rejected' ||
          order.status === 'cancelled'
        );
      default:
        return orders.filter(order =>
          order.status !== 'completed' &&
          order.status !== 'rejected' &&
          order.status !== 'cancelled'
        );
    }
  }, [filter, orders]);

  const filterOptions: Array<{ id: InboxFilter; label: string }> = [
    { id: 'active', label: 'Ativos' },
    { id: 'pending', label: 'Novos' },
    { id: 'preparing', label: 'Em preparo' },
    { id: 'ready', label: 'Prontos' },
    { id: 'finished', label: 'Finalizados' },
  ];

  return (
    <section className="space-y-4 rounded-3xl border border-slate-800 bg-slate-900/70 p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <span className="font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-orange-400">
            Pedidos da vitrine
          </span>
          <h3 className="mt-1 flex items-center gap-2 text-base font-black text-white">
            <ShoppingBag className="h-5 w-5 text-orange-400" />
            Atendimento em tempo real
          </h3>
          <p className="mt-1 text-[11px] text-slate-500">
            Aceite, prepare e conclua os pedidos enviados pelos clientes.
          </p>
        </div>
        <span className="w-fit rounded-full border border-slate-800 bg-slate-950 px-3 py-1 font-mono text-[10px] font-bold text-slate-400">
          {orders.length} no histórico
        </span>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
        {filterOptions.map(option => (
          <button
            key={option.id}
            type="button"
            onClick={() => setFilter(option.id)}
            className={`whitespace-nowrap rounded-xl px-3 py-2 text-[10px] font-black uppercase tracking-wide transition-colors ${
              filter === option.id
                ? 'bg-orange-500 text-slate-950'
                : 'border border-slate-800 bg-slate-950 text-slate-400 hover:text-white'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {filteredOrders.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-slate-800 bg-slate-950/50 px-5 py-12 text-center">
          <PackageCheck className="mx-auto h-10 w-10 text-slate-700" />
          <p className="mt-3 text-xs font-black uppercase text-slate-500">
            Nenhum pedido nesta etapa
          </p>
          <p className="mt-1 text-[11px] text-slate-600">
            Novos pedidos aparecerão automaticamente aqui.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {filteredOrders.map(order => {
            const actions = actionForOrder(order);
            const isBusy = busyOrderId === order.id;

            return (
              <article
                key={order.id}
                className="flex flex-col overflow-hidden rounded-3xl border border-slate-800 bg-slate-950"
              >
                <div className="flex items-start justify-between gap-3 border-b border-slate-800 p-4">
                  <div className="min-w-0">
                    <span className="font-mono text-[9px] font-bold uppercase tracking-wide text-orange-400">
                      {getFulfillmentLabel(order.fulfillmentType)}
                    </span>
                    <h4 className="mt-1 truncate text-sm font-black text-white">
                      {order.buyerName}
                    </h4>
                    <span className="mt-1 flex items-center gap-1.5 text-[10px] text-slate-500">
                      <Clock3 className="h-3 w-3" />
                      {formatDateTime(order.createdAt)}
                    </span>
                  </div>
                  <span className="max-w-[46%] rounded-full border border-slate-700 bg-slate-900 px-2.5 py-1 text-center text-[9px] font-black uppercase text-slate-300">
                    {getCustomerOrderStatusLabel(order.status)}
                  </span>
                </div>

                <div className="flex-1 space-y-4 p-4">
                  <div className="space-y-2">
                    {order.items.map(item => (
                      <div
                        key={`${order.id}-${item.productId}`}
                        className="rounded-2xl border border-slate-800 bg-slate-900/70 p-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <strong className="text-xs text-slate-200">
                              {item.quantity}× {item.name}
                            </strong>
                            {item.note && (
                              <p className="mt-1 text-[10px] italic text-amber-300">
                                Obs.: {item.note}
                              </p>
                            )}
                          </div>
                          <span className="font-mono text-[10px] font-bold text-slate-400">
                            R$ {(item.price * item.quantity).toFixed(2)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="space-y-2 rounded-2xl border border-slate-800 bg-slate-900/50 p-3 text-[10px] text-slate-400">
                    <p className="flex items-center gap-2">
                      <UserRound className="h-3.5 w-3.5 text-slate-500" />
                      {order.buyerEmail}
                    </p>
                    {order.deliveryAddress && (
                      <p className="flex items-start gap-2">
                        <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" />
                        {order.deliveryAddress}
                      </p>
                    )}
                    {order.tableCode && (
                      <p className="flex items-center gap-2">
                        <ChefHat className="h-3.5 w-3.5 text-slate-500" />
                        Mesa/código: {order.tableCode}
                      </p>
                    )}
                    {order.customerNote && (
                      <p className="border-t border-slate-800 pt-2 text-amber-200">
                        Observação geral: {order.customerNote}
                      </p>
                    )}
                  </div>

                  <div className="flex items-end justify-between gap-3 border-t border-slate-800 pt-3">
                    <div>
                      <span className="block font-mono text-[8px] uppercase text-slate-600">
                        Total pendente
                      </span>
                      <strong className="font-mono text-base text-white">
                        R$ {order.total.toFixed(2)}
                      </strong>
                    </div>
                    <span className="rounded-lg bg-amber-500/10 px-2.5 py-1 text-[9px] font-bold uppercase text-amber-300">
                      Não pago
                    </span>
                  </div>
                </div>

                {actions.length > 0 && (
                  <div className="flex gap-2 border-t border-slate-800 bg-slate-900/70 p-3">
                    {actions.map(action => (
                      <button
                        key={action.status}
                        type="button"
                        disabled={isBusy}
                        onClick={() => void onChangeStatus(order, action.status)}
                        className={`flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-[10px] font-black uppercase tracking-wide disabled:cursor-not-allowed disabled:opacity-50 ${
                          action.emphasis
                            ? 'bg-emerald-600 text-white hover:bg-emerald-500'
                            : 'border border-red-500/25 bg-red-500/10 text-red-300 hover:bg-red-500/20'
                        }`}
                      >
                        {action.status === 'rejected' ? (
                          <XCircle className="h-3.5 w-3.5" />
                        ) : action.status === 'completed' ? (
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        ) : action.status === 'out_for_delivery' ? (
                          <Truck className="h-3.5 w-3.5" />
                        ) : (
                          <PackageCheck className="h-3.5 w-3.5" />
                        )}
                        {isBusy ? 'Atualizando...' : action.label}
                      </button>
                    ))}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
};
