import { useCallback, useEffect, useMemo, useState } from 'react';
import { auth } from '../../utils/firebase';
import type {
  StoreSalesAnalyticsPayload,
  StoreSalesAnalyticsPeriod,
  StoreSalesDimensionBucket,
  StoreSalesOrderStatus,
} from '../../../shared/storeSalesAnalytics';

const PERIODS: Array<{ key: StoreSalesAnalyticsPeriod; label: string }> = [
  { key: '24h', label: '24h' },
  { key: '7d', label: '7 dias' },
  { key: '30d', label: '30 dias' },
  { key: '90d', label: '90 dias' },
  { key: 'all', label: 'Tudo' },
];

const money = (minor: number): string =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(minor / 100);

const percent = (bps: number | null): string =>
  bps === null ? 'Sem base' : `${(bps / 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;

const dateTime = (value: string): string => {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date)
    : value;
};

const shortDate = (value: string): string => {
  const date = new Date(`${value}T12:00:00.000Z`);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' }).format(date)
    : value;
};

const statusLabel = (status: StoreSalesOrderStatus): string => ({
  pending: 'Pendente',
  accepted: 'Aceito',
  preparing: 'Em preparo',
  ready: 'Pronto',
  out_for_delivery: 'Em entrega',
  completed: 'Concluído',
  rejected: 'Rejeitado',
  cancelled: 'Cancelado',
}[status]);

const channelLabel = (key: string): string => ({
  kyrub: 'Kyrub',
  mercado_livre: 'Mercado Livre',
  '99food': '99Food',
  shopee: 'Shopee',
  ifood: 'iFood',
  instagram: 'Instagram',
  erp: 'ERP',
  other: 'Outro',
  unknown: 'Canal não informado',
}[key] ?? key);

const fulfillmentLabel = (key: string): string => ({
  delivery: 'Entrega',
  pickup: 'Retirada',
  dine_in: 'Consumo no local',
  unknown: 'Modalidade não informada',
}[key] ?? key);

const paymentLabel = (key: string): string => ({
  paid: 'Pago',
  partial: 'Parcial',
  unpaid: 'Não pago',
  unknown: 'Pagamento não informado',
}[key] ?? key);

const deltaLabel = (bps: number | null): string => {
  if (bps === null) return 'Sem base anterior comparável';
  if (bps === 0) return 'Sem variação';
  const sign = bps > 0 ? '+' : '';
  return `${sign}${(bps / 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% vs. período anterior`;
};

async function loadAnalytics(
  storeId: string,
  period: StoreSalesAnalyticsPeriod
): Promise<StoreSalesAnalyticsPayload> {
  const user = auth.currentUser;
  if (!user) throw new Error('Faça login novamente.');
  const token = await user.getIdToken();
  const response = await fetch(
    `/api/store-sales-analytics?storeId=${encodeURIComponent(storeId)}&period=${encodeURIComponent(period)}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (!contentType.includes('application/json')) {
    throw new Error('Vendas & Analytics respondeu em um formato inesperado.');
  }
  const payload = await response.json() as StoreSalesAnalyticsPayload & { error?: string };
  if (!response.ok) throw new Error(payload.error || 'Não foi possível carregar Vendas & Analytics.');
  return payload;
}

function MetricCard({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <article className="min-w-0 rounded-2xl border border-slate-800 bg-slate-950 p-4">
      <span className="text-[8px] font-black uppercase tracking-wide text-slate-500">{label}</span>
      <strong className="mt-2 block break-words text-lg text-white">{value}</strong>
      {note && <span className="mt-1 block text-[8px] leading-relaxed text-slate-600">{note}</span>}
    </article>
  );
}

function DimensionList({
  title,
  buckets,
  labelFor,
}: {
  title: string;
  buckets: StoreSalesDimensionBucket[];
  labelFor: (key: string) => string;
}) {
  const max = Math.max(1, ...buckets.map(bucket => bucket.salesMinor));
  return (
    <section className="min-w-0 rounded-3xl border border-slate-800 bg-slate-900 p-5">
      <h4 className="text-xs font-black uppercase text-white">{title}</h4>
      {buckets.length === 0 ? (
        <p className="mt-4 rounded-2xl border border-dashed border-slate-700 p-4 text-center text-[9px] text-slate-500">Sem vendas concluídas nesse recorte.</p>
      ) : (
        <div className="mt-4 space-y-3">
          {buckets.map(bucket => (
            <div key={bucket.key} className="min-w-0">
              <div className="flex min-w-0 items-center justify-between gap-3 text-[9px]">
                <span className="min-w-0 truncate font-bold text-slate-300">{labelFor(bucket.key)}</span>
                <span className="shrink-0 text-slate-500">{bucket.count} · {money(bucket.salesMinor)}</span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-800">
                <div className="h-full rounded-full bg-blue-400/70" style={{ width: `${Math.max(4, Math.round((bucket.salesMinor / max) * 100))}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function StoreSalesAnalyticsRuntime({ storeId }: { storeId: string }) {
  const [period, setPeriod] = useState<StoreSalesAnalyticsPeriod>('30d');
  const [payload, setPayload] = useState<StoreSalesAnalyticsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (nextPeriod = period, silent = false) => {
    if (!silent) setLoading(true);
    setError('');
    try {
      setPayload(await loadAnalytics(storeId, nextPeriod));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível carregar Vendas & Analytics.');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [period, storeId]);

  useEffect(() => { void load(period); }, [load, period]);

  const maxStatusCount = useMemo(
    () => Math.max(1, ...(payload?.statusFlow ?? []).map(bucket => bucket.count)),
    [payload]
  );
  const maxTrend = useMemo(
    () => Math.max(1, ...(payload?.trend ?? []).map(bucket => bucket.salesMinor)),
    [payload]
  );

  if (loading) {
    return <section className="rounded-3xl border border-blue-500/20 bg-slate-900 p-5 text-[10px] text-slate-400">Carregando vendas canônicas da loja…</section>;
  }

  if (error || !payload) {
    return (
      <section className="rounded-3xl border border-rose-500/25 bg-slate-900 p-5 text-white">
        <h3 className="text-sm font-black">Vendas & Analytics indisponível</h3>
        <p className="mt-2 text-[10px] text-rose-300">{error || 'Não foi possível carregar os indicadores.'}</p>
        <button type="button" onClick={() => void load(period)} className="mt-4 min-h-10 rounded-xl border border-slate-700 px-4 text-[9px] font-black uppercase">Tentar novamente</button>
      </section>
    );
  }

  const summary = payload.summary;

  return (
    <section className="max-w-full space-y-4 overflow-x-hidden text-white" data-kyrub-store-sales-analytics="canonical-orders">
      <div className="rounded-3xl border border-blue-500/25 bg-slate-900 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <span className="font-mono text-[9px] font-black uppercase tracking-[0.16em] text-blue-300">Vendas & Analytics</span>
            <h3 className="mt-1 text-base font-black">Desempenho comercial da loja</h3>
            <p className="mt-1 max-w-2xl text-[10px] leading-relaxed text-slate-400">Leitura dos pedidos canônicos e operacionais reais, deduplicados por pedido. Valores financeiros liquidados, taxas, estornos e repasses continuam no Financeiro Interno.</p>
          </div>
          <button type="button" onClick={() => void load(period, true)} className="min-h-10 rounded-xl border border-slate-700 bg-slate-950 px-4 text-[9px] font-black uppercase text-slate-300">Atualizar</button>
        </div>
        <div className="mt-4 flex max-w-full gap-2 overflow-x-auto pb-1">
          {PERIODS.map(option => (
            <button
              key={option.key}
              type="button"
              onClick={() => setPeriod(option.key)}
              className={`shrink-0 rounded-xl border px-3 py-2 text-[8px] font-black uppercase ${period === option.key ? 'border-blue-400/40 bg-blue-500/15 text-blue-200' : 'border-slate-800 bg-slate-950 text-slate-500'}`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Valor concluído" value={money(summary.completedSalesMinor)} note={payload.comparison ? deltaLabel(payload.comparison.completedSalesDeltaBps) : 'Pedidos concluídos no recorte'} />
        <MetricCard label="Pedidos concluídos" value={String(summary.completedOrders)} note={payload.comparison ? deltaLabel(payload.comparison.completedOrdersDeltaBps) : `${summary.totalOrders} pedido(s) no recorte`} />
        <MetricCard label="Ticket médio" value={money(summary.averageTicketMinor)} note="Somente pedidos concluídos" />
        <MetricCard label="Unidades vendidas" value={String(summary.unitsSold)} note="Desconta itens transferidos ou anulados" />
        <MetricCard label="Pedidos em aberto" value={String(summary.openOrders)} />
        <MetricCard label="Cancelados" value={String(summary.cancelledOrders)} note={`Taxa no recorte: ${percent(summary.cancellationRateBps)}`} />
        <MetricCard label="Rejeitados" value={String(summary.rejectedOrders)} />
        <MetricCard label="Conclusão terminal" value={percent(summary.terminalCompletionRateBps)} note="Concluídos ÷ pedidos já encerrados" />
      </div>

      <section className="rounded-3xl border border-slate-800 bg-slate-900 p-5">
        <div>
          <h4 className="text-xs font-black uppercase">Fluxo atual dos pedidos</h4>
          <p className="mt-1 text-[9px] leading-relaxed text-slate-500">Distribuição pelo estado atual. Não reconstrói etapas históricas que não estejam registradas no pedido.</p>
        </div>
        <div className="mt-4 space-y-3">
          {payload.statusFlow.map(bucket => (
            <div key={bucket.status}>
              <div className="flex items-center justify-between gap-3 text-[9px]">
                <span className="font-bold text-slate-300">{statusLabel(bucket.status)}</span>
                <span className="text-slate-500">{bucket.count} · {money(bucket.valueMinor)}</span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-800">
                <div className="h-full rounded-full bg-cyan-400/70" style={{ width: `${bucket.count ? Math.max(4, Math.round((bucket.count / maxStatusCount) * 100)) : 0}%` }} />
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-3xl border border-slate-800 bg-slate-900 p-5">
        <h4 className="text-xs font-black uppercase">Produtos com maior saída</h4>
        <p className="mt-1 text-[9px] text-slate-500">Ranking por unidades em pedidos concluídos; o valor abaixo é bruto por item antes de conciliações financeiras.</p>
        {payload.products.length === 0 ? (
          <p className="mt-4 rounded-2xl border border-dashed border-slate-700 p-4 text-center text-[9px] text-slate-500">Ainda não há itens concluídos nesse período.</p>
        ) : (
          <div className="mt-4 space-y-2">
            {payload.products.map((product, index) => (
              <article key={`${product.productId}:${product.name}`} className="flex min-w-0 items-center gap-3 rounded-2xl border border-slate-800 bg-slate-950 p-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-slate-800 text-[9px] font-black text-blue-300">{index + 1}</span>
                <div className="min-w-0 flex-1">
                  <strong className="block truncate text-[10px] text-white">{product.name}</strong>
                  <span className="mt-1 block text-[8px] text-slate-500">{product.units} un. · {product.orderCount} pedido(s)</span>
                </div>
                <span className="shrink-0 text-[9px] font-black text-slate-300">{money(product.grossMinor)}</span>
              </article>
            ))}
          </div>
        )}
      </section>

      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        <DimensionList title="Canais de venda" buckets={payload.channels} labelFor={channelLabel} />
        <DimensionList title="Modalidade de atendimento" buckets={payload.fulfillment} labelFor={fulfillmentLabel} />
      </div>

      <section className="rounded-3xl border border-slate-800 bg-slate-900 p-5">
        <h4 className="text-xs font-black uppercase">Tendência de vendas concluídas</h4>
        {payload.trend.length === 0 ? (
          <p className="mt-4 rounded-2xl border border-dashed border-slate-700 p-4 text-center text-[9px] text-slate-500">Sem histórico concluído nesse recorte.</p>
        ) : (
          <div className="mt-4 space-y-2">
            {payload.trend.map(bucket => (
              <div key={bucket.date} className="grid grid-cols-[44px_1fr_auto] items-center gap-2 text-[8px]">
                <span className="text-slate-500">{shortDate(bucket.date)}</span>
                <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                  <div className="h-full rounded-full bg-emerald-400/70" style={{ width: `${Math.max(4, Math.round((bucket.salesMinor / maxTrend) * 100))}%` }} />
                </div>
                <span className="whitespace-nowrap text-slate-400">{bucket.completedOrders} · {money(bucket.salesMinor)}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {payload.operators.some(bucket => bucket.key !== 'unknown') && (
        <DimensionList title="Vendas por operador identificado" buckets={payload.operators.filter(bucket => bucket.key !== 'unknown')} labelFor={key => key} />
      )}

      <section className="rounded-3xl border border-slate-800 bg-slate-900 p-5">
        <h4 className="text-xs font-black uppercase">Pedidos recentes</h4>
        {payload.recentOrders.length === 0 ? (
          <p className="mt-4 rounded-2xl border border-dashed border-slate-700 p-4 text-center text-[9px] text-slate-500">Nenhum pedido real encontrado nesse recorte.</p>
        ) : (
          <div className="mt-4 space-y-2">
            {payload.recentOrders.map(order => (
              <article key={order.orderId} className="min-w-0 rounded-2xl border border-slate-800 bg-slate-950 p-3">
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <strong className="block truncate text-[10px] text-white">{order.buyerName || 'Cliente não informado'}</strong>
                    <span className="mt-1 block break-all font-mono text-[8px] text-slate-600">{order.orderId}</span>
                  </div>
                  <span className="shrink-0 text-[10px] font-black text-slate-200">{money(order.totalMinor)}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5 text-[7px] font-black uppercase">
                  <span className="rounded-full border border-slate-700 px-2 py-1 text-slate-400">{statusLabel(order.status)}</span>
                  <span className="rounded-full border border-slate-700 px-2 py-1 text-slate-400">{channelLabel(order.sourceChannel)}</span>
                  <span className="rounded-full border border-slate-700 px-2 py-1 text-slate-400">{fulfillmentLabel(order.fulfillmentType)}</span>
                  <span className="rounded-full border border-slate-700 px-2 py-1 text-slate-400">{paymentLabel(order.paymentStatus)}</span>
                </div>
                <span className="mt-2 block text-[8px] text-slate-600">{dateTime(order.occurredAt)}</span>
              </article>
            ))}
          </div>
        )}
      </section>
    </section>
  );
}
