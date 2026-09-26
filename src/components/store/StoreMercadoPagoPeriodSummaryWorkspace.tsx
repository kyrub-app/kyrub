import { useCallback, useEffect, useMemo, useState } from 'react';
import { auth } from '../../utils/firebase';

type ProviderPeriodSummary = {
  period: string;
  provider: 'mercado-pago';
  paymentCount: number;
  reconciledPaymentCount: number;
  feeCoverageCount: number;
  ledgerFeeEvidenceCount: number;
  reconciliationFallbackFeeCount: number;
  ledgerProviderFeesMinor: number;
  reconciliationFallbackFeesMinor: number;
  explicitNetReceivedMinor: number;
  explicitNetReceivedCount: number;
  releaseDateEvidenceCount: number;
  complete: boolean;
};

type ProviderPeriodPayload = {
  storeId?: string;
  summary?: ProviderPeriodSummary;
  error?: string;
};

const money = (minor: number): string =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(minor / 100);

const monthLabel = (period: string): string => {
  const [year, month] = period.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, 1));
  return new Intl.DateTimeFormat('pt-BR', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
};

async function fetchProviderPeriod(storeId: string, period: string): Promise<ProviderPeriodSummary> {
  const user = auth.currentUser;
  if (!user) throw new Error('Faça login novamente.');
  const token = await user.getIdToken();
  const params = new URLSearchParams({
    transport: 'store-promotions',
    surface: 'finance-history',
    path: 'provider-period-summary',
    storeId,
    period,
  });
  const response = await fetch(`/api/health?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (!contentType.includes('application/json')) {
    throw new Error('A conciliação mensal do Mercado Pago respondeu em um formato inesperado.');
  }
  const payload = await response.json() as ProviderPeriodPayload;
  if (!response.ok) {
    throw new Error(payload.error || 'Não foi possível consolidar a conciliação do Mercado Pago.');
  }
  if (!payload.summary?.complete) {
    throw new Error('A conciliação mensal do Mercado Pago não foi concluída.');
  }
  return payload.summary;
}

export default function StoreMercadoPagoPeriodSummaryWorkspace({ storeId }: { storeId: string }) {
  const currentMonth = useMemo(() => new Date().toISOString().slice(0, 7), []);
  const [period, setPeriod] = useState(currentMonth);
  const [summary, setSummary] = useState<ProviderPeriodSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setSummary(await fetchProviderPeriod(storeId, period));
    } catch (caught) {
      setSummary(null);
      setError(caught instanceof Error ? caught.message : 'Não foi possível carregar a conciliação do Mercado Pago.');
    } finally {
      setLoading(false);
    }
  }, [storeId, period]);

  useEffect(() => { void load(); }, [load]);

  const knownProviderFeesMinor = summary
    ? summary.ledgerProviderFeesMinor + summary.reconciliationFallbackFeesMinor
    : 0;
  const feeCoverageComplete = Boolean(summary && summary.paymentCount > 0 && summary.feeCoverageCount === summary.paymentCount);
  const reconciliationComplete = Boolean(summary && summary.paymentCount > 0 && summary.reconciledPaymentCount === summary.paymentCount);

  return (
    <section className="min-w-0 max-w-full overflow-hidden rounded-3xl border border-sky-500/20 bg-slate-900 p-5 text-white" data-kyrub-mercado-pago-period-summary="provider-evidence">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <span className="font-mono text-[9px] font-black uppercase tracking-[0.16em] text-sky-300">Mercado Pago</span>
          <h4 className="mt-1 text-xs font-black uppercase">Conciliação real por período</h4>
          <p className="mt-2 max-w-3xl text-[9px] leading-relaxed text-slate-400">
            Mostra somente evidências já registradas pelo provedor: taxas, líquido recebido e liberação. Campos sem evidência permanecem incompletos em vez de receber estimativas.
          </p>
        </div>
        <input
          type="month"
          value={period}
          onChange={event => setPeriod(event.target.value || currentMonth)}
          className="min-h-9 shrink-0 rounded-xl border border-slate-700 bg-slate-950 px-3 text-[9px] text-slate-200 outline-none focus:border-sky-400"
        />
      </div>

      <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950 p-3 text-[9px] text-slate-400">
        Competência: <strong className="capitalize text-white">{monthLabel(period)}</strong>
      </div>

      {loading ? (
        <p className="mt-4 rounded-2xl border border-dashed border-slate-700 p-4 text-center text-[9px] text-slate-500">Consolidando evidências do Mercado Pago…</p>
      ) : error ? (
        <div className="mt-4 rounded-2xl border border-rose-500/20 bg-rose-500/10 p-4 text-[9px] text-rose-200">
          {error}
          <button type="button" onClick={() => void load()} className="ml-3 rounded-lg border border-rose-400/30 px-3 py-1.5 text-[8px] font-black uppercase">Tentar novamente</button>
        </div>
      ) : summary?.paymentCount === 0 ? (
        <p className="mt-4 rounded-2xl border border-dashed border-slate-700 p-4 text-center text-[9px] text-slate-500">Nenhuma venda Mercado Pago confirmada foi encontrada nesta competência.</p>
      ) : summary ? (
        <>
          <div className="mt-4 grid min-w-0 gap-2 sm:grid-cols-2 xl:grid-cols-5">
            <article className="rounded-2xl border border-slate-800 bg-slate-950 p-3"><span className="text-[8px] font-black uppercase text-slate-600">Pagamentos MP</span><strong className="mt-1 block text-sm text-white">{summary.paymentCount}</strong></article>
            <article className="rounded-2xl border border-slate-800 bg-slate-950 p-3"><span className="text-[8px] font-black uppercase text-slate-600">Conciliados</span><strong className={`mt-1 block text-sm ${reconciliationComplete ? 'text-emerald-200' : 'text-amber-200'}`}>{summary.reconciledPaymentCount}/{summary.paymentCount}</strong></article>
            <article className="rounded-2xl border border-slate-800 bg-slate-950 p-3"><span className="text-[8px] font-black uppercase text-slate-600">Taxas com evidência</span><strong className={`mt-1 block text-sm ${feeCoverageComplete ? 'text-emerald-200' : 'text-amber-200'}`}>{summary.feeCoverageCount}/{summary.paymentCount}</strong></article>
            <article className="rounded-2xl border border-sky-500/20 bg-sky-500/[0.06] p-3"><span className="text-[8px] font-black uppercase text-sky-300">Taxas conhecidas</span><strong className="mt-1 block text-sm text-amber-200">{money(knownProviderFeesMinor)}</strong></article>
            <article className="rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.05] p-3"><span className="text-[8px] font-black uppercase text-emerald-300">Líquido explícito</span><strong className="mt-1 block text-sm text-emerald-200">{money(summary.explicitNetReceivedMinor)}</strong><span className="mt-1 block text-[7px] text-slate-600">{summary.explicitNetReceivedCount} pagamento(s)</span></article>
          </div>

          <div className="mt-4 grid min-w-0 gap-3 lg:grid-cols-2">
            <article className="rounded-2xl border border-slate-800 bg-slate-950 p-4 text-[9px]">
              <h5 className="text-[10px] font-black uppercase text-slate-200">Cobertura da evidência</h5>
              <div className="mt-3 space-y-2">
                <div className="flex justify-between gap-3"><span className="text-slate-500">Taxa já presente no ledger</span><b>{summary.ledgerFeeEvidenceCount}</b></div>
                <div className="flex justify-between gap-3"><span className="text-slate-500">Taxa recuperada pela conciliação MP</span><b>{summary.reconciliationFallbackFeeCount}</b></div>
                <div className="flex justify-between gap-3"><span className="text-slate-500">Pagamento com líquido explícito do provedor</span><b>{summary.explicitNetReceivedCount}</b></div>
                <div className="flex justify-between gap-3"><span className="text-slate-500">Pagamento com data de liberação</span><b>{summary.releaseDateEvidenceCount}</b></div>
              </div>
            </article>

            <article className="rounded-2xl border border-slate-800 bg-slate-950 p-4 text-[9px] leading-relaxed text-slate-500">
              <h5 className="text-[10px] font-black uppercase text-slate-200">Como interpretar</h5>
              <p className="mt-3">“Líquido explícito” é a soma apenas dos pagamentos em que o próprio Mercado Pago informou <code className="text-sky-200">net_received_amount</code>. Se a cobertura não for total, esse valor não representa o líquido completo do mês.</p>
              <p className="mt-2">As taxas conhecidas combinam a evidência já registrada no ledger com a conciliação do provedor somente quando o ledger ainda não tinha aquela taxa, evitando dupla contagem.</p>
            </article>
          </div>

          {!feeCoverageComplete && (
            <p className="mt-4 rounded-2xl border border-amber-500/20 bg-amber-500/10 p-3 text-[8px] leading-relaxed text-amber-100">
              Ainda existem pagamentos Mercado Pago sem taxa evidenciada. O Kyrub não preencherá essa diferença por estimativa. Abra a venda correspondente no Histórico financeiro e use “Conciliar Mercado Pago” para ampliar a cobertura quando possível.
            </p>
          )}
        </>
      ) : null}
    </section>
  );
}
