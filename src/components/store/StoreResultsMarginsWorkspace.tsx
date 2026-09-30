import { useCallback, useEffect, useMemo, useState } from 'react';
import { auth } from '../../utils/firebase';

type DataStatus = 'complete' | 'partial';
type FinancialState = 'captured' | 'refunded' | 'charged_back' | 'chargeback_reversed' | 'mixed';
type InventoryState = 'consumed' | 'reversed' | 'skipped' | 'missing';

type OrderProfitability = {
  orderId: string;
  dataStatus: DataStatus;
  financialState: FinancialState;
  inventoryState: InventoryState;
  merchandiseRevenueMinor: number | null;
  storeDiscountMinor: number | null;
  storeObservedVariableCostsMinor: number | null;
  saleCmvMinor: number | null;
  contributionMinor: number | null;
  contributionMarginPercent: number | null;
  effectiveMarginAvailable: boolean;
  occurredAt: string;
};

type OrderOverview = {
  storeId: string;
  currency: 'BRL';
  sourceEntriesTruncated: boolean;
  items: OrderProfitability[];
  reconciliationErrors: Array<{ orderId: string; code: string }>;
  summary: {
    orderCount: number;
    completeCount: number;
    partialCount: number;
    effectiveMarginCount: number;
    knownMerchandiseRevenueMinor: number;
    knownSaleCmvMinor: number;
    effectiveRevenueMinor: number;
    effectiveContributionMinor: number;
    effectiveContributionMarginPercent: number | null;
  };
  error?: string;
};

type ProductProfitability = {
  productId: string;
  name: string;
  orderCount: number;
  soldQuantity: number;
  merchandiseRevenueMinor: number | null;
  saleCmvMinor: number | null;
  grossContributionMinor: number | null;
  realizedMarginPercent: number | null;
  targetMarginPercent: number | null;
  marginGapPercentagePoints: number | null;
  completeOrderCount: number;
  effectiveOrderCount: number;
  partialOrderCount: number;
};

type ProductOverview = {
  storeId: string;
  currency: 'BRL';
  products: ProductProfitability[];
  error?: string;
};

type ProductFilter = 'all' | 'above' | 'below' | 'partial';
type OrderFilter = 'all' | 'effective' | 'partial';

const money = (minor: number | null): string =>
  minor === null
    ? 'Dados parciais'
    : new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
      }).format(minor / 100);

const percent = (value: number | null): string =>
  value === null
    ? '—'
    : `${new Intl.NumberFormat('pt-BR', {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      }).format(value)}%`;

const percentagePoints = (value: number | null): string =>
  value === null
    ? 'Sem meta histórica'
    : `${value >= 0 ? '+' : ''}${new Intl.NumberFormat('pt-BR', {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      }).format(value)} p.p.`;

const dateTime = (value: string): string => {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('pt-BR', {
        dateStyle: 'short',
        timeStyle: 'short',
      }).format(date)
    : value;
};

const financialStateLabel = (state: FinancialState): string => ({
  captured: 'Recebido',
  refunded: 'Reembolsado',
  charged_back: 'Chargeback',
  chargeback_reversed: 'Chargeback revertido',
  mixed: 'Ciclo financeiro misto',
}[state]);

const inventoryStateLabel = (state: InventoryState): string => ({
  consumed: 'Estoque consumido',
  reversed: 'Estoque revertido',
  skipped: 'Sem baixa física',
  missing: 'Estoque sem evidência',
}[state]);

const productFilterLabel = (filter: ProductFilter): string => ({
  all: 'Todos',
  above: 'Acima da meta',
  below: 'Abaixo da meta',
  partial: 'Parciais',
}[filter]);

const orderFilterLabel = (filter: OrderFilter): string => ({
  all: 'Todos',
  effective: 'Margem efetiva',
  partial: 'Parciais',
}[filter]);

const statusClass = (active: boolean): string =>
  active
    ? 'border-emerald-400/40 bg-emerald-400/15 text-emerald-100'
    : 'border-slate-700 bg-slate-950 text-slate-400';

async function authorizedJson<T extends { error?: string }>(url: string): Promise<T> {
  const user = auth.currentUser;
  if (!user) throw new Error('Faça login novamente.');
  const token = await user.getIdToken();
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (!contentType.includes('application/json')) {
    throw new Error('Resultados & Margens respondeu em um formato inesperado.');
  }
  const payload = await response.json() as T;
  if (!response.ok) {
    throw new Error(payload.error || 'Não foi possível carregar Resultados & Margens.');
  }
  return payload;
}

async function loadProfitability(storeId: string): Promise<{
  orders: OrderOverview;
  products: ProductOverview;
}> {
  const query = `storeId=${encodeURIComponent(storeId)}`;
  const [orders, products] = await Promise.all([
    authorizedJson<OrderOverview>(`/api/store-finance/profitability?${query}`),
    authorizedJson<ProductOverview>(`/api/store-finance/profitability/products?${query}`),
  ]);
  return { orders, products };
}

export default function StoreResultsMarginsWorkspace({ storeId }: { storeId: string }) {
  const [orders, setOrders] = useState<OrderOverview | null>(null);
  const [products, setProducts] = useState<ProductOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [productFilter, setProductFilter] = useState<ProductFilter>('all');
  const [orderFilter, setOrderFilter] = useState<OrderFilter>('all');

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError('');
    try {
      const result = await loadProfitability(storeId);
      setOrders(result.orders);
      setProducts(result.products);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Não foi possível carregar Resultados & Margens.'
      );
    } finally {
      if (!silent) setLoading(false);
    }
  }, [storeId]);

  useEffect(() => { void load(); }, [load]);

  const filteredProducts = useMemo(() => {
    const rows = products?.products ?? [];
    return rows.filter(product => {
      if (productFilter === 'partial') {
        return product.partialOrderCount > 0 || product.realizedMarginPercent === null;
      }
      if (productFilter === 'above') {
        return product.marginGapPercentagePoints !== null
          && product.marginGapPercentagePoints >= 0;
      }
      if (productFilter === 'below') {
        return product.marginGapPercentagePoints !== null
          && product.marginGapPercentagePoints < 0;
      }
      return true;
    });
  }, [productFilter, products]);

  const filteredOrders = useMemo(() => {
    const rows = orders?.items ?? [];
    return rows.filter(order => {
      if (orderFilter === 'effective') return order.effectiveMarginAvailable;
      if (orderFilter === 'partial') return order.dataStatus === 'partial';
      return true;
    });
  }, [orderFilter, orders]);

  if (loading) {
    return (
      <section
        className="rounded-3xl border border-emerald-500/20 bg-slate-900 p-5 text-[10px] text-slate-400"
        data-kyrub-results-margins="loading"
      >
        Consolidando receita, CMV e margens reais…
      </section>
    );
  }

  if (error) {
    return (
      <section className="rounded-3xl border border-rose-500/25 bg-slate-900 p-5 text-white">
        <h3 className="text-sm font-black">Resultados & Margens indisponível</h3>
        <p className="mt-2 text-[10px] leading-relaxed text-rose-300">{error}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-4 min-h-10 rounded-xl border border-slate-700 px-4 text-[9px] font-black uppercase"
        >
          Tentar novamente
        </button>
      </section>
    );
  }

  const summary = orders?.summary;

  return (
    <section
      className="max-w-full space-y-4 overflow-x-hidden text-white"
      data-kyrub-results-margins="canonical"
    >
      <header className="overflow-hidden rounded-3xl border border-emerald-500/25 bg-slate-900 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <span className="font-mono text-[9px] font-black uppercase tracking-[0.16em] text-emerald-300">
              Financeiro · Resultados & Margens
            </span>
            <h3 className="mt-1 text-base font-black">Resultado econômico da operação</h3>
            <p className="mt-2 max-w-3xl text-[10px] leading-relaxed text-slate-400">
              Receita líquida de mercadorias, CMV histórico e margem são reconciliados com fatos canônicos da venda e do estoque. Dados incompletos permanecem como parciais — o Kyrub não preenche lacunas com estimativas.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load(true)}
            className="min-h-10 rounded-xl border border-slate-700 bg-slate-950 px-4 text-[9px] font-black uppercase text-slate-300"
          >
            Atualizar
          </button>
        </div>
      </header>

      <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <article className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
          <span className="text-[8px] font-black uppercase text-slate-500">Receita efetiva de mercadorias</span>
          <strong className="mt-2 block text-lg">{money(summary?.effectiveRevenueMinor ?? 0)}</strong>
          <span className="mt-1 block text-[8px] text-slate-500">Frete não entra como receita da loja.</span>
        </article>
        <article className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
          <span className="text-[8px] font-black uppercase text-slate-500">CMV conhecido</span>
          <strong className="mt-2 block text-lg">{money(summary?.knownSaleCmvMinor ?? 0)}</strong>
          <span className="mt-1 block text-[8px] text-slate-500">Custo histórico congelado no consumo do estoque.</span>
        </article>
        <article className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
          <span className="text-[8px] font-black uppercase text-slate-500">Contribuição efetiva</span>
          <strong className="mt-2 block text-lg">{money(summary?.effectiveContributionMinor ?? 0)}</strong>
          <span className="mt-1 block text-[8px] text-slate-500">Já considera custos variáveis observados e suportados pela loja no pedido.</span>
        </article>
        <article className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
          <span className="text-[8px] font-black uppercase text-slate-500">Margem de contribuição</span>
          <strong className="mt-2 block text-lg">{percent(summary?.effectiveContributionMarginPercent ?? null)}</strong>
          <span className="mt-1 block text-[8px] text-slate-500">{summary?.effectiveMarginCount ?? 0} pedido(s) com margem efetiva.</span>
        </article>
      </div>

      <div className="rounded-3xl border border-cyan-500/20 bg-slate-900 p-5" data-kyrub-product-margins="canonical">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <span className="font-mono text-[9px] font-black uppercase tracking-[0.16em] text-cyan-300">Produtos</span>
            <h4 className="mt-1 text-xs font-black uppercase">Margem realizada × margem desejada</h4>
            <p className="mt-2 max-w-3xl text-[9px] leading-relaxed text-slate-400">
              A margem do produto usa somente receita líquida da mercadoria e CMV daquele produto. Taxas do provedor e outros custos gerais do pedido permanecem no resultado do pedido; eles não são rateados entre produtos por uma regra artificial.
            </p>
          </div>
        </div>

        <div className="mt-4 flex max-w-full gap-2 overflow-x-auto pb-1">
          {(['all', 'above', 'below', 'partial'] as ProductFilter[]).map(filter => (
            <button
              key={filter}
              type="button"
              onClick={() => setProductFilter(filter)}
              className={`min-h-9 shrink-0 rounded-full border px-3 text-[8px] font-black uppercase ${statusClass(productFilter === filter)}`}
            >
              {productFilterLabel(filter)}
            </button>
          ))}
        </div>

        {filteredProducts.length === 0 ? (
          <p className="mt-4 rounded-2xl border border-dashed border-slate-700 p-4 text-center text-[9px] leading-relaxed text-slate-500">
            Ainda não há produto com evidência suficiente para este filtro. Vendas históricas sem proveniência de CMV por produto permanecem parciais.
          </p>
        ) : (
          <div className="mt-4 grid min-w-0 gap-3 xl:grid-cols-2">
            {filteredProducts.map(product => (
              <article key={product.productId} className="min-w-0 overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h5 className="break-words text-[11px] font-black">{product.name}</h5>
                    <p className="mt-1 text-[8px] text-slate-500">{product.soldQuantity} un. em {product.effectiveOrderCount} pedido(s) efetivos</p>
                  </div>
                  <span className={`shrink-0 rounded-full border px-2 py-1 text-[7px] font-black uppercase ${product.partialOrderCount > 0 ? 'border-amber-500/20 bg-amber-500/10 text-amber-200' : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200'}`}>
                    {product.partialOrderCount > 0 ? `${product.partialOrderCount} parcial` : 'Completo'}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <div className="rounded-xl border border-slate-800 p-3"><span className="text-[7px] font-black uppercase text-slate-600">Receita líquida</span><strong className="mt-1 block text-[11px]">{money(product.merchandiseRevenueMinor)}</strong></div>
                  <div className="rounded-xl border border-slate-800 p-3"><span className="text-[7px] font-black uppercase text-slate-600">CMV</span><strong className="mt-1 block text-[11px]">{money(product.saleCmvMinor)}</strong></div>
                  <div className="rounded-xl border border-slate-800 p-3"><span className="text-[7px] font-black uppercase text-slate-600">Contribuição</span><strong className="mt-1 block text-[11px]">{money(product.grossContributionMinor)}</strong></div>
                  <div className="rounded-xl border border-slate-800 p-3"><span className="text-[7px] font-black uppercase text-slate-600">Margem realizada</span><strong className="mt-1 block text-[11px]">{percent(product.realizedMarginPercent)}</strong></div>
                  <div className="rounded-xl border border-slate-800 p-3"><span className="text-[7px] font-black uppercase text-slate-600">Margem desejada</span><strong className="mt-1 block text-[11px]">{percent(product.targetMarginPercent)}</strong></div>
                  <div className="rounded-xl border border-slate-800 p-3"><span className="text-[7px] font-black uppercase text-slate-600">Diferença</span><strong className={`mt-1 block text-[11px] ${product.marginGapPercentagePoints !== null && product.marginGapPercentagePoints < 0 ? 'text-rose-300' : 'text-emerald-300'}`}>{percentagePoints(product.marginGapPercentagePoints)}</strong></div>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-3xl border border-violet-500/20 bg-slate-900 p-5" data-kyrub-order-margins="canonical">
        <div>
          <span className="font-mono text-[9px] font-black uppercase tracking-[0.16em] text-violet-300">Pedidos</span>
          <h4 className="mt-1 text-xs font-black uppercase">Resultado econômico por venda</h4>
          <p className="mt-2 max-w-3xl text-[9px] leading-relaxed text-slate-400">
            Aqui entram também custos variáveis observados suportados pela loja. Reembolso, chargeback e reversão física permanecem estados separados para não apagar o histórico econômico da venda.
          </p>
        </div>

        <div className="mt-4 flex max-w-full gap-2 overflow-x-auto pb-1">
          {(['all', 'effective', 'partial'] as OrderFilter[]).map(filter => (
            <button
              key={filter}
              type="button"
              onClick={() => setOrderFilter(filter)}
              className={`min-h-9 shrink-0 rounded-full border px-3 text-[8px] font-black uppercase ${statusClass(orderFilter === filter)}`}
            >
              {orderFilterLabel(filter)}
            </button>
          ))}
        </div>

        {filteredOrders.length === 0 ? (
          <p className="mt-4 rounded-2xl border border-dashed border-slate-700 p-4 text-center text-[9px] text-slate-500">Nenhum pedido encontrado para este filtro.</p>
        ) : (
          <div className="mt-4 space-y-3">
            {filteredOrders.map(order => (
              <article key={order.orderId} className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <h5 className="break-all text-[10px] font-black">Pedido {order.orderId}</h5>
                    <p className="mt-1 text-[8px] text-slate-500">{dateTime(order.occurredAt)}</p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <span className={`rounded-full border px-2 py-1 text-[7px] font-black uppercase ${order.dataStatus === 'complete' ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200' : 'border-amber-500/20 bg-amber-500/10 text-amber-200'}`}>{order.dataStatus === 'complete' ? 'Completo' : 'Parcial'}</span>
                    <span className="rounded-full border border-slate-700 px-2 py-1 text-[7px] font-black uppercase text-slate-400">{financialStateLabel(order.financialState)}</span>
                    <span className="rounded-full border border-slate-700 px-2 py-1 text-[7px] font-black uppercase text-slate-400">{inventoryStateLabel(order.inventoryState)}</span>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
                  <div className="rounded-xl border border-slate-800 p-3"><span className="text-[7px] font-black uppercase text-slate-600">Receita mercadoria</span><strong className="mt-1 block text-[10px]">{money(order.merchandiseRevenueMinor)}</strong></div>
                  <div className="rounded-xl border border-slate-800 p-3"><span className="text-[7px] font-black uppercase text-slate-600">Desconto loja</span><strong className="mt-1 block text-[10px]">{money(order.storeDiscountMinor)}</strong></div>
                  <div className="rounded-xl border border-slate-800 p-3"><span className="text-[7px] font-black uppercase text-slate-600">CMV</span><strong className="mt-1 block text-[10px]">{money(order.saleCmvMinor)}</strong></div>
                  <div className="rounded-xl border border-slate-800 p-3"><span className="text-[7px] font-black uppercase text-slate-600">Custos variáveis</span><strong className="mt-1 block text-[10px]">{money(order.storeObservedVariableCostsMinor)}</strong></div>
                  <div className="rounded-xl border border-slate-800 p-3"><span className="text-[7px] font-black uppercase text-slate-600">Contribuição</span><strong className="mt-1 block text-[10px]">{money(order.contributionMinor)}</strong></div>
                  <div className="rounded-xl border border-slate-800 p-3"><span className="text-[7px] font-black uppercase text-slate-600">Margem</span><strong className="mt-1 block text-[10px]">{percent(order.contributionMarginPercent)}</strong></div>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      {(orders?.sourceEntriesTruncated || (orders?.reconciliationErrors.length ?? 0) > 0) && (
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-[9px] leading-relaxed text-amber-100">
          {orders?.sourceEntriesTruncated && <p>O período consultado atingiu o limite da janela econômica atual; esta leitura não deve ser tratada como histórico completo da loja.</p>}
          {(orders?.reconciliationErrors.length ?? 0) > 0 && <p className="mt-1">{orders?.reconciliationErrors.length} pedido(s) ficaram fora do consolidado por conflito de evidência e precisam de reconciliação.</p>}
        </div>
      )}
    </section>
  );
}
