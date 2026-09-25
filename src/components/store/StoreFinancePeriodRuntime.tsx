import { useCallback, useEffect, useMemo, useState } from 'react';
import { auth } from '../../utils/firebase';

type StorePayableCategory =
  | 'supplier'
  | 'inventory'
  | 'rent'
  | 'utilities'
  | 'tax'
  | 'service'
  | 'payroll'
  | 'other';

type PeriodReport = {
  period: string;
  currency: 'BRL';
  capturedMinor: number;
  refundedMinor: number;
  chargedBackMinor: number;
  chargebackReversedMinor: number;
  providerFeesMinor: number;
  salesAfterReversalsMinor: number;
  providerObservedNetMinor: number;
  entryCount: number;
  paidPayablesMinor: number;
  openDueMinor: number;
  paidPayableCount: number;
  openDueCount: number;
  categories: Array<{ category: StorePayableCategory; amountMinor: number }>;
  receivablesCreatedMinor: number;
  receivablesSettledMinor: number;
  observedResultMinor: number;
  complete: boolean;
};

type PeriodPayload = { storeId?: string; recoveredCount?: number; report?: PeriodReport; error?: string };
const money = (minor: number): string => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(minor / 100);
const previousMonth = (period: string): string => { const [year, month] = period.split('-').map(Number); return new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 7); };
const monthLabel = (period: string): string => { const [year, month] = period.split('-').map(Number); return new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month - 1, 1))); };
const payableCategoryLabel = (category: StorePayableCategory): string => ({ supplier: 'Fornecedor', inventory: 'Estoque / insumos', rent: 'Aluguel', utilities: 'Água, luz e básicos', tax: 'Impostos e taxas', service: 'Serviços', payroll: 'Folha / remuneração', other: 'Outros' }[category]);

async function fetchPeriod(storeId: string, period: string): Promise<PeriodPayload> {
  const user = auth.currentUser;
  if (!user) throw new Error('Faça login novamente.');
  const token = await user.getIdToken();
  const params = new URLSearchParams({ transport: 'store-promotions', surface: 'finance-history', mode: 'period', storeId, period });
  const response = await fetch(`/api/health?${params.toString()}`, { headers: { Authorization: `Bearer ${token}` } });
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (!contentType.includes('application/json')) throw new Error('A visão por período respondeu em um formato inesperado.');
  const payload = await response.json() as PeriodPayload;
  if (!response.ok) throw new Error(payload.error || 'Não foi possível carregar a visão por período.');
  if (!payload.report?.complete) throw new Error('A apuração do período não foi concluída.');
  return payload;
}

export default function StoreFinancePeriodRuntime({ storeId }: { storeId: string }) {
  const currentMonth = useMemo(() => new Date().toISOString().slice(0, 7), []);
  const [period, setPeriod] = useState(currentMonth);
  const [report, setReport] = useState<PeriodReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [recoveredCount, setRecoveredCount] = useState(0);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { const payload = await fetchPeriod(storeId, period); setReport(payload.report ?? null); setRecoveredCount(payload.recoveredCount ?? 0); }
    catch (caught) { setReport(null); setError(caught instanceof Error ? caught.message : 'Não foi possível carregar a visão por período.'); }
    finally { setLoading(false); }
  }, [storeId, period]);
  useEffect(() => { void load(); }, [load]);

  return (
    <section className="min-w-0 max-w-full overflow-hidden rounded-3xl border border-indigo-500/20 bg-slate-900 p-5 text-white" data-kyrub-finance-period-view="complete-paged-scan">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><span className="font-mono text-[9px] font-black uppercase tracking-[0.16em] text-indigo-300">Visão por período</span><h4 className="mt-1 text-xs font-black uppercase">Fluxo financeiro e resultado observado</h4><p className="mt-2 max-w-3xl text-[9px] leading-relaxed text-slate-400">A competência é apurada no servidor percorrendo todos os lotes do período. Ela não depende mais dos primeiros 100 lançamentos do Financeiro. Nenhum valor ausente é estimado.</p></div><div className="flex shrink-0 flex-wrap items-center gap-2"><button type="button" onClick={() => setPeriod(previousMonth(currentMonth))} className="min-h-9 rounded-xl border border-slate-700 bg-slate-950 px-3 text-[8px] font-black uppercase text-slate-400">Mês anterior</button><button type="button" onClick={() => setPeriod(currentMonth)} className="min-h-9 rounded-xl border border-indigo-500/25 bg-indigo-500/10 px-3 text-[8px] font-black uppercase text-indigo-100">Mês atual</button><input type="month" value={period} onChange={event => setPeriod(event.target.value || currentMonth)} className="min-h-9 rounded-xl border border-slate-700 bg-slate-950 px-3 text-[9px] text-slate-200 outline-none focus:border-indigo-400" /></div></div>
      <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950 p-3 text-[9px] text-slate-400">Competência selecionada: <strong className="capitalize text-white">{monthLabel(period)}</strong></div>
      {recoveredCount > 0 && <p className="mt-3 rounded-xl border border-cyan-500/20 bg-cyan-500/10 p-3 text-[9px] text-cyan-100">{recoveredCount} pagamento(s) histórico(s) pago(s) foram reconciliados antes da apuração, usando IDs determinísticos para não duplicar receita.</p>}
      {loading ? <p className="mt-4 rounded-2xl border border-dashed border-slate-700 p-4 text-center text-[9px] text-slate-500">Apurando todos os lotes da competência…</p> : error ? <div className="mt-4 rounded-2xl border border-rose-500/20 bg-rose-500/10 p-4 text-[9px] text-rose-200">{error}<button type="button" onClick={() => void load()} className="ml-3 rounded-lg border border-rose-400/30 px-3 py-1.5 text-[8px] font-black uppercase">Tentar novamente</button></div> : report ? <>
        <div className="mt-4 grid min-w-0 gap-2 sm:grid-cols-2 xl:grid-cols-5"><article className="rounded-2xl border border-slate-800 bg-slate-950 p-3"><span className="text-[8px] font-black uppercase text-slate-600">Receita confirmada</span><strong className="mt-1 block text-sm text-emerald-200">{money(report.capturedMinor)}</strong><span className="mt-1 block text-[7px] text-slate-600">{report.entryCount} lançamento(s) no ledger</span></article><article className="rounded-2xl border border-slate-800 bg-slate-950 p-3"><span className="text-[8px] font-black uppercase text-slate-600">Estornos + chargebacks</span><strong className="mt-1 block text-sm text-rose-200">{money(report.refundedMinor + report.chargedBackMinor - report.chargebackReversedMinor)}</strong></article><article className="rounded-2xl border border-slate-800 bg-slate-950 p-3"><span className="text-[8px] font-black uppercase text-slate-600">Taxas PSP conhecidas</span><strong className="mt-1 block text-sm text-amber-200">{money(report.providerFeesMinor)}</strong></article><article className="rounded-2xl border border-slate-800 bg-slate-950 p-3"><span className="text-[8px] font-black uppercase text-slate-600">Contas pagas</span><strong className="mt-1 block text-sm text-rose-100">{money(report.paidPayablesMinor)}</strong><span className="mt-1 block text-[7px] text-slate-600">{report.paidPayableCount} baixa(s)</span></article><article className="rounded-2xl border border-indigo-500/25 bg-indigo-500/[0.06] p-3"><span className="text-[8px] font-black uppercase text-indigo-300">Resultado observado</span><strong className={`mt-1 block text-sm ${report.observedResultMinor >= 0 ? 'text-emerald-200' : 'text-rose-200'}`}>{money(report.observedResultMinor)}</strong></article></div>
        <div className="mt-4 grid min-w-0 gap-3 lg:grid-cols-2"><article className="min-w-0 rounded-2xl border border-slate-800 bg-slate-950 p-4"><h5 className="text-[10px] font-black uppercase text-slate-200">Resultado financeiro observado</h5><div className="mt-3 space-y-2 text-[9px]"><div className="flex justify-between gap-3"><span className="text-slate-500">Vendas após reversões</span><b>{money(report.salesAfterReversalsMinor)}</b></div><div className="flex justify-between gap-3"><span className="text-slate-500">− Taxas conhecidas do provedor</span><b>{money(report.providerFeesMinor)}</b></div><div className="flex justify-between gap-3"><span className="text-slate-500">= Líquido observado dos pagamentos</span><b>{money(report.providerObservedNetMinor)}</b></div><div className="flex justify-between gap-3 border-t border-slate-800 pt-2"><span className="text-slate-500">− Contas efetivamente marcadas como pagas</span><b>{money(report.paidPayablesMinor)}</b></div><div className="flex justify-between gap-3 border-t border-indigo-500/20 pt-2"><strong>Resultado observado</strong><strong className={report.observedResultMinor >= 0 ? 'text-emerald-200' : 'text-rose-200'}>{money(report.observedResultMinor)}</strong></div></div><p className="mt-3 text-[8px] leading-relaxed text-slate-600">Não inclui CMV/consumo de estoque, depreciação, tributos não lançados, taxas não evidenciadas ou outras competências ainda não registradas. Portanto, não é apresentado como lucro líquido contábil ou DRE oficial.</p></article>
          <article className="min-w-0 rounded-2xl border border-slate-800 bg-slate-950 p-4"><h5 className="text-[10px] font-black uppercase text-slate-200">Compromissos e repasses</h5><div className="mt-3 grid gap-2 sm:grid-cols-2"><div className="rounded-xl border border-slate-800 bg-slate-900 p-3"><span className="text-[8px] font-black uppercase text-slate-600">Contas em aberto com vencimento no mês</span><strong className="mt-1 block text-sm text-amber-200">{money(report.openDueMinor)}</strong><span className="text-[7px] text-slate-600">{report.openDueCount} conta(s)</span></div><div className="rounded-xl border border-slate-800 bg-slate-900 p-3"><span className="text-[8px] font-black uppercase text-slate-600">Repasses gerados no mês</span><strong className="mt-1 block text-sm text-cyan-200">{money(report.receivablesCreatedMinor)}</strong></div><div className="rounded-xl border border-slate-800 bg-slate-900 p-3 sm:col-span-2"><span className="text-[8px] font-black uppercase text-slate-600">Repasses efetivamente liquidados no mês</span><strong className="mt-1 block text-sm text-emerald-200">{money(report.receivablesSettledMinor)}</strong></div></div>{report.categories.length > 0 && <div className="mt-3 space-y-1.5 border-t border-slate-800 pt-3"><span className="text-[8px] font-black uppercase text-slate-600">Contas pagas por categoria</span>{report.categories.map(item => <div key={item.category} className="flex justify-between gap-3 text-[8px]"><span className="text-slate-500">{payableCategoryLabel(item.category)}</span><b>{money(item.amountMinor)}</b></div>)}</div>}</article></div>
        <p className="mt-4 rounded-2xl border border-slate-800 bg-slate-950 p-3 text-[8px] leading-relaxed text-slate-600">O Caixa físico/operacional continua exibido separadamente no Financeiro. Ele não é incorporado a este resultado para evitar dupla contabilização com pagamentos e Contas a Pagar.</p>
      </> : null}
    </section>
  );
}
