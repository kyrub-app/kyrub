import { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  ChefHat,
  Clock3,
  Filter,
  KeyRound,
  LoaderCircle,
  MapPin,
  PackageCheck,
  ShieldCheck,
  ShoppingBag,
  Truck,
  UserRound,
  X,
  XCircle,
} from 'lucide-react';
import {
  acknowledgeCanonicalOrderNavigation,
  KYRUB_CANONICAL_ORDER_NAVIGATION_REQUESTED_EVENT,
  readCanonicalOrderNavigation,
  type CanonicalOrderNavigationRequest,
} from '../../utils/canonicalOrderNavigation';
import {
  getCustomerOrderItemOpenQuantity,
  getCustomerOrderOutstandingTotal,
  getCustomerOrderPaymentStatusLabel,
  getCustomerOrderStatusLabel,
  getFulfillmentLabel,
  type CustomerOrder,
  type CustomerOrderStatus,
} from '../../utils/customerOrders';
import {
  buildOrderOriginOptions,
  getOrderOrigin,
  type OrderDecision,
  type OrderDeliveryProvider,
} from '../../utils/orderWorkflow';
import {
  getProductionStationOptions,
  loadCachedProductPreparationStations,
  PRODUCTION_ROUTING_UPDATED_EVENT,
  resolveProductPreparationStation,
  type ProductPreparationStations,
} from '../../utils/productionRouting';

interface CustomerOrderInboxProps {
  storeId: string;
  orders: CustomerOrder[];
  busyOrderId: string;
  attendanceSpaces?: string[];
  onChangeStatus: (
    order: CustomerOrder,
    status: CustomerOrderStatus,
    decision?: OrderDecision
  ) => Promise<void>;
}

type InboxFilter =
  | 'active'
  | 'pending'
  | 'preparing'
  | 'ready'
  | 'pickup'
  | 'finished';

const currency = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

const formatDateTime = (value: string): string => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Horário indisponível'
    : new Intl.DateTimeFormat('pt-BR', {
        dateStyle: 'short',
        timeStyle: 'short',
      }).format(date);
};

const orderElementId = (orderId: string): string =>
  `kyrub-customer-order-${encodeURIComponent(orderId)}`;

const isPickupWaiting = (order: CustomerOrder): boolean =>
  order.fulfillmentType === 'pickup' && order.status === 'ready';

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
      if (order.fulfillmentType === 'pickup') return [];
      return order.fulfillmentType === 'delivery'
        ? [{ label: 'Confirmar saída', status: 'out_for_delivery', emphasis: true }]
        : [{ label: 'Concluir pedido', status: 'completed', emphasis: true }];
    case 'out_for_delivery':
      return [{ label: 'Confirmar entrega', status: 'completed', emphasis: true }];
    default:
      return [];
  }
};

const matchesStage = (order: CustomerOrder, filter: InboxFilter): boolean => {
  switch (filter) {
    case 'pending':
      return order.status === 'pending';
    case 'preparing':
      return order.status === 'accepted' || order.status === 'preparing';
    case 'ready':
      return !isPickupWaiting(order) &&
        (order.status === 'ready' || order.status === 'out_for_delivery');
    case 'pickup':
      return isPickupWaiting(order);
    case 'finished':
      return ['completed', 'rejected', 'cancelled'].includes(order.status);
    default:
      return !['completed', 'rejected', 'cancelled'].includes(order.status);
  }
};

export const CustomerOrderInbox = ({
  storeId,
  orders,
  busyOrderId,
  attendanceSpaces = [],
  onChangeStatus,
}: CustomerOrderInboxProps) => {
  const [filter, setFilter] = useState<InboxFilter>('active');
  const [originFilter, setOriginFilter] = useState('all');
  const [stationFilter, setStationFilter] = useState('all');
  const [stationRoutes, setStationRoutes] = useState<ProductPreparationStations>(
    loadCachedProductPreparationStations
  );
  const [focusOrderId, setFocusOrderId] = useState('');
  const [rejectingOrder, setRejectingOrder] = useState<CustomerOrder | null>(null);
  const [routingOrder, setRoutingOrder] = useState<CustomerOrder | null>(null);
  const [pickupOrder, setPickupOrder] = useState<CustomerOrder | null>(null);
  const [pickupCode, setPickupCode] = useState('');
  const [pickupError, setPickupError] = useState('');
  const [pickupBusy, setPickupBusy] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');
  const [suggestedAlternative, setSuggestedAlternative] = useState('');

  useEffect(() => {
    const acceptNavigation = (
      request: CanonicalOrderNavigationRequest | null
    ): void => {
      if (!request || request.storeId !== storeId) return;
      setFocusOrderId(request.orderId);
    };

    acceptNavigation(readCanonicalOrderNavigation(storeId));

    const handleNavigation = (event: Event): void => {
      const detail = (event as CustomEvent<CanonicalOrderNavigationRequest>).detail;
      if (detail?.storeId?.trim() !== storeId) return;
      acceptNavigation(readCanonicalOrderNavigation(storeId) ?? detail);
    };

    window.addEventListener(
      KYRUB_CANONICAL_ORDER_NAVIGATION_REQUESTED_EVENT,
      handleNavigation
    );
    return () => {
      window.removeEventListener(
        KYRUB_CANONICAL_ORDER_NAVIGATION_REQUESTED_EVENT,
        handleNavigation
      );
    };
  }, [storeId]);

  useEffect(() => {
    const refresh = (event?: Event): void => {
      const detail = (event as CustomEvent<ProductPreparationStations> | undefined)?.detail;
      setStationRoutes(detail ?? loadCachedProductPreparationStations());
    };
    window.addEventListener(PRODUCTION_ROUTING_UPDATED_EVENT, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(PRODUCTION_ROUTING_UPDATED_EVENT, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  const originOptions = useMemo(
    () => buildOrderOriginOptions(orders, attendanceSpaces),
    [attendanceSpaces, orders]
  );

  const stationOptions = useMemo(
    () => getProductionStationOptions(orders.flatMap(order => order.items), stationRoutes),
    [orders, stationRoutes]
  );

  useEffect(() => {
    if (stationFilter !== 'all' && !stationOptions.includes(stationFilter)) {
      setStationFilter('all');
    }
  }, [stationFilter, stationOptions]);

  useEffect(() => {
    if (!focusOrderId) return;
    const target = orders.find(order => order.id === focusOrderId);
    if (!target) return;

    setOriginFilter('all');
    setStationFilter('all');
    setFilter(
      ['completed', 'rejected', 'cancelled'].includes(target.status)
        ? 'finished'
        : 'active'
    );
  }, [focusOrderId, orders]);

  const pickupCount = useMemo(
    () => orders.filter(isPickupWaiting).length,
    [orders]
  );

  const filteredOrders = useMemo(
    () =>
      orders.filter(order => {
        const origin = getOrderOrigin(order, attendanceSpaces);
        const hasStation =
          stationFilter === 'all' ||
          order.items.some(
            item =>
              resolveProductPreparationStation(item.productId, stationRoutes) ===
              stationFilter
          );
        return (
          (originFilter === 'all' || origin.id === originFilter) &&
          hasStation &&
          matchesStage(order, filter)
        );
      }),
    [attendanceSpaces, filter, orders, originFilter, stationFilter, stationRoutes]
  );

  useEffect(() => {
    if (!focusOrderId || originFilter !== 'all' || stationFilter !== 'all') return;
    if (!filteredOrders.some(order => order.id === focusOrderId)) return;

    const focusedOrderId = focusOrderId;
    const frame = window.requestAnimationFrame(() => {
      const element = document.getElementById(orderElementId(focusedOrderId));
      if (!(element instanceof HTMLElement)) return;
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      element.focus({ preventScroll: true });
      acknowledgeCanonicalOrderNavigation(storeId, focusedOrderId);
      setFocusOrderId(current => current === focusedOrderId ? '' : current);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [filteredOrders, focusOrderId, originFilter, stationFilter, storeId]);

  const filterOptions: Array<{ id: InboxFilter; label: string }> = [
    { id: 'active', label: 'Ativos' },
    { id: 'pending', label: 'Novos' },
    { id: 'preparing', label: 'Em preparo' },
    { id: 'ready', label: 'Prontos' },
    { id: 'pickup', label: pickupCount > 0 ? `Retirada (${pickupCount})` : 'Retirada' },
    { id: 'finished', label: 'Finalizados' },
  ];

  const confirmRejection = async (): Promise<void> => {
    if (!rejectingOrder || !rejectionReason.trim()) return;
    await onChangeStatus(rejectingOrder, 'rejected', {
      reason: rejectionReason,
      alternative: suggestedAlternative,
    });
    setRejectingOrder(null);
    setRejectionReason('');
    setSuggestedAlternative('');
  };

  const confirmDeliveryProvider = async (
    provider: OrderDeliveryProvider
  ): Promise<void> => {
    if (!routingOrder) return;
    await onChangeStatus(routingOrder, 'accepted', { deliveryProvider: provider });
    setRoutingOrder(null);
  };

  const openPickupHandoff = (order: CustomerOrder): void => {
    setPickupOrder(order);
    setPickupCode('');
    setPickupError('');
  };

  const confirmPickupHandoff = async (): Promise<void> => {
    if (!pickupOrder || !/^\d{6}$/.test(pickupCode)) return;
    setPickupBusy(true);
    setPickupError('');
    try {
      await onChangeStatus(pickupOrder, 'completed', { handoffCode: pickupCode });
      setPickupOrder(null);
      setPickupCode('');
      setFilter('finished');
    } catch (error) {
      setPickupError(
        error instanceof Error ? error.message : 'Não foi possível confirmar a retirada.'
      );
    } finally {
      setPickupBusy(false);
    }
  };

  return (
    <section className="space-y-4 rounded-3xl border border-slate-800 bg-slate-900/70 p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <span className="font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-orange-400">
            Pedidos aprovados para operação
          </span>
          <h3 className="mt-1 flex items-center gap-2 text-base font-black text-white">
            <ShoppingBag className="h-5 w-5 text-orange-400" />
            Produção em tempo real
          </h3>
          <p className="mt-1 text-[11px] text-slate-500">
            Preparo e entrega física são etapas separadas. Retiradas prontas ficam no balcão até a validação do código.
          </p>
        </div>
        <span className="w-fit rounded-full border border-slate-800 bg-slate-950 px-3 py-1 font-mono text-[10px] font-bold text-slate-400">
          {orders.length} no histórico
        </span>
      </div>

      <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-2.5">
        <div className="mb-2 flex items-center gap-1.5 px-1 text-[8px] font-black uppercase tracking-wide text-cyan-300">
          <Filter className="h-3.5 w-3.5" /> Origem do pedido
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
          <button type="button" onClick={() => setOriginFilter('all')} className={`whitespace-nowrap rounded-xl px-3 py-2 text-[9px] font-black uppercase ${originFilter === 'all' ? 'bg-cyan-500 text-slate-950' : 'border border-slate-800 bg-slate-950 text-slate-400'}`}>Todas as origens</button>
          {originOptions.map(option => (
            <button key={option.id} type="button" onClick={() => setOriginFilter(option.id)} className={`whitespace-nowrap rounded-xl px-3 py-2 text-[9px] font-black uppercase ${originFilter === option.id ? 'bg-cyan-500 text-slate-950' : 'border border-slate-800 bg-slate-950 text-slate-400'}`}>{option.label}</button>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-violet-500/20 bg-violet-500/5 p-2.5">
        <div className="mb-2 flex items-center gap-1.5 px-1 text-[8px] font-black uppercase tracking-wide text-violet-300">
          <ChefHat className="h-3.5 w-3.5" /> Estação de preparo
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
          <button type="button" onClick={() => setStationFilter('all')} className={`whitespace-nowrap rounded-xl px-3 py-2 text-[9px] font-black uppercase ${stationFilter === 'all' ? 'bg-violet-500 text-white' : 'border border-slate-800 bg-slate-950 text-slate-400'}`}>Todas as estações</button>
          {stationOptions.map(station => (
            <button key={station} type="button" onClick={() => setStationFilter(station)} className={`whitespace-nowrap rounded-xl px-3 py-2 text-[9px] font-black uppercase ${stationFilter === station ? 'bg-violet-500 text-white' : 'border border-slate-800 bg-slate-950 text-slate-400'}`}>{station}</button>
          ))}
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none" aria-label="Etapas dos pedidos">
        {filterOptions.map(option => (
          <button key={option.id} type="button" onClick={() => setFilter(option.id)} className={`whitespace-nowrap rounded-xl px-3 py-2 text-[10px] font-black uppercase tracking-wide transition-colors ${filter === option.id ? option.id === 'pickup' ? 'bg-cyan-500 text-slate-950' : 'bg-orange-500 text-slate-950' : 'border border-slate-800 bg-slate-950 text-slate-400 hover:text-white'}`}>{option.label}</button>
        ))}
      </div>

      {filter === 'pickup' && (
        <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/[0.06] p-3 text-[10px] leading-relaxed text-cyan-100">
          <strong className="flex items-center gap-2 text-[10px] uppercase"><ShieldCheck className="h-4 w-4" /> Balcão de retirada</strong>
          <p className="mt-1 text-cyan-100/70">O pedido permanece aqui depois que o preparo termina. Só sai da fila quando o código de 6 dígitos do cliente for validado.</p>
        </div>
      )}

      {filteredOrders.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-slate-800 bg-slate-950/50 px-5 py-12 text-center">
          <PackageCheck className="mx-auto h-10 w-10 text-slate-700" />
          <p className="mt-3 text-xs font-black uppercase text-slate-500">Nenhum pedido nesta combinação</p>
          <p className="mt-1 text-[11px] text-slate-600">Altere a origem, a estação ou a etapa para consultar outros pedidos.</p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {filteredOrders.map(order => {
            const actions = actionForOrder(order);
            const isBusy = busyOrderId === order.id;
            const outstandingTotal = getCustomerOrderOutstandingTotal(order);
            const visibleItems = order.items.filter(item => {
              const operational = item.quantity - item.transferredQuantity > 0;
              const matchesStation = stationFilter === 'all' || resolveProductPreparationStation(item.productId, stationRoutes) === stationFilter;
              return operational && matchesStation;
            });
            const origin = getOrderOrigin(order, attendanceSpaces);
            const pickupWaiting = isPickupWaiting(order);

            return (
              <article
                key={order.id}
                id={orderElementId(order.id)}
                tabIndex={-1}
                className={`flex flex-col overflow-hidden rounded-3xl border bg-slate-950 focus:outline-none focus:ring-2 focus:ring-emerald-400/60 ${pickupWaiting ? 'border-cyan-500/30' : 'border-slate-800'}`}
              >
                <div className="flex items-start justify-between gap-3 border-b border-slate-800 p-4">
                  <div className="min-w-0">
                    <span className={`font-mono text-[9px] font-bold uppercase tracking-wide ${pickupWaiting ? 'text-cyan-300' : 'text-orange-400'}`}>{origin.label} · {getFulfillmentLabel(order.fulfillmentType)}</span>
                    <h4 className="mt-1 truncate text-sm font-black text-white">{order.buyerName}</h4>
                    <span className="mt-1 flex items-center gap-1.5 text-[10px] text-slate-500"><Clock3 className="h-3 w-3" />{formatDateTime(pickupWaiting ? order.updatedAt : order.createdAt)}</span>
                  </div>
                  <span className={`max-w-[46%] rounded-full border px-2.5 py-1 text-center text-[9px] font-black uppercase ${pickupWaiting ? 'border-cyan-500/25 bg-cyan-500/10 text-cyan-200' : 'border-slate-700 bg-slate-900 text-slate-300'}`}>{pickupWaiting ? 'Aguardando retirada' : getCustomerOrderStatusLabel(order.status)}</span>
                </div>

                <div className="flex-1 space-y-4 p-4">
                  <div className="space-y-2">
                    {visibleItems.map(item => {
                      const operationalQuantity = item.quantity - item.transferredQuantity;
                      const openQuantity = getCustomerOrderItemOpenQuantity(item);
                      const station = resolveProductPreparationStation(item.productId, stationRoutes);
                      return (
                        <div key={item.lineId} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <span className="mb-1 inline-flex rounded-full bg-violet-500/10 px-2 py-0.5 text-[8px] font-black uppercase text-violet-300">{station}</span>
                              <strong className="block text-xs text-slate-200">{operationalQuantity}× {item.name}</strong>
                              {item.note && <p className="mt-1 text-[10px] italic text-amber-300">Obs.: {item.note}</p>}
                            </div>
                            <div className="text-right">
                              <span className="block font-mono text-[10px] font-bold text-slate-400">{currency.format(item.price * operationalQuantity)}</span>
                              {openQuantity > 0 && <span className="text-[8px] text-slate-600">{openQuantity} em aberto</span>}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="space-y-2 rounded-2xl border border-slate-800 bg-slate-900/50 p-3 text-[10px] text-slate-400">
                    {order.buyerEmail && <p className="flex items-center gap-2"><UserRound className="h-3.5 w-3.5 text-slate-500" />{order.buyerEmail}</p>}
                    {order.deliveryAddress && <p className="flex items-start gap-2"><MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" />{order.deliveryAddress}</p>}
                    {order.tableCode && <p className="flex items-center gap-2"><ChefHat className="h-3.5 w-3.5 text-slate-500" />Mesa/código: {order.tableCode}</p>}
                    {order.operatorName && <p className="flex items-center gap-2"><UserRound className="h-3.5 w-3.5 text-slate-500" />Operador: {order.operatorName}</p>}
                    {order.customerNote && <p className="border-t border-slate-800 pt-2 text-amber-200">Observação geral: {order.customerNote}</p>}
                  </div>

                  <div className="flex items-end justify-between gap-3 border-t border-slate-800 pt-3">
                    <div>
                      <span className="block font-mono text-[8px] uppercase text-slate-600">Saldo do pedido</span>
                      <strong className="font-mono text-base text-white">{currency.format(outstandingTotal)}</strong>
                    </div>
                    <span className={`rounded-lg px-2.5 py-1 text-[9px] font-bold uppercase ${order.paymentStatus === 'paid' ? 'bg-emerald-500/10 text-emerald-300' : order.paymentStatus === 'partial' ? 'bg-blue-500/10 text-blue-300' : 'bg-amber-500/10 text-amber-300'}`}>{getCustomerOrderPaymentStatusLabel(order.paymentStatus)}</span>
                  </div>
                </div>

                {pickupWaiting ? (
                  <div className="border-t border-cyan-500/20 bg-cyan-500/[0.05] p-3">
                    <button type="button" disabled={isBusy} onClick={() => openPickupHandoff(order)} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-cyan-500 px-4 text-[10px] font-black uppercase text-slate-950 hover:bg-cyan-400 disabled:opacity-40"><KeyRound className="h-4 w-4" />Entregar pedido</button>
                  </div>
                ) : actions.length > 0 ? (
                  <div className="flex gap-2 border-t border-slate-800 bg-slate-900/70 p-3">
                    {actions.map(action => (
                      <button key={action.status} type="button" disabled={isBusy} onClick={() => {
                        if (action.status === 'rejected') {
                          setRejectingOrder(order);
                          setRejectionReason('');
                          setSuggestedAlternative('');
                          return;
                        }
                        if (action.status === 'accepted' && order.fulfillmentType === 'delivery') {
                          setRoutingOrder(order);
                          return;
                        }
                        void onChangeStatus(order, action.status);
                      }} className={`flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-[10px] font-black uppercase tracking-wide disabled:cursor-not-allowed disabled:opacity-50 ${action.emphasis ? 'bg-emerald-600 text-white hover:bg-emerald-500' : 'border border-red-500/25 bg-red-500/10 text-red-300 hover:bg-red-500/20'}`}>
                        {action.status === 'rejected' ? <XCircle className="h-3.5 w-3.5" /> : action.status === 'completed' ? <CheckCircle2 className="h-3.5 w-3.5" /> : action.status === 'out_for_delivery' ? <Truck className="h-3.5 w-3.5" /> : <PackageCheck className="h-3.5 w-3.5" />}
                        {isBusy ? 'Atualizando...' : action.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}

      {pickupOrder && (
        <div className="fixed inset-0 z-[160] flex items-end justify-center bg-slate-950/90 backdrop-blur-md sm:items-center sm:p-5">
          <section className="w-full max-w-md rounded-t-3xl border border-cyan-500/25 bg-slate-900 p-5 shadow-2xl sm:rounded-3xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <span className="font-mono text-[9px] font-black uppercase tracking-[0.16em] text-cyan-300">Retirada · Balcão</span>
                <h3 className="mt-1 text-lg font-black text-white">Confirmar entrega do pedido</h3>
                <p className="mt-1 text-[11px] text-slate-400">Peça ao cliente o código de 6 dígitos exibido no Kyrub. O pedido só será finalizado depois da validação.</p>
              </div>
              <button type="button" disabled={pickupBusy} onClick={() => setPickupOrder(null)} className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-800 bg-slate-950 text-slate-500 disabled:opacity-40"><X className="h-4 w-4" /></button>
            </div>
            <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/70 p-3 text-[10px] text-slate-400">
              <strong className="block text-xs text-white">{pickupOrder.buyerName}</strong>
              <span>{pickupOrder.items.map(item => `${item.quantity - item.transferredQuantity}× ${item.name}`).join(' · ')}</span>
            </div>
            <label className="mt-5 block text-[9px] font-black uppercase text-slate-400">Código de retirada
              <input type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={pickupCode} onChange={event => setPickupCode(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-4 text-center font-mono text-2xl font-black tracking-[0.35em] text-white outline-none focus:border-cyan-400" autoFocus />
            </label>
            {pickupError && <p className="mt-3 rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-[10px] leading-relaxed text-red-200">{pickupError}</p>}
            <button type="button" disabled={pickupBusy || !/^\d{6}$/.test(pickupCode)} onClick={() => void confirmPickupHandoff()} className="mt-5 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 text-[10px] font-black uppercase text-white disabled:opacity-40">
              {pickupBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              {pickupBusy ? 'Validando...' : 'Validar código e entregar'}
            </button>
          </section>
        </div>
      )}

      {routingOrder && (
        <div className="fixed inset-0 z-[146] flex items-end justify-center bg-slate-950/85 backdrop-blur-sm sm:items-center sm:p-5">
          <section className="w-full max-w-lg rounded-t-3xl border border-cyan-500/25 bg-slate-900 p-5 shadow-2xl sm:rounded-3xl">
            <div className="flex items-start justify-between gap-3">
              <div><span className="font-mono text-[9px] font-black uppercase tracking-wide text-cyan-300">Logística do pedido</span><h3 className="mt-1 text-lg font-black text-white">Como deseja realizar a entrega?</h3><p className="mt-2 text-[11px] leading-relaxed text-slate-400">A escolha é feita agora. Se você escolher Kyrub, a oportunidade será publicada para os entregadores quando clicar em “Iniciar preparo”.</p></div>
              <button type="button" onClick={() => setRoutingOrder(null)} className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-800 bg-slate-950 text-slate-500"><X className="h-4 w-4" /></button>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <button type="button" disabled={busyOrderId === routingOrder.id} onClick={() => void confirmDeliveryProvider('kyrub')} className="rounded-2xl border border-orange-500/30 bg-orange-500/10 p-4 text-left transition hover:bg-orange-500/20 disabled:opacity-40"><Truck className="h-5 w-5 text-orange-400" /><strong className="mt-2 block text-sm text-white">Solicitar entregador Kyrub</strong><span className="mt-1 block text-[10px] leading-relaxed text-slate-400">Vai para o mural de entregas ao iniciar o preparo.</span></button>
              <button type="button" disabled={busyOrderId === routingOrder.id} onClick={() => void confirmDeliveryProvider('merchant')} className="rounded-2xl border border-slate-700 bg-slate-950 p-4 text-left transition hover:border-slate-500 disabled:opacity-40"><UserRound className="h-5 w-5 text-cyan-300" /><strong className="mt-2 block text-sm text-white">Usar entregador próprio</strong><span className="mt-1 block text-[10px] leading-relaxed text-slate-400">O pedido continua no KDS, sem publicar corrida no Kyrub.</span></button>
            </div>
          </section>
        </div>
      )}

      {rejectingOrder && (
        <div className="fixed inset-0 z-[145] flex items-end justify-center bg-slate-950/85 backdrop-blur-sm sm:items-center sm:p-5">
          <section className="w-full max-w-lg rounded-t-3xl border border-red-500/25 bg-slate-900 p-5 shadow-2xl sm:rounded-3xl">
            <div className="flex items-start justify-between gap-3"><div><span className="font-mono text-[9px] font-black uppercase tracking-wide text-red-300">Recusar pedido</span><h3 className="mt-1 text-lg font-black text-white">Explique e sugira uma alternativa</h3></div><button type="button" onClick={() => setRejectingOrder(null)} className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-800 bg-slate-950 text-slate-500"><X className="h-4 w-4" /></button></div>
            <label className="mt-4 block text-[9px] font-black uppercase text-red-200">Motivo obrigatório<textarea value={rejectionReason} onChange={event => setRejectionReason(event.target.value)} rows={3} className="mt-1.5 w-full rounded-xl border border-red-500/20 bg-slate-950 px-3 py-2 text-[10px] normal-case text-white outline-none focus:border-red-400" /></label>
            <label className="mt-3 block text-[9px] font-black uppercase text-slate-500">Alternativa sugerida<input type="text" value={suggestedAlternative} onChange={event => setSuggestedAlternative(event.target.value)} placeholder="Ex.: trocar por um item semelhante disponível" className="mt-1.5 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-[10px] normal-case text-white outline-none focus:border-orange-500" /></label>
            <button type="button" onClick={() => void confirmRejection()} disabled={!rejectionReason.trim() || busyOrderId === rejectingOrder.id} className="mt-5 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-red-600 px-4 text-[10px] font-black uppercase text-white disabled:opacity-40"><XCircle className="h-4 w-4" />Confirmar recusa</button>
          </section>
        </div>
      )}
    </section>
  );
};
