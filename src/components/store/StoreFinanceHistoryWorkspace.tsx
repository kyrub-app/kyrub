import { useCallback, useEffect, useMemo, useState } from 'react';
import { auth } from '../../utils/firebase';

type LedgerKind =
  | 'payment_capture'
  | 'payment_refund'
  | 'payment_chargeback'
  | 'payment_chargeback_reversal';

type PaymentMethod = 'pix' | 'card' | 'cash' | 'other';
type SourceAuthority = 'provider_webhook' | 'canonical_payment_snapshot' | 'operator_attestation';

type HistoryItem = {
  id: string;
  kind: LedgerKind;
  currency: 'BRL';
  amountMinor: number;
  paymentId: string;
  orderId: string;
  buyerId: string;
  paymentMethod: PaymentMethod;
  provider: string;
  providerPaymentId: string;
  sourceAuthority: SourceAuthority;
  occurredAt: string;
  providerFeeMinor: number | null;
};

type HistoryPayload = {
  storeId?: string;
  recoveredCount?: number;
  items?: HistoryItem[];
  nextCursor?: string;
  hasMore?: boolean;
  scannedCount?: number;
  error?: string;
};

const money = (minor: number): string =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(minor / 100);

const dateTime = (value: string): string => {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date)
    : value;
};

const kindLabel = (kind: LedgerKind): string => ({
  payment_capture: 'Venda recebida',
  payment_refund: 'Estorno',
  payment_chargeback: 'Chargeback',
  payment_chargeback_reversal: 'Reversão de chargeback',
}[kind]);

const methodLabel = (method: PaymentMethod): string => ({
  pix: 'Pix',
  card: 'Cartão',
  cash: 'Dinheiro',
  other: 'Outro',
}[method]);

const authorityLabel = (authority: SourceAuthority): string => ({
  provider_webhook: 'Confirmado pelo provedor',
  canonical_payment_snapshot: 'Pagamento reconciliado',
  operator_attestation: 'Registro operacional',
}[authority]);

async function fetchHistory(input: {
  storeId: string;
  period: string;
  kind: LedgerKind | 'all';
  paymentMethod: PaymentMethod | 'all';
  cursor?: string;
}): Promise<HistoryPayload> {
  const user = auth.currentUser;
  if (!user) throw new Error('Faça login novamente.');
  const token = await user.getIdToken();
  const params = new URLSearchParams({
    transport: 'store-promotions',
    surface: 'finance-history',
    mode: 'history',
    storeId: input.storeId,
    limit: '25',
    kind: input.kind,
    paymentMethod: input.paymentMethod,
  });
  if (input.period) params.set('period', input.period);
  if (input.cursor) params.set('cursor', input.cursor);

  const response = await fetch(`/api/health?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (!contentType.includes('application/json')) {
    throw new Error('O histórico financeiro respondeu em um formato inesperado.');
  }
  const payload = await response.json() as HistoryPayload;
  if (!response.ok) throw new Error(payload.error || 'Não foi possível carregar o histórico financeiro.');
  return payload;
}

export default function StoreFinanceHistoryWorkspace({ storeId }: { storeId: string }) {
  const [period, setPeriod] = useState('');
  const [kind, setKind] = useState<LedgerKind | 'all'>('all');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | 'all'>('all');
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [cursor, setCursor] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [recoveredCount, setRecoveredCount] = useState(0);

  const load = useCallback(async (append = false) => {
    append ? setLoadingMore(true) : setLoading(true);
    setError('');
    try {
      const payload = await fetchHistory({
        storeId,
        period,
        kind,
        paymentMethod,
        ...(append && cursor ? { cursor } : {}),
      });
      const nextItems = payload.items ?? [];
      setItems(current => append ? [...current, ...nextItems] : nextItems);
      setCursor(payload.nextCursor ?? '');
      setHasMore(Boolean(payload.hasMore && payload.nextCursor));
      setRecoveredCount(current => current + (payload.recoveredCount ?? 0));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível carregar o histórico financeiro.');
      if (!append) {
        setItems([]);
        setCursor('');
        setHasMore(false);
      }
    } finally {
      append ? setLoadingMore(false) : setLoading(false);
    }
  }, [storeId, period, kind, paymentMethod, cursor]);

  useEffect(() => {
    setCursor('');
    setHasMore(false);
    setRecoveredCount(0);
    void load(false);
    // cursor is intentionally reset by every filter change; including it here would refetch each page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId, period, kind, paymentMethod]);

  const activeFilterCount = useMemo(
    () => Number(Boolean(period)) + Number(kind !== 'all') + Number(paymentMethod !== 'all'),
    [period, kind, paymentMethod]
  );

  return (
    <section className="min-w-0 max-w-full overflow-hidden rounded-3xl border border-cyan-500/20 bg-slate-900 p-5 text-white" data-kyrub-finance-history="cursor-paginated">
      <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <span className="font-mono text-[9px] font-black uppercase tracking-[0.16em] text-cyan-300">Histórico financeiro</span>
          <h4 className="mt-1 text-xs font-black uppercase">Movimentações paginadas</h4>
          <p className="mt-2 max-w-3xl text-[9px] leading-relaxed text-slate-400">
            O histórico agora é lido por cursor, sem depender de uma janela global de 100 lançamentos. Os filtros são aplicados sobre o ledger econômico canônico da loja.
          </p>
        </div>
        <span className="shrink-0 rounded-full border border-slate-700 bg-slate-950 px-3 py-2 text-[8px] font-black uppercase text-slate-400">
          {activeFilterCount ? `${activeFilterCount} filtro(s)` : 'Todos os períodos'}
        </span>
      </div>

      <div className="mt-4 grid min-w-0 gap-3 md:grid-cols-3">
        <label className="min-w-0 text-[8px] font-black uppercase text-slate-500">
          Competência
          <input
            type="month"
            value={period}
            onChange={event => setPeriod(event.target.value)}
            className="mt-1 min-h-10 w-full min-w-0 rounded-xl border border-slate-700 bg-slate-950 px-3 text-[9px] font-medium normal-case text-white outline-none focus:border-cyan-400"
          />
        </label>
        <label className="min-w-0 text-[8px] font-black uppercase text-slate-500">
          Tipo de movimentação
          <select
            value={kind}
            onChange={event => setKind(event.target.value as LedgerKind | 'all')}
            className="mt-1 min-h-10 w-full min-w-0 rounded-xl border border-slate-700 bg-slate-950 px-3 text-[9px] font-medium normal-case text-white outline-none focus:border-cyan-400"
          >
            <option value="all">Todos</option>
            <option value="payment_capture">Vendas recebidas</option>
            <option value="payment_refund">Estornos</option>
            <option value="payment_chargeback">Chargebacks</option>
            <option value="payment_chargeback_reversal">Reversões de chargeback</option>
          </select>
        </label>
        <label className="min-w-0 text-[8px] font-black uppercase text-slate-500">
          Forma de pagamento
          <select
            value={paymentMethod}
            onChange={event => setPaymentMethod(event.target.value as PaymentMethod | 'all')}
            className="mt-1 min-h-10 w-full min-w-0 rounded-xl border border-slate-700 bg-slate-950 px-3 text-[9px] font-medium normal-case text-white outline-none focus:border-cyan-400"
          >
            <option value="all">Todas</option>
            <option value="pix">Pix</option>
            <option value="card">Cartão</option>
            <option value="cash">Dinheiro</option>
            <option value="other">Outro</option>
          </select>
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => {
            setPeriod('');
            setKind('all');
            setPaymentMethod('all');
          }}
          disabled={activeFilterCount === 0}
          className="min-h-9 rounded-xl border border-slate-700 bg-slate-950 px-3 text-[8px] font-black uppercase text-slate-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Limpar filtros
        </button>
        <span className="text-[8px] text-slate-600">{items.length} lançamento(s) carregado(s)</span>
      </div>

      {recoveredCount > 0 && (
        <p className="mt-3 rounded-xl border border-cyan-500/20 bg-cyan-500/10 p-3 text-[9px] text-cyan-100">
          {recoveredCount} pagamento(s) histórico(s) confirmado(s) foram incorporados ao ledger durante esta leitura, sem duplicar receita.
        </p>
      )}

      {loading ? (
        <p className="mt-4 rounded-2xl border border-dashed border-slate-700 p-5 text-center text-[9px] text-slate-500">Carregando histórico…</p>
      ) : error ? (
        <div className="mt-4 rounded-2xl border border-rose-500/20 bg-rose-500/10 p-4 text-[9px] text-rose-200">
          {error}
          <button type="button" onClick={() => void load(false)} className="ml-3 rounded-lg border border-rose-400/30 px-3 py-1.5 text-[8px] font-black uppercase">Tentar novamente</button>
        </div>
      ) : items.length === 0 ? (
        <p className="mt-4 rounded-2xl border border-dashed border-slate-700 p-5 text-center text-[9px] text-slate-500">Nenhuma movimentação encontrada para os filtros selecionados.</p>
      ) : (
        <div className="mt-4 min-w-0 space-y-2">
          {items.map(item => {
            const feeMinor = item.providerFeeMinor;
            const providerNetMinor = item.kind === 'payment_capture' && feeMinor !== null
              ? item.amountMinor - feeMinor
              : null;
            return (
              <article key={item.id} className="min-w-0 max-w-full overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 p-4">
                <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong className="text-[10px]">{kindLabel(item.kind)}</strong>
                      <span className="max-w-full rounded-full border border-slate-700 px-2 py-1 text-[7px] font-black uppercase text-slate-500">{methodLabel(item.paymentMethod)}</span>
                      <span className="max-w-full whitespace-normal break-words rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2 py-1 text-[7px] font-black uppercase leading-tight text-cyan-200">{authorityLabel(item.sourceAuthority)}</span>
                    </div>
                    <p className="mt-2 max-w-full break-words text-[8px] leading-relaxed text-slate-500 [overflow-wrap:anywhere]">Pedido {item.orderId}</p>
                    <p className="mt-1 max-w-full break-words text-[8px] leading-relaxed text-slate-600 [overflow-wrap:anywhere]">Pagamento {item.paymentId} · {item.provider || 'provedor não informado'}</p>
                    <p className="mt-1 text-[8px] text-slate-600">{dateTime(item.occurredAt)}</p>
                    {item.kind === 'payment_capture' && (
                      <p className="mt-2 text-[8px] text-slate-600">
                        Taxa PSP: {feeMinor === null ? 'não informada' : money(feeMinor)} · Líquido conhecido: {providerNetMinor === null ? 'aguardando evidência' : money(providerNetMinor)}
                      </p>
                    )}
                  </div>
                  <strong className={`shrink-0 text-left text-sm sm:text-right ${item.amountMinor >= 0 ? 'text-emerald-200' : 'text-rose-200'}`}>
                    {money(item.amountMinor)}
                  </strong>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {!loading && !error && hasMore && (
        <button
          type="button"
          disabled={loadingMore}
          onClick={() => void load(true)}
          className="mt-4 min-h-10 w-full rounded-xl border border-cyan-500/25 bg-cyan-500/10 px-4 text-[9px] font-black uppercase text-cyan-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loadingMore ? 'Carregando…' : 'Carregar mais movimentações'}
        </button>
      )}
    </section>
  );
}
