import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  CalendarClock,
  CheckCircle2,
  Clock3,
  KeyRound,
  LoaderCircle,
  PackageCheck,
  ShieldCheck,
  ShoppingBag,
  UserRound,
  X,
} from 'lucide-react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from '../../utils/firebase';
import {
  getCustomerOrderOutstandingTotal,
  getCustomerOrderPaymentStatusLabel,
  subscribeToStoreCustomerOrders,
  type CustomerOrder,
} from '../../utils/customerOrders';
import { updateOrderStatusWithDecision } from '../../utils/orderWorkflow';

const currency = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

const isPickupWaiting = (order: CustomerOrder): boolean =>
  order.fulfillmentType === 'pickup' && order.status === 'ready';

const formatDateTime = (value: string): string => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Horário indisponível'
    : new Intl.DateTimeFormat('pt-BR', {
        dateStyle: 'short',
        timeStyle: 'short',
      }).format(date);
};

const normalizedLabel = (element: Element): string =>
  (element.textContent ?? '').trim().toLocaleUpperCase('pt-BR');

interface NavigationHosts {
  pickupTab: HTMLElement | null;
  scheduledChip: HTMLElement | null;
  pickupQueue: HTMLElement | null;
  scheduledButton: HTMLButtonElement | null;
}

const emptyHosts: NavigationHosts = {
  pickupTab: null,
  scheduledChip: null,
  pickupQueue: null,
  scheduledButton: null,
};

export function PickupPdvNavigationBridge() {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [orders, setOrders] = useState<CustomerOrder[]>([]);
  const [hosts, setHosts] = useState<NavigationHosts>(emptyHosts);
  const [pickupActive, setPickupActive] = useState(false);
  const [scheduledActive, setScheduledActive] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<CustomerOrder | null>(null);
  const [pickupCode, setPickupCode] = useState('');
  const [pickupError, setPickupError] = useState('');
  const [pickupBusy, setPickupBusy] = useState(false);

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  useEffect(() => {
    setOrders([]);
    if (!user) return;
    return subscribeToStoreCustomerOrders(
      user.uid,
      setOrders,
      error => console.warn('Fila de retirada do PDV indisponível.', error)
    );
  }, [user]);

  const pickupOrders = useMemo(
    () =>
      orders
        .filter(isPickupWaiting)
        .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt)),
    [orders]
  );

  useEffect(() => {
    let disposed = false;
    let cleanupListeners: (() => void) | null = null;

    const install = (): void => {
      if (disposed) return;
      cleanupListeners?.();
      cleanupListeners = null;

      const clients = document.getElementById('erp-clientes-tab');
      if (!clients) {
        setHosts(emptyHosts);
        return;
      }

      const scheduledButton = Array.from(
        clients.querySelectorAll<HTMLButtonElement>('button')
      ).find(button => normalizedLabel(button) === 'AGENDADOS');

      const tabRow = scheduledButton?.parentElement;
      if (!scheduledButton || !tabRow) {
        setHosts(emptyHosts);
        return;
      }

      scheduledButton.style.display = 'none';
      scheduledButton.setAttribute('aria-hidden', 'true');

      let pickupTabHost = document.getElementById('kyrub-pdv-pickup-tab-host');
      if (!(pickupTabHost instanceof HTMLElement)) {
        pickupTabHost = document.createElement('span');
        pickupTabHost.id = 'kyrub-pdv-pickup-tab-host';
        pickupTabHost.className = 'contents';
        tabRow.insertBefore(pickupTabHost, scheduledButton);
      }

      let scheduledChipHost = document.getElementById('kyrub-pdv-scheduled-chip-host');
      if (!(scheduledChipHost instanceof HTMLElement)) {
        scheduledChipHost = document.createElement('div');
        scheduledChipHost.id = 'kyrub-pdv-scheduled-chip-host';
        scheduledChipHost.className = 'mt-2 min-w-0';
        tabRow.insertAdjacentElement('afterend', scheduledChipHost);
      }

      let pickupQueueHost = document.getElementById('kyrub-pdv-pickup-queue-host');
      if (!(pickupQueueHost instanceof HTMLElement)) {
        pickupQueueHost = document.createElement('div');
        pickupQueueHost.id = 'kyrub-pdv-pickup-queue-host';
        pickupQueueHost.className = 'min-w-0';
        scheduledChipHost.insertAdjacentElement('afterend', pickupQueueHost);
      }

      const nativeButtons = Array.from(
        tabRow.querySelectorAll<HTMLButtonElement>('button')
      ).filter(button => button !== scheduledButton);
      const handleNativeTab = (): void => {
        setPickupActive(false);
        setScheduledActive(false);
      };
      nativeButtons.forEach(button => button.addEventListener('click', handleNativeTab));
      cleanupListeners = () => {
        nativeButtons.forEach(button => button.removeEventListener('click', handleNativeTab));
      };

      setHosts({
        pickupTab: pickupTabHost,
        scheduledChip: scheduledChipHost,
        pickupQueue: pickupQueueHost,
        scheduledButton,
      });
    };

    install();
    const observer = new MutationObserver(install);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      disposed = true;
      observer.disconnect();
      cleanupListeners?.();
      const scheduledButton = hosts.scheduledButton;
      if (scheduledButton?.isConnected) {
        scheduledButton.style.display = '';
        scheduledButton.removeAttribute('aria-hidden');
      }
      document.getElementById('kyrub-pdv-pickup-tab-host')?.remove();
      document.getElementById('kyrub-pdv-scheduled-chip-host')?.remove();
      document.getElementById('kyrub-pdv-pickup-queue-host')?.remove();
    };
  }, []);

  useEffect(() => {
    const clients = document.getElementById('erp-clientes-tab');
    if (!clients) return;

    const board = document.getElementById('kyrub-customer-table-board-host');
    const emptyState = document.getElementById('empty-clients');
    const fiscalButton = Array.from(
      clients.querySelectorAll<HTMLButtonElement>('button')
    ).find(button => normalizedLabel(button).includes('FATURAR & TRANSMITIR FISCAL'));
    const ticketGrid = fiscalButton?.closest('.grid') as HTMLElement | null;

    const targets = [board, emptyState, ticketGrid].filter(
      (element): element is HTMLElement => element instanceof HTMLElement
    );
    const previous = new Map(targets.map(element => [element, element.style.display]));

    if (pickupActive) {
      targets.forEach(element => {
        element.style.display = 'none';
      });
    }

    return () => {
      previous.forEach((display, element) => {
        if (element.isConnected) element.style.display = display;
      });
    };
  }, [pickupActive, orders.length]);

  useEffect(() => {
    const normalizeKds = (): void => {
      const kds = document.getElementById('kyrub-customer-order-inbox-host');
      if (!kds) return;

      const buttons = Array.from(kds.querySelectorAll<HTMLButtonElement>('button'));
      const pickupStage = buttons.find(button => /^RETIRADA(?:\s*\(\d+\))?$/.test(normalizedLabel(button)));
      if (pickupStage) {
        const activePickup = pickupStage.className.includes('bg-cyan-500');
        if (activePickup) {
          buttons.find(button => normalizedLabel(button) === 'ATIVOS')?.click();
        }
        pickupStage.style.display = 'none';
        pickupStage.setAttribute('aria-hidden', 'true');
      }

      kds.querySelectorAll<HTMLElement>('article').forEach(article => {
        if (normalizedLabel(article).includes('AGUARDANDO RETIRADA')) {
          article.style.display = 'none';
          article.setAttribute('aria-hidden', 'true');
        }
      });
    };

    normalizeKds();
    const observer = new MutationObserver(normalizeKds);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  const openPickup = (): void => {
    hosts.scheduledButton?.click();
    setScheduledActive(false);
    setPickupActive(true);
  };

  const openScheduled = (): void => {
    setPickupActive(false);
    setScheduledActive(true);
    hosts.scheduledButton?.click();
  };

  const openHandoff = (order: CustomerOrder): void => {
    setSelectedOrder(order);
    setPickupCode('');
    setPickupError('');
  };

  const confirmHandoff = async (): Promise<void> => {
    if (!user || !selectedOrder || !/^\d{6}$/.test(pickupCode)) return;
    setPickupBusy(true);
    setPickupError('');
    try {
      await updateOrderStatusWithDecision(
        user.uid,
        selectedOrder.id,
        'completed',
        { handoffCode: pickupCode }
      );
      setSelectedOrder(null);
      setPickupCode('');
    } catch (error) {
      setPickupError(
        error instanceof Error
          ? error.message
          : 'Não foi possível confirmar a retirada.'
      );
    } finally {
      setPickupBusy(false);
    }
  };

  return (
    <>
      {hosts.pickupTab &&
        createPortal(
          <button
            type="button"
            onClick={openPickup}
            className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer ${
              pickupActive
                ? 'bg-cyan-500 text-slate-950'
                : 'bg-slate-900 text-slate-400 hover:text-slate-300'
            }`}
            id="kyrub-pdv-pickup-tab"
          >
            Retirada{pickupOrders.length > 0 ? ` (${pickupOrders.length})` : ''}
          </button>,
          hosts.pickupTab
        )}

      {hosts.scheduledChip &&
        createPortal(
          <button
            type="button"
            onClick={openScheduled}
            className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-[9px] font-black uppercase tracking-wide transition-colors ${
              scheduledActive
                ? 'border-orange-500/40 bg-orange-500/10 text-orange-300'
                : 'border-slate-800 bg-slate-950 text-slate-500 hover:text-slate-300'
            }`}
            id="kyrub-pdv-scheduled-filter"
            title="Atendimentos agendados"
          >
            <CalendarClock className="h-3.5 w-3.5" />
            Agendados
          </button>,
          hosts.scheduledChip
        )}

      {hosts.pickupQueue && pickupActive &&
        createPortal(
          <section className="space-y-4" id="kyrub-pdv-pickup-queue">
            <div className="rounded-2xl border border-cyan-500/25 bg-cyan-500/[0.06] p-4">
              <span className="flex items-center gap-2 text-[9px] font-black uppercase tracking-wide text-cyan-300">
                <ShieldCheck className="h-4 w-4" />
                Balcão de retirada
              </span>
              <p className="mt-1 text-[10px] leading-relaxed text-cyan-100/70">
                Pedidos prontos ficam aqui até o cliente informar o código de 6 dígitos.
              </p>
            </div>

            {pickupOrders.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-slate-800 bg-slate-900/40 px-5 py-10 text-center">
                <ShoppingBag className="mx-auto h-8 w-8 text-slate-700" />
                <p className="mt-2 text-[10px] font-black uppercase text-slate-500">
                  Nenhum pedido aguardando retirada
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {pickupOrders.map(order => {
                  const outstanding = getCustomerOrderOutstandingTotal(order);
                  return (
                    <article
                      key={order.id}
                      className="overflow-hidden rounded-3xl border border-cyan-500/30 bg-slate-950"
                    >
                      <div className="flex items-start justify-between gap-3 border-b border-slate-800 p-4">
                        <div className="min-w-0">
                          <span className="font-mono text-[9px] font-black uppercase tracking-wide text-cyan-300">
                            Retirada · pedido pronto
                          </span>
                          <h4 className="mt-1 truncate text-sm font-black text-white">
                            {order.buyerName}
                          </h4>
                          <span className="mt-1 flex items-center gap-1.5 text-[10px] text-slate-500">
                            <Clock3 className="h-3 w-3" />
                            pronto em {formatDateTime(order.updatedAt)}
                          </span>
                        </div>
                        <span className="rounded-full border border-cyan-500/25 bg-cyan-500/10 px-2.5 py-1 text-center text-[9px] font-black uppercase text-cyan-200">
                          Aguardando retirada
                        </span>
                      </div>

                      <div className="space-y-3 p-4">
                        <div className="space-y-2 rounded-2xl border border-slate-800 bg-slate-900/70 p-3">
                          {order.items.map(item => (
                            <div key={item.lineId} className="flex items-start justify-between gap-3 text-[10px]">
                              <strong className="text-slate-200">
                                {item.quantity - item.transferredQuantity}× {item.name}
                              </strong>
                              <span className="font-mono text-slate-500">
                                {currency.format(item.price * (item.quantity - item.transferredQuantity))}
                              </span>
                            </div>
                          ))}
                        </div>

                        <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-3 text-[10px] text-slate-400">
                          <p className="flex items-center gap-2">
                            <UserRound className="h-3.5 w-3.5 text-slate-500" />
                            {order.buyerEmail || order.buyerName}
                          </p>
                        </div>

                        <div className="flex items-end justify-between gap-3 border-t border-slate-800 pt-3">
                          <div>
                            <span className="block font-mono text-[8px] uppercase text-slate-600">
                              Saldo do pedido
                            </span>
                            <strong className="font-mono text-base text-white">
                              {currency.format(outstanding)}
                            </strong>
                          </div>
                          <span className="rounded-lg bg-emerald-500/10 px-2.5 py-1 text-[9px] font-bold uppercase text-emerald-300">
                            {getCustomerOrderPaymentStatusLabel(order.paymentStatus)}
                          </span>
                        </div>
                      </div>

                      <div className="border-t border-cyan-500/20 bg-cyan-500/[0.05] p-3">
                        <button
                          type="button"
                          onClick={() => openHandoff(order)}
                          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-cyan-500 px-4 text-[10px] font-black uppercase text-slate-950 hover:bg-cyan-400"
                        >
                          <KeyRound className="h-4 w-4" />
                          Entregar pedido
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>,
          hosts.pickupQueue
        )}

      {selectedOrder && (
        <div className="fixed inset-0 z-[170] flex items-end justify-center bg-slate-950/90 backdrop-blur-md sm:items-center sm:p-5">
          <section className="w-full max-w-md rounded-t-3xl border border-cyan-500/25 bg-slate-900 p-5 shadow-2xl sm:rounded-3xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <span className="font-mono text-[9px] font-black uppercase tracking-[0.16em] text-cyan-300">
                  Handoff seguro
                </span>
                <h3 className="mt-1 text-lg font-black text-white">Confirmar retirada</h3>
                <p className="mt-1 text-[11px] text-slate-400">
                  Peça ao cliente o código de 6 dígitos exibido no Kyrub.
                </p>
              </div>
              <button
                type="button"
                disabled={pickupBusy}
                onClick={() => setSelectedOrder(null)}
                className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-800 bg-slate-950 text-slate-500 disabled:opacity-40"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <label className="mt-5 block text-[9px] font-black uppercase text-slate-400">
              Código de retirada
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={pickupCode}
                onChange={event =>
                  setPickupCode(event.target.value.replace(/\D/g, '').slice(0, 6))
                }
                placeholder="000000"
                className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-4 text-center font-mono text-2xl font-black tracking-[0.35em] text-white outline-none focus:border-cyan-400"
                autoFocus
              />
            </label>

            {pickupError && (
              <p className="mt-3 rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-[10px] leading-relaxed text-red-200">
                {pickupError}
              </p>
            )}

            <button
              type="button"
              disabled={pickupBusy || !/^\d{6}$/.test(pickupCode)}
              onClick={() => void confirmHandoff()}
              className="mt-5 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 text-[10px] font-black uppercase text-white disabled:opacity-40"
            >
              {pickupBusy ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
              {pickupBusy ? 'Validando...' : 'Validar código e entregar'}
            </button>
          </section>
        </div>
      )}
    </>
  );
}
