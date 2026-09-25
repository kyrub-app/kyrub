import { useCallback, useEffect, useMemo, useState } from 'react';
import { auth } from '../../utils/firebase';

type LedgerKind =
  | 'payment_capture'
  | 'payment_refund'
  | 'payment_chargeback'
  | 'payment_chargeback_reversal';

type ObservedCost = {
  kind: 'provider_processing' | 'platform_service' | 'other';
  amountMinor: number;
  borneBy: 'customer' | 'store' | 'kyrub' | 'partner';
};

type FinanceEntry = {
  id: string;
  kind: LedgerKind;
  amountMinor: number;
  occurredAt: string;
  economicAllocation?: { observedCosts?: ObservedCost[] };
};

type Receivable = {
  id: string;
  status: 'pending' | 'eligible' | 'settled' | 'reversed';
  amountMinor: number;
  createdAt: string;
  settledAt: string;
};

type Payable = {
  id: string;
  status: 'open' | 'paid' | 'cancelled';
  amountMinor: number;
  category: 'supplier' | 'inventory' | 'rent' | 'utilities' | 'tax' | 'service' | 'payroll' | 'other';
  dueDate: string;
  paidAt: string;
};

type CashMovement = {
  id: string;
  type: 'sale' | 'income' | 'expense' | 'supply' | 'withdrawal' | 'adjustment';
  direction: 'in' | 'out';
  amountMinor: number;
  occurredAt: string;
};

type CashProjection = {
  available: boolean;
  movements: CashMovement[];
};

type PeriodPayload = {
  entries?: FinanceEntry[];
  receivables?: Receivable[];
  payables?: Payable[];
  cash?: CashProjection;
  error?: string;
};

const money = (minor: number): string =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(minor / 100);

const monthOf = (value: string): string => {
  if (/^\d{4}-\d{2}/.test(value)) return value.slice(0, 7);
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 7) : '';
};

const previousMonth = (period: string): string => {
  const [year, month] = period.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 2, 1));
  return date.toISOString().slice(0, 7);
};

const monthLabel = (period: string): string => {
  const [year, month] = period.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, 1));
  return new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
};

const payableCategoryLabel = (category: Payable['category']): string => ({
  supplier: 'Fornecedor',
  inventory: 'Estoque / insumos',
  rent: 'Aluguel',
  utilities: 'Água, luz e básicos',
  tax: 'Impostos e taxas',
  service: 'Serviços',
  payroll: 'Folha / remuneração',
  other: 'Outros',
}[category]);

const providerFeeMinor = (entry: FinanceEntry): number =>
  (entry.economicAllocation?.observedCosts ?? [])
    .filter(cost => cost.kind === 'provider_processing' && cost.borneBy === 'store')
    .reduce((total, cost) => total + Math.abs(cost.amountMinor), 0);

async function loadPeriodData(storeId: string): Promise<PeriodPayload> {
  const user = auth.currentUser;
  if (!user) throw new Error('Faça login novamente.');
  const token = await user.getIdToken();
  const response = await fetch(`/api/store-finance?storeId=${encodeURIComponent(storeId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const payload = await response.json() as PeriodPayload;
  if (!response.ok) throw new Error(payload.error || 'Não foi possível carregar a visão por período.');
  return payload;
}

export default function StoreFinancePeriodWorkspace({ storeId }: { storeId: string }) {
  const currentMonth = useMemo(() => new Date().toISOString().slice(0, 7), []);
  const [period, setPeriod] = useState(currentMonth);
  const [payload, setPayload] = useState<PeriodPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setPayload(await loadPeriodData(storeId));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível carregar a visão por período.');
    } finally {
      setLoading(false);
    }
  }, [storeId]);

  useEffect(() => { void load(); }, [load]);

  const report = useMemo(() => {
    const entries = (payload?.entries ?? []).filter(entry => monthOf(entry.occurredAt) === period);
    const payables = payload?.payables ?? [];
    const receivables = payload?.receivables ?? [];
    const cashMovements = payload?.cash?.available
      ? (payload.cash.movements ?? []).filter(movement => monthOf(movement.occurredAt) === period)
      : [];

    const byKind = (kind: LedgerKind): number => entries
      .filter(entry => entry.kind === kind)
      .reduce((total, entry) => total + Math.abs(entry.amountMinor), 0);

    const capturedMinor = byKind('payment_capture');
    const refundedMinor = byKind('payment_refund');
    const chargedBackMinor = byKind('payment_chargeback');
    const chargebackReversedMinor = byKind('payment_chargeback_reversal');
    const providerFeesMinor = entries.reduce((total, entry) => total + providerFeeMinor(entry), 0);
    const salesAfterReversalsMinor = capturedMinor - refundedMinor - chargedBackMinor + chargebackReversedMinor;
    const providerObservedNetMinor = salesAfterReversalsMinor - providerFeesMinor;

    const paidPayables = payables.filter(payable => payable.status === 'paid' && monthOf(payable.paidAt) === period);
    const paidPayablesMinor = paidPayables.reduce((total, payable) => total + payable.amountMinor, 0);
    const openDuePayables = payables.filter(payable => payable.status === 'open' && monthOf(payable.dueDate) === period);
    const openDueMinor = openDuePayables.reduce((total, payable) => total + payable.amountMinor, 0);
    const observedResultMinor = providerObservedNetMinor - paidPayablesMinor;

    const payableCategories = Array.from(new Set(paidPayables.map(payable => payable.category)))
      .map(category => ({
        category,
        amountMinor: paidPayables
          .filter(payable => payable.category === category)
          .reduce((total, payable) => total + payable.amountMinor, 0),
      }))
      .sort((left, right) => right.amountMinor - left.amountMinor);

    const cashAmount = (type: CashMovement['type']): number => cashMovements
      .filter(movement => movement.type === type)
      .reduce((total, movement) => total + movement.amountMinor, 0);
    const cashIncomeMinor = cashAmount('income');
    const cashExpenseMinor = cashAmount('expense');
    const cashSupplyMinor = cashAmount('supply');
    const cashWithdrawalMinor = cashAmount('withdrawal');

    const receivablesCreatedMinor = receivables
      .filter(receivable => monthOf(receivable.createdAt) === period && receivable.status !== 'reversed')
      .reduce((total, receivable) => total + receivable.amountMinor, 0);
    const receivablesSettledMinor = receivables
      .filter(receivable => receivable.status === 'settled' && monthOf(receivable.settledAt) === period)
      .reduce((total, receivable) => total + receivable.amountMinor, 0);

    return {
      capturedMinor,
      refundedMinor,
      chargedBackMinor,
      chargebackReversedMinor,
      providerFeesMinor,
      salesAfterReversalsMinor,
      providerObservedNetMinor,
      paidPayablesMinor,
      openDueMinor,
      observedResultMinor,
      payableCategories,
      cashIncomeMinor,
      cashExpenseMinor,
      cashSupplyMinor,
      cashWithdrawalMinor,
      cashOperationalMinor: cashIncomeMinor - cashExpenseMinor,
      receivablesCreatedMinor,
      receivablesSettledMinor,
      entryCount: entries.length,
      paidPayableCount: paidPayables.length,
      openDueCount: openDuePayables.length,
      cashMovementCount: cashMovements.length,
    };
  }, [payload, period]);

  return (
    <section className="min-w-0 max-w-full overflow-hidden rounded-3xl border border-indigo-500/20 bg-slate-900 p-5 text-white" data-kyrub-finance-period-view="observed">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <span className="font-mono text-[9px] font-black uppercase tracking-[0.16em] text-indigo-300">Visão por período</span>
          <h4 className="mt-1 text-xs font-black uppercase">Fluxo financeiro e resultado observado</h4>
          <p className="mt-2 max-w-3xl text-[9px] leading-relaxed text-slate-400">
            Consolida somente evidências já registradas no Financeiro, Contas a Pagar e Caixa. Não estima valores ausentes e não transforma esta visão gerencial em DRE contábil oficial.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <button type="button" onClick={() => setPeriod(previousMonth(currentMonth))} className="min-h-9 rounded-xl border border-slate-700 bg-slate-950 px-3 text-[8px] font-black uppercase text-slate-400">Mês anterior</button>
          <button type="button" onClick={() => setPeriod(currentMonth)} className="min-h-9 rounded-xl border border-indigo-500/25 bg-indigo-500/10 px-3 text-[8px] font-black uppercase text-indigo-100">Mês atual</button>
          <input type="month" value={period} onChange={event => setPeriod(event.target.value || currentMonth)} className="min-h-9 rounded-xl border border-slate-700 bg-slate-950 px-3 text-[9px] text-slate-200 outline-none focus:border-indigo-400" />
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950 p-3 text-[9px] text-slate-400">
        Competência selecionada: <strong className="capitalize text-white">{monthLabel(period)}</strong>
      </div>

      {loading ? (
        <p className="mt-4 rounded-2xl border border-dashed border-slate-700 p-4 text-center text-[9px] text-slate-500">Apurando período…</p>
      ) : error ? (
        <div className="mt-4 rounded-2xl border border-rose-500/20 bg-rose-500/10 p-4 text-[9px] text-rose-200">
          {error}
          <button type="button" onClick={() => void load()} className="ml-3 rounded-lg border border-rose-400/30 px-3 py-1.5 text-[8px] font-black uppercase">Tentar novamente</button>
        </div>
      ) : (
        <>
          <div className="mt-4 grid min-w-0 gap-2 sm:grid-cols-2 xl:grid-cols-5">
            <article className="rounded-2xl border border-slate-800 bg-slate-950 p-3"><span className="text-[8px] font-black uppercase text-slate-600">Receita confirmada</span><strong className="mt-1 block text-sm text-emerald-200">{money(report.capturedMinor)}</strong></article>
            <article className="rounded-2xl border border-slate-800 bg-slate-950 p-3"><span className="text-[8px] font-black uppercase text-slate-600">Estornos + chargebacks</span><strong className="mt-1 block text-sm text-rose-200">{money(report.refundedMinor + report.chargedBackMinor - report.chargebackReversedMinor)}</strong></article>
            <article className="rounded-2xl border border-slate-800 bg-slate-950 p-3"><span className="text-[8px] font-black uppercase text-slate-600">Taxas PSP conhecidas</span><strong className="mt-1 block text-sm text-amber-200">{money(report.providerFeesMinor)}</strong></article>
            <article className="rounded-2xl border border-slate-800 bg-slate-950 p-3"><span className="text-[8px] font-black uppercase text-slate-600">Contas pagas</span><strong className="mt-1 block text-sm text-rose-100">{money(report.paidPayablesMinor)}</strong><span className="mt-1 block text-[7px] text-slate-600">{report.paidPayableCount} baixa(s)</span></article>
            <article className="rounded-2xl border border-indigo-500/25 bg-indigo-500/[0.06] p-3"><span className="text-[8px] font-black uppercase text-indigo-300">Resultado observado</span><strong className={`mt-1 block text-sm ${report.observedResultMinor >= 0 ? 'text-emerald-200' : 'text-rose-200'}`}>{money(report.observedResultMinor)}</strong></article>
          </div>

          <div className="mt-4 grid min-w-0 gap-3 lg:grid-cols-2">
            <article className="min-w-0 rounded-2xl border border-slate-800 bg-slate-950 p-4">
              <h5 className="text-[10px] font-black uppercase text-slate-200">Resultado financeiro observado</h5>
              <div className="mt-3 space-y-2 text-[9px]">
                <div className="flex justify-between gap-3"><span className="text-slate-500">Vendas após reversões</span><b>{money(report.salesAfterReversalsMinor)}</b></div>
                <div className="flex justify-between gap-3"><span className="text-slate-500">− Taxas conhecidas do provedor</span><b>{money(report.providerFeesMinor)}</b></div>
                <div className="flex justify-between gap-3"><span className="text-slate-500">= Líquido observado dos pagamentos</span><b>{money(report.providerObservedNetMinor)}</b></div>
                <div className="flex justify-between gap-3 border-t border-slate-800 pt-2"><span className="text-slate-500">− Contas efetivamente marcadas como pagas</span><b>{money(report.paidPayablesMinor)}</b></div>
                <div className="flex justify-between gap-3 border-t border-indigo-500/20 pt-2"><strong>Resultado observado</strong><strong className={report.observedResultMinor >= 0 ? 'text-emerald-200' : 'text-rose-200'}>{money(report.observedResultMinor)}</strong></div>
              </div>
              <p className="mt-3 text-[8px] leading-relaxed text-slate-600">Não inclui CMV/consumo de estoque, depreciação, tributos não lançados, taxas não evidenciadas ou outras competências ainda não registradas. Por isso este número não deve ser apresentado como lucro líquido contábil.</p>
            </article>

            <article className="min-w-0 rounded-2xl border border-slate-800 bg-slate-950 p-4">
              <h5 className="text-[10px] font-black uppercase text-slate-200">Compromissos e repasses</h5>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <div className="rounded-xl border border-slate-800 bg-slate-900 p-3"><span className="text-[8px] font-black uppercase text-slate-600">Contas ainda a vencer / em aberto no mês</span><strong className="mt-1 block text-sm text-amber-200">{money(report.openDueMinor)}</strong><span className="text-[7px] text-slate-600">{report.openDueCount} conta(s)</span></div>
                <div className="rounded-xl border border-slate-800 bg-slate-900 p-3"><span className="text-[8px] font-black uppercase text-slate-600">Repasses gerados no mês</span><strong className="mt-1 block text-sm text-cyan-200">{money(report.receivablesCreatedMinor)}</strong></div>
                <div className="rounded-xl border border-slate-800 bg-slate-900 p-3 sm:col-span-2"><span className="text-[8px] font-black uppercase text-slate-600">Repasses efetivamente liquidados no mês</span><strong className="mt-1 block text-sm text-emerald-200">{money(report.receivablesSettledMinor)}</strong></div>
              </div>
              {report.payableCategories.length > 0 && (
                <div className="mt-3 space-y-1.5 border-t border-slate-800 pt-3">
                  <span className="text-[8px] font-black uppercase text-slate-600">Contas pagas por categoria</span>
                  {report.payableCategories.map(item => <div key={item.category} className="flex justify-between gap-3 text-[8px]"><span className="text-slate-500">{payableCategoryLabel(item.category)}</span><b>{money(item.amountMinor)}</b></div>)}
                </div>
              )}
            </article>
          </div>

          <article className="mt-4 min-w-0 rounded-2xl border border-fuchsia-500/15 bg-slate-950 p-4">
            <h5 className="text-[10px] font-black uppercase text-fuchsia-200">Caixa operacional no período</h5>
            <p className="mt-1 text-[8px] leading-relaxed text-slate-600">A leitura abaixo é física/operacional e fica separada do resultado para evitar dupla contabilização com pagamentos e Contas a Pagar.</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
              <div className="rounded-xl border border-slate-800 bg-slate-900 p-3"><span className="text-[8px] uppercase text-slate-600">Outras entradas</span><b className="mt-1 block text-emerald-200">{money(report.cashIncomeMinor)}</b></div>
              <div className="rounded-xl border border-slate-800 bg-slate-900 p-3"><span className="text-[8px] uppercase text-slate-600">Despesas / saídas</span><b className="mt-1 block text-rose-200">{money(report.cashExpenseMinor)}</b></div>
              <div className="rounded-xl border border-slate-800 bg-slate-900 p-3"><span className="text-[8px] uppercase text-slate-600">Operacional</span><b className={`mt-1 block ${report.cashOperationalMinor >= 0 ? 'text-emerald-200' : 'text-rose-200'}`}>{money(report.cashOperationalMinor)}</b></div>
              <div className="rounded-xl border border-slate-800 bg-slate-900 p-3"><span className="text-[8px] uppercase text-slate-600">Suprimentos</span><b className="mt-1 block text-cyan-200">{money(report.cashSupplyMinor)}</b></div>
              <div className="rounded-xl border border-slate-800 bg-slate-900 p-3"><span className="text-[8px] uppercase text-slate-600">Sangrias</span><b className="mt-1 block text-amber-200">{money(report.cashWithdrawalMinor)}</b></div>
            </div>
            <p className="mt-3 text-[8px] text-slate-600">Base carregada: {report.entryCount} lançamento(s) de pagamento e {report.cashMovementCount} movimentação(ões) de Caixa nesta competência. A API atual ainda trabalha com janelas de até 100 registros por fonte.</p>
          </article>
        </>
      )}
    </section>
  );
}
