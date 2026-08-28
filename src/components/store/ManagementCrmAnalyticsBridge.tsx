import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  BarChart3,
  CalendarDays,
  Crown,
  Mail,
  Search,
  ShoppingBag,
  TrendingUp,
  UserRound,
  UsersRound,
  X,
} from 'lucide-react';
import type { CustomerOrder } from '../../utils/customerOrders';

type Props = {
  orders: CustomerOrder[];
};

type CustomerSummary = {
  id: string;
  name: string;
  email: string;
  orderCount: number;
  paidOrderCount: number;
  totalSpent: number;
  averageTicket: number;
  firstOrderAt: string;
  lastOrderAt: string;
  favoriteProduct: string;
  fulfillmentTypes: Set<string>;
};

const money = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

const dateFormatter = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

const validDate = (value: string): Date | null => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const sameLocalDay = (left: Date, right: Date): boolean =>
  left.getFullYear() === right.getFullYear() &&
  left.getMonth() === right.getMonth() &&
  left.getDate() === right.getDate();

const isCommercialOrder = (order: CustomerOrder): boolean =>
  order.status !== 'cancelled' && order.status !== 'rejected';

const isRevenueOrder = (order: CustomerOrder): boolean =>
  isCommercialOrder(order) && order.paymentStatus === 'paid';

const buildCustomers = (orders: CustomerOrder[]): CustomerSummary[] => {
  const map = new Map<
    string,
    CustomerSummary & { productCounts: Map<string, number> }
  >();

  orders.filter(isCommercialOrder).forEach(order => {
    const key = order.buyerId || order.buyerEmail.toLocaleLowerCase('pt-BR');
    if (!key) return;

    const current = map.get(key) ?? {
      id: key,
      name: order.buyerName || 'Cliente',
      email: order.buyerEmail,
      orderCount: 0,
      paidOrderCount: 0,
      totalSpent: 0,
      averageTicket: 0,
      firstOrderAt: order.createdAt,
      lastOrderAt: order.createdAt,
      favoriteProduct: '',
      fulfillmentTypes: new Set<string>(),
      productCounts: new Map<string, number>(),
    };

    current.name = order.buyerName || current.name;
    current.email = order.buyerEmail || current.email;
    current.orderCount += 1;
    current.fulfillmentTypes.add(order.fulfillmentType);

    if (isRevenueOrder(order)) {
      current.paidOrderCount += 1;
      current.totalSpent += order.total;
    }

    const createdAt = validDate(order.createdAt)?.getTime() ?? 0;
    const firstAt = validDate(current.firstOrderAt)?.getTime() ?? createdAt;
    const lastAt = validDate(current.lastOrderAt)?.getTime() ?? createdAt;
    if (createdAt && (!firstAt || createdAt < firstAt)) current.firstOrderAt = order.createdAt;
    if (createdAt >= lastAt) current.lastOrderAt = order.createdAt;

    order.items.forEach(item => {
      current.productCounts.set(
        item.name,
        (current.productCounts.get(item.name) ?? 0) + item.quantity
      );
    });

    map.set(key, current);
  });

  return Array.from(map.values())
    .map(customer => {
      const favoriteProduct = Array.from(customer.productCounts.entries()).sort(
        (left, right) => right[1] - left[1]
      )[0]?.[0] ?? '';
      return {
        id: customer.id,
        name: customer.name,
        email: customer.email,
        orderCount: customer.orderCount,
        paidOrderCount: customer.paidOrderCount,
        totalSpent: customer.totalSpent,
        averageTicket:
          customer.paidOrderCount > 0
            ? customer.totalSpent / customer.paidOrderCount
            : 0,
        firstOrderAt: customer.firstOrderAt,
        lastOrderAt: customer.lastOrderAt,
        favoriteProduct,
        fulfillmentTypes: customer.fulfillmentTypes,
      } satisfies CustomerSummary;
    })
    .sort((left, right) => right.totalSpent - left.totalSpent);
};

const customerSegment = (
  customer: CustomerSummary,
  now: Date
): { label: string; className: string } => {
  const last = validDate(customer.lastOrderAt);
  const inactiveDays = last
    ? Math.floor((now.getTime() - last.getTime()) / 86_400_000)
    : 0;

  if (customer.totalSpent >= 500 || customer.paidOrderCount >= 8) {
    return { label: 'VIP', className: 'border-amber-400/30 bg-amber-400/10 text-amber-300' };
  }
  if (inactiveDays >= 60) {
    return { label: 'Inativo', className: 'border-slate-600 bg-slate-800 text-slate-400' };
  }
  if (customer.orderCount >= 2) {
    return { label: 'Recorrente', className: 'border-teal-400/30 bg-teal-400/10 text-teal-300' };
  }
  return { label: 'Novo', className: 'border-blue-400/30 bg-blue-400/10 text-blue-300' };
};

function SalesAnalytics({ orders }: Props) {
  const now = new Date();
  const revenueOrders = useMemo(() => orders.filter(isRevenueOrder), [orders]);
  const todayOrders = useMemo(
    () =>
      revenueOrders.filter(order => {
        const createdAt = validDate(order.createdAt);
        return createdAt ? sameLocalDay(createdAt, now) : false;
      }),
    [revenueOrders, now.getDate(), now.getMonth(), now.getFullYear()]
  );
  const todayRevenue = todayOrders.reduce((sum, order) => sum + order.total, 0);
  const averageTicket =
    todayOrders.length > 0 ? todayRevenue / todayOrders.length : 0;
  const uniqueCustomers = new Set(revenueOrders.map(order => order.buyerId).filter(Boolean)).size;

  const dailySeries = useMemo(() => {
    return Array.from({ length: 15 }, (_, index) => {
      const day = new Date();
      day.setHours(0, 0, 0, 0);
      day.setDate(day.getDate() - (14 - index));
      const value = revenueOrders.reduce((sum, order) => {
        const createdAt = validDate(order.createdAt);
        return createdAt && sameLocalDay(createdAt, day) ? sum + order.total : sum;
      }, 0);
      return { day, value };
    });
  }, [revenueOrders]);

  const maxDaily = Math.max(1, ...dailySeries.map(item => item.value));
  const topProducts = useMemo(() => {
    const totals = new Map<string, { quantity: number; revenue: number }>();
    revenueOrders.forEach(order => {
      order.items.forEach(item => {
        const current = totals.get(item.name) ?? { quantity: 0, revenue: 0 };
        current.quantity += item.quantity;
        current.revenue += item.quantity * item.price;
        totals.set(item.name, current);
      });
    });
    return Array.from(totals.entries())
      .sort((left, right) => right[1].revenue - left[1].revenue)
      .slice(0, 5);
  }, [revenueOrders]);

  const fulfillment = useMemo(() => {
    const counts = { pickup: 0, delivery: 0, dine_in: 0 };
    revenueOrders.forEach(order => {
      counts[order.fulfillmentType] += 1;
    });
    return counts;
  }, [revenueOrders]);

  return (
    <section className="space-y-4 rounded-3xl border border-slate-800 bg-slate-900 p-4 sm:p-5" id="canonical-sales-analytics">
      <header className="flex items-start justify-between gap-3 border-b border-slate-800 pb-3">
        <div>
          <span className="text-[9px] font-black uppercase tracking-[.16em] text-blue-400">Dados reais</span>
          <h4 className="mt-1 text-sm font-black uppercase text-white">Vendas & Analytics</h4>
          <p className="mt-1 text-[10px] leading-relaxed text-slate-500">Pedidos pagos do fluxo canônico da loja. Cancelados e recusados não entram no faturamento.</p>
        </div>
        <BarChart3 className="h-5 w-5 shrink-0 text-blue-400" />
      </header>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Metric label="Vendas hoje" value={money.format(todayRevenue)} />
        <Metric label="Ticket médio" value={money.format(averageTicket)} />
        <Metric label="Pedidos pagos hoje" value={`${todayOrders.length}`} />
        <Metric label="Clientes únicos" value={`${uniqueCustomers}`} />
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-950 p-3">
        <div className="mb-3 flex items-center justify-between gap-2">
          <span className="text-[9px] font-black uppercase text-slate-500">Faturamento · últimos 15 dias</span>
          <strong className="text-[10px] text-blue-300">{money.format(dailySeries.reduce((sum, item) => sum + item.value, 0))}</strong>
        </div>
        <div className="flex h-28 items-end gap-1.5">
          {dailySeries.map(item => (
            <div key={item.day.toISOString()} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`${dateFormatter.format(item.day)} · ${money.format(item.value)}`}>
              <div className="w-full rounded-t bg-blue-500/80" style={{ height: `${Math.max(4, (item.value / maxDaily) * 100)}%` }} />
              <span className="hidden text-[7px] text-slate-600 sm:block">{item.day.getDate()}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-slate-800 bg-slate-950 p-3">
          <h5 className="mb-2 text-[9px] font-black uppercase text-slate-500">Produtos por faturamento</h5>
          <div className="space-y-2">
            {topProducts.length > 0 ? topProducts.map(([name, data], index) => (
              <div key={name} className="flex items-center justify-between gap-3 text-[10px]">
                <span className="min-w-0 truncate text-slate-300">{index + 1}. {name}</span>
                <span className="shrink-0 font-mono text-emerald-400">{money.format(data.revenue)}</span>
              </div>
            )) : <EmptyLine text="Ainda não há vendas pagas." />}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-950 p-3">
          <h5 className="mb-2 text-[9px] font-black uppercase text-slate-500">Origem operacional</h5>
          <div className="space-y-2 text-[10px]">
            <Distribution label="Retirada" value={fulfillment.pickup} total={revenueOrders.length} />
            <Distribution label="Entrega" value={fulfillment.delivery} total={revenueOrders.length} />
            <Distribution label="No local" value={fulfillment.dine_in} total={revenueOrders.length} />
          </div>
        </div>
      </div>
    </section>
  );
}

function CrmModal({ orders, onClose }: Props & { onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [segment, setSegment] = useState<'all' | 'new' | 'recurring' | 'vip' | 'inactive'>('all');
  const now = new Date();
  const customers = useMemo(() => buildCustomers(orders), [orders]);
  const visibleCustomers = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('pt-BR');
    return customers.filter(customer => {
      const currentSegment = customerSegment(customer, now).label.toLocaleLowerCase('pt-BR');
      if (segment !== 'all') {
        const expected = segment === 'new' ? 'novo' : segment === 'recurring' ? 'recorrente' : segment === 'vip' ? 'vip' : 'inativo';
        if (currentSegment !== expected) return false;
      }
      if (!normalized) return true;
      return `${customer.name} ${customer.email} ${customer.favoriteProduct}`.toLocaleLowerCase('pt-BR').includes(normalized);
    });
  }, [customers, query, segment]);

  const recurring = customers.filter(customer => customer.orderCount >= 2).length;
  const vip = customers.filter(customer => customerSegment(customer, now).label === 'VIP').length;

  return createPortal(
    <div className="fixed inset-0 z-[140] flex items-center justify-center bg-slate-950/90 p-3 backdrop-blur-md" role="dialog" aria-modal="true" aria-label="CRM da loja">
      <section className="flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-slate-800 bg-slate-900 shadow-2xl">
        <header className="flex items-start justify-between gap-3 border-b border-slate-800 bg-slate-950 px-4 py-4 sm:px-5">
          <div>
            <span className="text-[9px] font-black uppercase tracking-[.16em] text-teal-400">Relacionamento</span>
            <h3 className="mt-1 text-lg font-black uppercase text-white">CRM</h3>
            <p className="mt-1 text-[10px] text-slate-500">Base formada automaticamente pelos clientes que já compraram ou fizeram pedidos na loja.</p>
          </div>
          <button type="button" onClick={onClose} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-800 bg-slate-900 text-slate-400" aria-label="Fechar CRM"><X className="h-5 w-5" /></button>
        </header>

        <div className="grid grid-cols-3 gap-2 border-b border-slate-800 px-4 py-3 sm:px-5">
          <Metric label="Clientes" value={`${customers.length}`} />
          <Metric label="Recorrentes" value={`${recurring}`} />
          <Metric label="VIP" value={`${vip}`} />
        </div>

        <div className="space-y-3 border-b border-slate-800 px-4 py-3 sm:px-5">
          <label className="flex min-h-11 items-center gap-2 rounded-2xl border border-slate-800 bg-slate-950 px-3">
            <Search className="h-4 w-4 text-slate-500" />
            <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar cliente, e-mail ou produto..." className="min-w-0 flex-1 bg-transparent text-xs text-white outline-none placeholder:text-slate-600" />
          </label>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {([
              ['all', 'Todos'], ['new', 'Novos'], ['recurring', 'Recorrentes'], ['vip', 'VIP'], ['inactive', 'Inativos'],
            ] as const).map(([value, label]) => (
              <button key={value} type="button" onClick={() => setSegment(value)} className={`min-h-9 shrink-0 rounded-xl border px-3 text-[9px] font-black uppercase ${segment === value ? 'border-teal-400/40 bg-teal-400/10 text-teal-300' : 'border-slate-800 bg-slate-950 text-slate-500'}`}>{label}</button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
          {visibleCustomers.length > 0 ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {visibleCustomers.map(customer => {
                const badge = customerSegment(customer, now);
                const lastDate = validDate(customer.lastOrderAt);
                return (
                  <article key={customer.id} className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-teal-500/10 text-teal-300"><UserRound className="h-5 w-5" /></div>
                        <div className="min-w-0">
                          <h4 className="truncate text-xs font-black text-white">{customer.name}</h4>
                          <p className="mt-0.5 flex items-center gap-1 truncate text-[9px] text-slate-500"><Mail className="h-3 w-3 shrink-0" />{customer.email || 'E-mail não informado'}</p>
                        </div>
                      </div>
                      <span className={`shrink-0 rounded-full border px-2 py-1 text-[8px] font-black uppercase ${badge.className}`}>{badge.label}</span>
                    </div>

                    <div className="mt-3 grid grid-cols-3 gap-2 border-y border-slate-800 py-3 text-center">
                      <SmallMetric label="Pedidos" value={`${customer.orderCount}`} />
                      <SmallMetric label="Total pago" value={money.format(customer.totalSpent)} />
                      <SmallMetric label="Ticket" value={money.format(customer.averageTicket)} />
                    </div>

                    <div className="mt-3 space-y-1.5 text-[9px] text-slate-500">
                      <p className="flex items-center gap-1.5"><CalendarDays className="h-3 w-3" />Última compra: <span className="text-slate-300">{lastDate ? dateFormatter.format(lastDate) : '—'}</span></p>
                      <p className="flex items-center gap-1.5"><ShoppingBag className="h-3 w-3" />Mais comprado: <span className="min-w-0 truncate text-slate-300">{customer.favoriteProduct || '—'}</span></p>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="rounded-3xl border border-dashed border-slate-800 bg-slate-950/50 px-5 py-12 text-center"><UsersRound className="mx-auto h-8 w-8 text-slate-700" /><p className="mt-3 text-xs font-black uppercase text-slate-500">Nenhum cliente nesta combinação</p></div>
          )}
        </div>
      </section>
    </div>,
    document.body
  );
}

export function ManagementCrmAnalyticsBridge({ orders }: Props) {
  const [crmHost, setCrmHost] = useState<HTMLElement | null>(null);
  const [salesHost, setSalesHost] = useState<HTMLElement | null>(null);
  const [crmOpen, setCrmOpen] = useState(false);

  useEffect(() => {
    let disposed = false;
    let timer = 0;
    let crmButtonHost: HTMLDivElement | null = null;
    let canonicalSalesHost: HTMLDivElement | null = null;
    let hiddenSalesContainer: HTMLElement | null = null;
    let previousSalesDisplay = '';

    const synchronize = (): void => {
      if (disposed) return;
      const root = document.getElementById('erp-gerencial-tab');
      if (!root) {
        setCrmHost(null);
        setSalesHost(null);
        timer = window.setTimeout(synchronize, 80);
        return;
      }

      const menuGrid = Array.from(root.children).find(child => child instanceof HTMLElement && child.classList.contains('grid')) as HTMLElement | undefined;
      if (menuGrid && !document.getElementById('kyrub-management-crm-card-host')) {
        crmButtonHost = document.createElement('div');
        crmButtonHost.id = 'kyrub-management-crm-card-host';
        crmButtonHost.className = 'contents';
        menuGrid.appendChild(crmButtonHost);
        setCrmHost(crmButtonHost);
      } else if (!menuGrid) {
        crmButtonHost?.remove();
        crmButtonHost = null;
        setCrmHost(null);
      }

      const salesHeading = Array.from(root.querySelectorAll('h4')).find(heading => heading.textContent?.trim().toLocaleUpperCase('pt-BR') === 'GERENCIAL: SALES');
      const salesContainer = salesHeading?.closest('.bg-slate-900');
      if (salesContainer instanceof HTMLElement && !canonicalSalesHost) {
        hiddenSalesContainer = salesContainer;
        previousSalesDisplay = salesContainer.style.display;
        salesContainer.style.display = 'none';
        canonicalSalesHost = document.createElement('div');
        canonicalSalesHost.id = 'kyrub-canonical-sales-analytics-host';
        salesContainer.parentElement?.insertBefore(canonicalSalesHost, salesContainer);
        setSalesHost(canonicalSalesHost);
      }
      if (!salesHeading && canonicalSalesHost) {
        if (hiddenSalesContainer?.isConnected) hiddenSalesContainer.style.display = previousSalesDisplay;
        canonicalSalesHost.remove();
        canonicalSalesHost = null;
        hiddenSalesContainer = null;
        previousSalesDisplay = '';
        setSalesHost(null);
      }

      timer = window.setTimeout(synchronize, 120);
    };

    timer = window.setTimeout(synchronize, 0);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      crmButtonHost?.remove();
      if (hiddenSalesContainer?.isConnected) hiddenSalesContainer.style.display = previousSalesDisplay;
      canonicalSalesHost?.remove();
      setCrmHost(null);
      setSalesHost(null);
    };
  }, []);

  return (
    <>
      {crmHost && createPortal(
        <button type="button" onClick={() => setCrmOpen(true)} className="group h-full w-full rounded-3xl border border-slate-800 bg-slate-900 p-5 text-left transition-all hover:border-teal-500/30">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-teal-500/20 bg-teal-500/10 text-teal-400"><UsersRound className="h-5 w-5" /></div>
          <div className="mt-2">
            <div className="flex items-center justify-between gap-2"><h4 className="text-xs font-black uppercase text-white transition-colors group-hover:text-teal-300">CRM</h4><span className="rounded-full border border-teal-400/20 bg-teal-400/10 px-2 py-0.5 text-[8px] font-black text-teal-300">{buildCustomers(orders).length}</span></div>
            <p className="mt-0.5 text-[10px] leading-relaxed text-slate-400">Base de clientes, recorrência, ticket, histórico e segmentação comercial.</p>
          </div>
        </button>,
        crmHost
      )}
      {salesHost && createPortal(<SalesAnalytics orders={orders} />, salesHost)}
      {crmOpen && <CrmModal orders={orders} onClose={() => setCrmOpen(false)} />}
    </>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl border border-slate-800 bg-slate-950 p-3 text-center"><span className="block text-[8px] font-black uppercase text-slate-500">{label}</span><strong className="mt-1 block truncate text-[11px] font-mono text-white">{value}</strong></div>;
}

function SmallMetric({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><span className="block text-[7px] font-black uppercase text-slate-600">{label}</span><strong className="mt-1 block truncate text-[9px] text-slate-300">{value}</strong></div>;
}

function Distribution({ label, value, total }: { label: string; value: number; total: number }) {
  const percent = total > 0 ? Math.round((value / total) * 100) : 0;
  return <div><div className="mb-1 flex justify-between gap-2"><span className="text-slate-400">{label}</span><strong className="text-slate-300">{value} · {percent}%</strong></div><div className="h-1.5 overflow-hidden rounded-full bg-slate-800"><div className="h-full rounded-full bg-blue-500" style={{ width: `${percent}%` }} /></div></div>;
}

function EmptyLine({ text }: { text: string }) {
  return <p className="text-[10px] text-slate-600">{text}</p>;
}
