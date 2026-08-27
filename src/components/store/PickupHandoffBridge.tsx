import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
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
import { resolveKyrubAppRoute } from '../../utils/appRoutes';
import { subscribeToPublishedStorefrontBySlug } from '../../utils/publicStorefront';
import {
  subscribeToStoreCustomerOrders,
  type CustomerOrder,
} from '../../utils/customerOrders';
import { updateOrderStatusWithDecision } from '../../utils/orderWorkflow';

interface PickupCodePayload {
  orderId: string;
  code: string;
  readyAt: string;
}

const formatDateTime = (value: string): string => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Horário indisponível'
    : new Intl.DateTimeFormat('pt-BR', {
        dateStyle: 'short',
        timeStyle: 'short',
      }).format(date);
};

const readyPickupOrders = (orders: CustomerOrder[]): CustomerOrder[] =>
  orders
    .filter(
      order => order.fulfillmentType === 'pickup' && order.status === 'ready'
    )
    .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt));

const readPickupCode = async (
  user: User,
  storeId: string,
  orderId: string
): Promise<PickupCodePayload> => {
  const token = await user.getIdToken();
  const response = await fetch('/api/health?transport=pickup-code-read', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ storeId, orderId }),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      typeof payload.error === 'string'
        ? payload.error
        : 'Não foi possível carregar o código de retirada.'
    );
  }
  const code = typeof payload.code === 'string' ? payload.code.trim() : '';
  if (!/^\d{6}$/.test(code)) {
    throw new Error('O código de retirada ainda não está disponível.');
  }
  return {
    orderId,
    code,
    readyAt: typeof payload.readyAt === 'string' ? payload.readyAt : '',
  };
};

const StaffPickupQueue = ({ user }: { user: User }) => {
  const [orders, setOrders] = useState<CustomerOrder[]>([]);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<CustomerOrder | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() =>
    subscribeToStoreCustomerOrders(
      user.uid,
      nextOrders => setOrders(readyPickupOrders(nextOrders)),
      subscriptionError => {
        console.warn('Fila de retirada indisponível.', subscriptionError);
        setOrders([]);
      }
    ), [user.uid]);

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    let pickupHost: HTMLDivElement | null = null;

    const attach = (): void => {
      if (cancelled) return;
      const inboxHost = document.getElementById('kyrub-customer-order-inbox-host');
      if (!inboxHost?.parentElement) {
        timer = window.setTimeout(attach, 80);
        return;
      }
      pickupHost = document.createElement('div');
      pickupHost.id = 'kyrub-pickup-handoff-queue-host';
      pickupHost.className = 'mt-5 min-w-0';
      inboxHost.insertAdjacentElement('afterend', pickupHost);
      setHost(pickupHost);
    };

    attach();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      pickupHost?.remove();
      setHost(null);
    };
  }, []);

  useEffect(() => {
    const protectLegacyCompletion = (): void => {
      document
        .querySelectorAll<HTMLButtonElement>('#kyrub-customer-order-inbox-host button')
        .forEach(button => {
          const label = button.textContent?.trim().toLocaleLowerCase('pt-BR') ?? '';
          if (!label.includes('concluir pedido')) return;
          const article = button.closest('article');
          const cardText = article?.textContent?.toLocaleUpperCase('pt-BR') ?? '';
          if (cardText.includes('RETIRADA')) {
            if (article instanceof HTMLElement) article.style.display = 'none';
            button.disabled = true;
            button.setAttribute('aria-hidden', 'true');
          }
        });
    };

    protectLegacyCompletion();
    const observer = new MutationObserver(protectLegacyCompletion);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [orders]);

  const confirmHandoff = async (): Promise<void> => {
    if (!selectedOrder || !/^\d{6}$/.test(code)) return;
    setBusy(true);
    setError('');
    try {
      await updateOrderStatusWithDecision(
        user.uid,
        selectedOrder.id,
        'completed',
        { handoffCode: code }
      );
      setSelectedOrder(null);
      setCode('');
    } catch (handoffError) {
      setError(
        handoffError instanceof Error
          ? handoffError.message
          : 'Não foi possível confirmar a retirada.'
      );
    } finally {
      setBusy(false);
    }
  };

  if (!host) return null;

  return createPortal(
    <>
      <section className="space-y-4 rounded-3xl border border-cyan-500/25 bg-slate-900/80 p-4 shadow-xl sm:p-5" id="kyrub-pickup-handoff-queue">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <span className="font-mono text-[9px] font-black uppercase tracking-[0.18em] text-cyan-300">
              Retiradas · Balcão
            </span>
            <h3 className="mt-1 flex items-center gap-2 text-base font-black text-white">
              <PackageCheck className="h-5 w-5 text-cyan-300" />
              Aguardando retirada
            </h3>
            <p className="mt-1 text-[11px] text-slate-500">
              O preparo terminou. O pedido só é finalizado depois da confirmação do código do cliente.
            </p>
          </div>
          <span className="w-fit rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 font-mono text-[10px] font-black text-cyan-200">
            {orders.length} no balcão
          </span>
        </div>

        {orders.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-950/60 px-4 py-8 text-center">
            <ShoppingBag className="mx-auto h-8 w-8 text-slate-700" />
            <p className="mt-2 text-[10px] font-black uppercase text-slate-500">
              Nenhum pedido aguardando retirada
            </p>
          </div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {orders.map(order => (
              <article key={order.id} className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <span className="font-mono text-[8px] font-black uppercase tracking-wide text-cyan-300">
                      Pedido pronto · Retirada
                    </span>
                    <h4 className="mt-1 truncate text-sm font-black text-white">{order.buyerName}</h4>
                    <span className="mt-1 flex items-center gap-1.5 text-[10px] text-slate-500">
                      <Clock3 className="h-3 w-3" />
                      pronto em {formatDateTime(order.updatedAt)}
                    </span>
                  </div>
                  <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[9px] font-black uppercase text-emerald-300">
                    Pronto
                  </span>
                </div>

                <div className="mt-3 space-y-1.5 rounded-xl border border-slate-800 bg-slate-900/70 p-3 text-[10px] text-slate-400">
                  <p className="flex items-center gap-2"><UserRound className="h-3.5 w-3.5" />{order.buyerEmail || order.buyerName}</p>
                  <p>{order.items.map(item => `${item.quantity - item.transferredQuantity}× ${item.name}`).join(' · ')}</p>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setSelectedOrder(order);
                    setCode('');
                    setError('');
                  }}
                  className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-cyan-500 px-4 text-[10px] font-black uppercase text-slate-950 hover:bg-cyan-400"
                >
                  <ShieldCheck className="h-4 w-4" />
                  Entregar pedido
                </button>
              </article>
            ))}
          </div>
        )}
      </section>

      {selectedOrder && (
        <div className="fixed inset-0 z-[160] flex items-end justify-center bg-slate-950/90 backdrop-blur-md sm:items-center sm:p-5">
          <section className="w-full max-w-md rounded-t-3xl border border-cyan-500/25 bg-slate-900 p-5 shadow-2xl sm:rounded-3xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <span className="font-mono text-[9px] font-black uppercase tracking-[0.16em] text-cyan-300">Handoff seguro</span>
                <h3 className="mt-1 text-lg font-black text-white">Confirmar retirada</h3>
                <p className="mt-1 text-[11px] text-slate-400">Peça ao cliente o código de 6 dígitos exibido no Kyrub.</p>
              </div>
              <button type="button" disabled={busy} onClick={() => setSelectedOrder(null)} className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-800 bg-slate-950 text-slate-500 disabled:opacity-40"><X className="h-4 w-4" /></button>
            </div>

            <label className="mt-5 block text-[9px] font-black uppercase text-slate-400">
              Código de retirada
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-4 text-center font-mono text-2xl font-black tracking-[0.35em] text-white outline-none focus:border-cyan-400"
                autoFocus
              />
            </label>

            {error && (
              <p className="mt-3 rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-[10px] leading-relaxed text-red-200">{error}</p>
            )}

            <button
              type="button"
              disabled={busy || !/^\d{6}$/.test(code)}
              onClick={() => void confirmHandoff()}
              className="mt-5 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 text-[10px] font-black uppercase text-white disabled:opacity-40"
            >
              {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              {busy ? 'Validando...' : 'Validar e entregar'}
            </button>
          </section>
        </div>
      )}
    </>,
    host
  );
};

const BuyerPickupCode = ({ user, slug }: { user: User; slug: string }) => {
  const [storeId, setStoreId] = useState('');
  const [orders, setOrders] = useState<CustomerOrder[]>([]);
  const [codes, setCodes] = useState<Record<string, PickupCodePayload>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() =>
    subscribeToPublishedStorefrontBySlug(
      slug,
      store => setStoreId(store?.id ?? ''),
      error => console.warn('Vitrine indisponível para retirada.', error)
    ), [slug]);

  useEffect(() => {
    setOrders([]);
    if (!storeId) return;
    return subscribeToStoreCustomerOrders(
      storeId,
      nextOrders => setOrders(
        readyPickupOrders(nextOrders).filter(order => order.buyerId === user.uid)
      ),
      error => console.warn('Pedido de retirada indisponível para o comprador.', error)
    );
  }, [storeId, user.uid]);

  useEffect(() => {
    const activeIds = new Set(orders.map(order => order.id));
    setCodes(current => Object.fromEntries(Object.entries(current).filter(([id]) => activeIds.has(id))));
    setErrors(current => Object.fromEntries(Object.entries(current).filter(([id]) => activeIds.has(id))));

    for (const order of orders) {
      if (codes[order.id] || errors[order.id] || !storeId) continue;
      void readPickupCode(user, storeId, order.id)
        .then(payload => setCodes(current => ({ ...current, [order.id]: payload })))
        .catch(error => setErrors(current => ({
          ...current,
          [order.id]: error instanceof Error ? error.message : 'Código indisponível.',
        })));
    }
  }, [codes, errors, orders, storeId, user]);

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    let codeHost: HTMLDivElement | null = null;
    const attach = (): void => {
      if (cancelled) return;
      const shell = document.getElementById('public-storefront-shell');
      const header = shell?.querySelector('header');
      if (!shell || !header) {
        timer = window.setTimeout(attach, 80);
        return;
      }
      codeHost = document.createElement('div');
      codeHost.id = 'kyrub-buyer-pickup-code-host';
      header.insertAdjacentElement('afterend', codeHost);
      setHost(codeHost);
    };
    attach();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      codeHost?.remove();
      setHost(null);
    };
  }, []);

  if (!host || orders.length === 0) return null;

  return createPortal(
    <section className="border-b border-cyan-500/20 bg-cyan-500/[0.06] px-3 py-4 sm:px-5">
      <div className="mx-auto w-full max-w-5xl space-y-3 rounded-3xl border border-cyan-500/25 bg-slate-900 p-4 shadow-xl">
        <div>
          <span className="font-mono text-[8px] font-black uppercase tracking-[0.18em] text-cyan-300">Seu pedido está pronto</span>
          <h2 className="mt-1 flex items-center gap-2 text-sm font-black text-white"><KeyRound className="h-4 w-4 text-cyan-300" />Código para retirada no balcão</h2>
          <p className="mt-1 text-[10px] leading-relaxed text-slate-400">Mostre este código somente quando receber o pedido. O atendente não consegue concluir a retirada sem ele.</p>
        </div>

        {orders.map(order => (
          <div key={order.id} className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <strong className="block truncate text-xs text-white">{order.items.map(item => item.name).join(' · ')}</strong>
                <span className="mt-1 block text-[9px] text-slate-500">Pronto em {formatDateTime(order.updatedAt)}</span>
              </div>
              {codes[order.id] ? (
                <span className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 font-mono text-xl font-black tracking-[0.22em] text-cyan-200">
                  {codes[order.id].code}
                </span>
              ) : errors[order.id] ? (
                <span className="max-w-[48%] text-right text-[9px] leading-relaxed text-red-300">{errors[order.id]}</span>
              ) : (
                <LoaderCircle className="h-5 w-5 animate-spin text-cyan-300" />
              )}
            </div>
          </div>
        ))}
      </div>
    </section>,
    host
  );
};

export function PickupHandoffBridge() {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const route = useMemo(() => resolveKyrubAppRoute(window.location.pathname), []);

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  if (!user) return null;
  if (route.kind === 'staff-app') return <StaffPickupQueue user={user} />;
  if (route.kind === 'public-storefront') {
    return <BuyerPickupCode user={user} slug={route.slug} />;
  }
  return null;
}
