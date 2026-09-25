import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

type ProviderReconciliation = {
  schemaVersion: 1;
  storeId: string;
  paymentId: string;
  orderId: string;
  provider: 'mercado-pago';
  providerPaymentId: string;
  currency: 'BRL';
  canonicalPaymentMethod: PaymentMethod;
  providerPaymentMethodId: string;
  providerPaymentTypeId: string;
  installments: number | null;
  providerStatus: string;
  providerStatusDetail: string;
  grossMinor: number;
  totalPaidMinor: number | null;
  providerFeeMinor: number | null;
  mercadoPagoFeeMinor: number | null;
  financingFeeMinor: number | null;
  otherCollectorFeeMinor: number | null;
  netReceivedMinor: number | null;
  moneyReleaseDate: string;
  moneyReleaseStatus: string;
  providerUpdatedAt: string;
  reconciledAt: string;
  sourceAuthority: 'mercado_pago_payment_api';
  evidenceFingerprint: string;
};

type ProviderReconciliationPayload = {
  reconciliation?: ProviderReconciliation | null;
  error?: string;
};

const money = (minor: number): string =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(minor / 100);

const optionalMoney = (minor: number | null): string =>
  minor === null ? 'Não informado pelo provedor' : money(minor);

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

const isMercadoPago = (provider: string): boolean =>
  provider.toLowerCase().replace(/[^a-z0-9]+/g, '') === 'mercadopago';

const providerMethodLabel = (reconciliation: ProviderReconciliation): string => {
  if (reconciliation.providerPaymentMethodId === 'pix') return 'Pix';
  if (reconciliation.providerPaymentTypeId === 'credit_card') return 'Cartão de crédito';
  if (reconciliation.providerPaymentTypeId === 'debit_card') return 'Cartão de débito';
  if (reconciliation.providerPaymentTypeId === 'prepaid_card') return 'Cartão pré-pago';
  if (reconciliation.providerPaymentTypeId === 'bank_transfer') return 'Transferência / Pix';
  return reconciliation.providerPaymentTypeId || reconciliation.providerPaymentMethodId || 'Não informado';
};

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

async function fetchProviderReconciliation(input: {
  storeId: string;
  paymentId: string;
  refresh: boolean;
}): Promise<ProviderReconciliation | null> {
  const user = auth.currentUser;
  if (!user) throw new Error('Faça login novamente.');
  const token = await user.getIdToken();
  const params = new URLSearchParams({
    transport: 'store-promotions',
    surface: 'finance-history',
    path: 'provider-reconciliation',
    storeId: input.storeId,
    paymentId: input.paymentId,
  });
  const response = await fetch(`/api/health?${params.toString()}`, {
    method: input.refresh ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (!contentType.includes('application/json')) {
    throw new Error('A conciliação do Mercado Pago respondeu em um formato inesperado.');
  }
  const payload = await response.json() as ProviderReconciliationPayload;
  if (!response.ok) throw new Error(payload.error || 'Não foi possível reconciliar o Mercado Pago.');
  return payload.reconciliation ?? null;
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
  const [reconciliations, setReconciliations] = useState<Record<string, ProviderReconciliation | null>>({});
  const [reconciliationErrors, setReconciliationErrors] = useState<Record<string, string>>({});
  const [reconcilingPaymentId, setReconcilingPaymentId] = useState('');
  const reconciliationRequestedRef = useRef(new Set<string>());

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

  useEffect(() => {
    const candidates = items.filter(item =>
      item.kind === 'payment_capture'
      && isMercadoPago(item.provider)
      && !reconciliationRequestedRef.current.has(item.paymentId)
    );
    for (const item of candidates) {
      reconciliationRequestedRef.current.add(item.paymentId);
      void fetchProviderReconciliation({ storeId, paymentId: item.paymentId, refresh: false })
        .then(reconciliation => {
          setReconciliations(current => ({ ...current, [item.paymentId]: reconciliation }));
        })
        .catch(() => {
          // Existing reconciliation is supplemental. A read failure must not block the finance history.
        });
    }
  }, [items, storeId]);

  const activeFilterCount = useMemo(
    () => Number(Boolean(period)) + Number(kind !== 'all') + Number(paymentMethod !== 'all'),
    [period, kind, paymentMethod]
  );

  const reconcile = useCallback(async (paymentId: string) => {
    setReconcilingPaymentId(paymentId);
    setReconciliationErrors(current => ({ ...current, [paymentId]: '' }));
    try {
      const reconciliation = await fetchProviderReconciliation({ storeId, paymentId, refresh: true });
      setReconciliations(current => ({ ...current, [paymentId]: reconciliation }));
    } catch (caught) {
      setReconciliationErrors(current => ({
        ...current,
        [paymentId]: caught instanceof Error ? caught.message : 'Não foi possível reconciliar o Mercado Pago.',
      }));
    } finally {
      setReconcilingPaymentId('');
    }
  }, [storeId]);

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
            const reconciliation = reconciliations[item.paymentId];
            const reconciliationError = reconciliationErrors[item.paymentId];
            const canReconcileMercadoPago = item.kind === 'payment_capture' && isMercadoPago(item.provider);
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
                        Taxa PSP registrada no ledger: {item.providerFeeMinor === null ? 'não informada' : money(item.providerFeeMinor)}
                      </p>
                    )}
                  </div>
                  <strong className={`shrink-0 text-left text-sm sm:text-right ${item.amountMinor >= 0 ? 'text-emerald-200' : 'text-rose-200'}`}>
                    {money(item.amountMinor)}
                  </strong>
                </div>

                {canReconcileMercadoPago && (
                  <div className="mt-4 rounded-2xl border border-sky-500/20 bg-sky-500/5 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-[8px] font-black uppercase text-sky-200">Conciliação Mercado Pago</p>
                        <p className="mt-1 text-[8px] leading-relaxed text-slate-500">
                          Consulta a conta Mercado Pago conectada à loja e registra somente valores devolvidos pelo provedor.
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={reconcilingPaymentId === item.paymentId}
                        onClick={() => void reconcile(item.paymentId)}
                        className="min-h-9 rounded-xl border border-sky-400/30 bg-sky-500/10 px-3 text-[8px] font-black uppercase text-sky-100 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {reconcilingPaymentId === item.paymentId
                          ? 'Reconciliando…'
                          : reconciliation ? 'Atualizar Mercado Pago' : 'Reconciliar Mercado Pago'}
                      </button>
                    </div>

                    {reconciliationError && (
                      <p className="mt-3 rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-[8px] text-rose-200">
                        {reconciliationError}
                      </p>
                    )}

                    {reconciliation && (
                      <div className="mt-3">
                        <div className="grid min-w-0 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                          <div className="min-w-0 rounded-xl border border-slate-800 bg-slate-950/70 p-3">
                            <span className="text-[7px] font-black uppercase text-slate-600">Venda bruta</span>
                            <strong className="mt-1 block text-[11px] text-white">{money(reconciliation.grossMinor)}</strong>
                          </div>
                          <div className="min-w-0 rounded-xl border border-slate-800 bg-slate-950/70 p-3">
                            <span className="text-[7px] font-black uppercase text-slate-600">Cliente pagou</span>
                            <strong className="mt-1 block text-[11px] text-white">{optionalMoney(reconciliation.totalPaidMinor)}</strong>
                          </div>
                          <div className="min-w-0 rounded-xl border border-slate-800 bg-slate-950/70 p-3">
                            <span className="text-[7px] font-black uppercase text-slate-600">Taxas do vendedor</span>
                            <strong className="mt-1 block text-[11px] text-amber-200">{optionalMoney(reconciliation.providerFeeMinor)}</strong>
                          </div>
                          <div className="min-w-0 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3">
                            <span className="text-[7px] font-black uppercase text-emerald-300/70">Líquido informado pelo MP</span>
                            <strong className="mt-1 block text-[11px] text-emerald-200">{optionalMoney(reconciliation.netReceivedMinor)}</strong>
                          </div>
                        </div>

                        <div className="mt-2 grid min-w-0 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                          <p className="min-w-0 rounded-xl border border-slate-800 p-2 text-[8px] text-slate-500">
                            Taxa Mercado Pago: <strong className="text-slate-300">{optionalMoney(reconciliation.mercadoPagoFeeMinor)}</strong>
                          </p>
                          <p className="min-w-0 rounded-xl border border-slate-800 p-2 text-[8px] text-slate-500">
                            Custo de parcelamento: <strong className="text-slate-300">{optionalMoney(reconciliation.financingFeeMinor)}</strong>
                          </p>
                          <p className="min-w-0 rounded-xl border border-slate-800 p-2 text-[8px] text-slate-500">
                            Meio: <strong className="text-slate-300">{providerMethodLabel(reconciliation)}</strong>{reconciliation.installments ? ` · ${reconciliation.installments}x` : ''}
                          </p>
                          <p className="min-w-0 rounded-xl border border-slate-800 p-2 text-[8px] text-slate-500">
                            Status MP: <strong className="text-slate-300">{reconciliation.providerStatusDetail || reconciliation.providerStatus}</strong>
                          </p>
                        </div>

                        <p className="mt-2 text-[8px] leading-relaxed text-slate-500">
                          {reconciliation.moneyReleaseDate
                            ? `Data de liberação informada pelo Mercado Pago: ${dateTime(reconciliation.moneyReleaseDate)}.`
                            : 'O Mercado Pago não informou uma data de liberação nesta leitura.'}
                          {' '}Última conciliação: {dateTime(reconciliation.reconciledAt)}.
                        </p>
                        <p className="mt-2 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-[8px] leading-relaxed text-amber-100/80">
                          “Líquido informado pelo MP” e data de liberação são evidências da conta Mercado Pago. Eles não confirmam, por si só, que o dinheiro foi transferido para uma conta bancária da loja. Transferência bancária só será marcada quando houver evidência própria de payout/saque.
                        </p>
                      </div>
                    )}
                  </div>
                )}
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
