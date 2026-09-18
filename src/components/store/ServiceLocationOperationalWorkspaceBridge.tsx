import { useEffect, useMemo, useState } from 'react';
import { MapPin, ReceiptText, UserRound, X } from 'lucide-react';
import {
  resolveOrderServiceLocation,
  serviceLocationIdentityKey,
  type ResolvedOrderServiceLocation,
} from '../../../shared/serviceLocation';
import { AttendanceOrderApproval } from '../customer/AttendanceOrderApproval';
import { InPersonCustomerLinker } from './InPersonCustomerLinker';
import { InPersonOrderComposer } from './InPersonOrderComposer';
import { ServiceLocationRequestPanel } from './ServiceLocationRequestPanel';
import { auth } from '../../utils/firebase';
import {
  getCustomerOrderOutstandingTotal,
  getCustomerOrderStatusLabel,
  isTerminalCustomerOrderStatus,
  subscribeToStoreCustomerOrders,
  type CustomerOrder,
} from '../../utils/customerOrders';
import {
  SERVICE_LOCATION_WORKSPACE_OPEN_EVENT,
  type ServiceLocationWorkspaceOpenRequest,
} from '../../utils/serviceLocationWorkspace';

const currency = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

const kindLabel = (location: ResolvedOrderServiceLocation): string => {
  switch (location.kind) {
    case 'counter': return 'Balcão';
    case 'parking_spot': return 'Vaga';
    case 'room': return 'Quarto';
    case 'chair': return 'Cadeira';
    case 'box': return 'Box';
    case 'service_window': return 'Guichê';
    case 'table': return 'Mesa';
    default: return 'Local de atendimento';
  }
};

const orderMatchesLocation = (
  order: CustomerOrder,
  location: ResolvedOrderServiceLocation
): boolean => {
  if (order.fulfillmentType !== 'dine_in') return false;
  const orderLocation = resolveOrderServiceLocation({
    serviceLocation: order.serviceLocation,
    tableCode: order.tableCode,
  });
  return Boolean(
    orderLocation &&
    serviceLocationIdentityKey(orderLocation) === serviceLocationIdentityKey(location)
  );
};

export function ServiceLocationOperationalWorkspaceBridge() {
  const [selection, setSelection] = useState<ServiceLocationWorkspaceOpenRequest | null>(null);
  const [orders, setOrders] = useState<CustomerOrder[]>([]);
  const [message, setMessage] = useState('');

  useEffect(() => {
    const handleOpen = (event: Event): void => {
      const detail = (event as CustomEvent<ServiceLocationWorkspaceOpenRequest>).detail;
      const user = auth.currentUser;
      if (
        !detail?.storeId?.trim() ||
        !detail?.location ||
        !user ||
        user.uid !== detail.storeId.trim()
      ) {
        return;
      }
      setSelection({
        storeId: detail.storeId.trim(),
        location: detail.location,
      });
      setMessage('');
    };

    window.addEventListener(SERVICE_LOCATION_WORKSPACE_OPEN_EVENT, handleOpen);
    return () => {
      window.removeEventListener(SERVICE_LOCATION_WORKSPACE_OPEN_EVENT, handleOpen);
    };
  }, []);

  useEffect(() => {
    setOrders([]);
    if (!selection) return;
    const user = auth.currentUser;
    if (!user || user.uid !== selection.storeId) {
      setSelection(null);
      return;
    }
    return subscribeToStoreCustomerOrders(
      selection.storeId,
      setOrders,
      error => {
        console.warn('Atendimento do local indisponível.', error);
        setMessage('Não foi possível atualizar os pedidos deste local.');
      }
    );
  }, [selection?.storeId]);

  const activeOrders = useMemo(() => {
    if (!selection) return [];
    return orders
      .filter(order =>
        orderMatchesLocation(order, selection.location) &&
        !isTerminalCustomerOrderStatus(order.status)
      )
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }, [orders, selection]);

  const outstanding = useMemo(
    () => activeOrders.reduce(
      (sum, order) => sum + getCustomerOrderOutstandingTotal(order),
      0
    ),
    [activeOrders]
  );

  const hasStaffOrder = useMemo(
    () => activeOrders.some(order => order.source === 'staff'),
    [activeOrders]
  );

  if (!selection) return null;

  const { location, storeId } = selection;
  const notify = (text: string): void => setMessage(text);

  return (
    <>
      <div className="fixed inset-0 z-[120] flex items-end justify-center bg-slate-950/90 backdrop-blur-sm sm:items-center sm:p-5">
        <section
          id="kyrub-service-location-operational-workspace"
          className="max-h-[94vh] w-full max-w-3xl overflow-y-auto rounded-t-3xl border border-orange-500/25 bg-slate-900 p-4 shadow-2xl sm:rounded-3xl sm:p-6"
        >
          <header className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-orange-500 text-slate-950">
                <MapPin className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <span className="font-mono text-[9px] font-black uppercase tracking-[0.18em] text-orange-300">
                  {kindLabel(location)} · Atendimento local
                </span>
                <h2 className="mt-1 truncate text-xl font-black text-white">
                  {location.label}
                </h2>
                <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
                  Pedidos e conta operacional deste local. Pagamento e transferência permanecem fora deste workspace enquanto a convergência financeira não for generalizada para Service Locations.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setSelection(null)}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-800 bg-slate-950 text-slate-400 hover:text-white"
              aria-label="Fechar atendimento do local"
            >
              <X className="h-4 w-4" />
            </button>
          </header>

          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-slate-800 bg-slate-950 p-3">
              <ReceiptText className="h-4 w-4 text-orange-300" />
              <strong className="mt-2 block text-lg font-black text-white">
                {activeOrders.length}
              </strong>
              <span className="text-[8px] font-black uppercase text-slate-500">
                Pedido{activeOrders.length === 1 ? '' : 's'} ativo{activeOrders.length === 1 ? '' : 's'}
              </span>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-950 p-3">
              <strong className="block font-mono text-lg text-white">
                {currency.format(outstanding)}
              </strong>
              <span className="mt-2 block text-[8px] font-black uppercase text-slate-500">
                Saldo operacional aberto
              </span>
            </div>
            <div className="col-span-2 rounded-2xl border border-slate-800 bg-slate-950 p-3 sm:col-span-1">
              <MapPin className="h-4 w-4 text-cyan-300" />
              <strong className="mt-2 block truncate text-xs text-white">
                {location.source === 'canonical' ? location.id : 'compatibilidade legada'}
              </strong>
              <span className="text-[8px] font-black uppercase text-slate-500">
                Identidade do local
              </span>
            </div>
          </div>

          <ServiceLocationRequestPanel
            storeId={storeId}
            location={location}
          />

          <div className="mt-5 space-y-2">
            {activeOrders.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-950/60 px-4 py-8 text-center text-[10px] text-slate-500">
                Não há pedidos ativos neste local.
              </div>
            ) : activeOrders.map(order => (
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
                  </div>
                  <span className="rounded-full border border-slate-700 bg-slate-900 px-2 py-1 text-[8px] font-black uppercase text-slate-300">
                    {getCustomerOrderStatusLabel(order.status)}
                  </span>
                </div>
                <div className="mt-3 flex items-center justify-between border-t border-white/5 pt-3 text-[9px] text-slate-500">
                  <span>{order.items.length} item(ns)</span>
                  <strong className="font-mono text-xs text-white">
                    {currency.format(getCustomerOrderOutstandingTotal(order))}
                  </strong>
                </div>
              </article>
            ))}
          </div>

          {hasStaffOrder && (
            <InPersonCustomerLinker
              storeId={storeId}
              orders={activeOrders}
            />
          )}

          {location.source === 'canonical' && (
            <div className="mt-5">
              <InPersonOrderComposer
                storeId={storeId}
                lockedServiceLocationId={location.id}
                heading={`Adicionar pedido · ${location.label}`}
                embedded
              />
            </div>
          )}

          {message && (
            <p className="mt-4 rounded-xl border border-cyan-500/20 bg-cyan-500/10 px-3 py-2 text-[9px] text-cyan-100" role="status">
              {message}
            </p>
          )}
        </section>
      </div>

      <AttendanceOrderApproval
        storeId={storeId}
        serviceLocation={location}
        orders={orders}
        notify={notify}
      />
    </>
  );
}
