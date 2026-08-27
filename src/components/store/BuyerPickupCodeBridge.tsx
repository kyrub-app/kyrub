import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { KeyRound, LoaderCircle } from 'lucide-react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from '../../utils/firebase';
import { recordCurrentUserActivityEvent } from '../../observability/kyrubActivityBrowser';
import { resolveKyrubAppRoute } from '../../utils/appRoutes';
import { subscribeToPublishedStorefrontBySlug } from '../../utils/publicStorefront';
import {
  subscribeToStoreCustomerOrders,
  type CustomerOrder,
} from '../../utils/customerOrders';

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

const BuyerPickupCode = ({ user, slug }: { user: User; slug: string }) => {
  const [storeId, setStoreId] = useState('');
  const [orders, setOrders] = useState<CustomerOrder[]>([]);
  const [codes, setCodes] = useState<Record<string, PickupCodePayload>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [host, setHost] = useState<HTMLElement | null>(null);
  const requestedOrderIds = useRef(new Set<string>());

  useEffect(() =>
    subscribeToPublishedStorefrontBySlug(
      slug,
      store => setStoreId(store?.id ?? ''),
      error => console.warn('Vitrine indisponível para retirada.', error)
    ), [slug]);

  useEffect(() => {
    setOrders([]);
    requestedOrderIds.current.clear();
    setCodes({});
    setErrors({});
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
    for (const id of [...requestedOrderIds.current]) {
      if (!activeIds.has(id)) requestedOrderIds.current.delete(id);
    }
    setCodes(current => {
      const entries = Object.entries(current).filter(([id]) => activeIds.has(id));
      return entries.length === Object.keys(current).length
        ? current
        : Object.fromEntries(entries);
    });
    setErrors(current => {
      const entries = Object.entries(current).filter(([id]) => activeIds.has(id));
      return entries.length === Object.keys(current).length
        ? current
        : Object.fromEntries(entries);
    });
  }, [orders]);

  useEffect(() => {
    if (!storeId) return;
    for (const order of orders) {
      if (requestedOrderIds.current.has(order.id)) continue;
      requestedOrderIds.current.add(order.id);
      void readPickupCode(user, storeId, order.id)
        .then(payload => {
          setCodes(current => ({ ...current, [order.id]: payload }));
          recordCurrentUserActivityEvent({
            type: 'result.action_succeeded',
            domain: 'order',
            source: 'authoritative_write_ack',
            screenId: 'storefront:pickup',
            actionId: 'pickup.code_read',
            entityType: 'order',
            entityId: order.id,
          });
        })
        .catch(error => {
          setErrors(current => ({
            ...current,
            [order.id]: error instanceof Error ? error.message : 'Código indisponível.',
          }));
          recordCurrentUserActivityEvent({
            type: 'result.action_failed',
            domain: 'order',
            source: 'client_observation',
            screenId: 'storefront:pickup',
            actionId: 'pickup.code_read',
            entityType: 'order',
            entityId: order.id,
          });
        });
    }
  }, [orders, storeId, user]);

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
                <span className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 font-mono text-xl font-black tracking-[0.22em] text-cyan-200">{codes[order.id].code}</span>
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

export function BuyerPickupCodeBridge() {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const route = useMemo(() => resolveKyrubAppRoute(window.location.pathname), []);

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  if (!user || route.kind !== 'public-storefront') return null;
  return <BuyerPickupCode user={user} slug={route.slug} />;
}
