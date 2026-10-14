import { useCallback, useEffect, useRef, useState } from 'react';
import { auth } from '../../utils/firebase';
import { createFinanceRequestGuard } from '../../utils/financeLatestRequestGuard';

type MercadoPagoReviewIssue =
  | 'missing_reconciliation' | 'invalid_reconciliation'
  | 'gross_divergence' | 'fee_divergence'
  | 'missing_provider_fee' | 'missing_net_amount'
  | 'missing_refund_information' | 'missing_release_information';

type MercadoPagoReviewItem = {
  paymentId: string;
  orderId: string;
  providerPaymentId: string;
  canonicalGrossMinor: number;
  providerGrossMinor: number | null;
  ledgerProviderFeeMinor: number | null;
  providerFeeMinor: number | null;
  netReceivedMinor: number | null;
  issues: MercadoPagoReviewIssue[];
};

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
  ledgerScanComplete: boolean;
  // True only when all required provider evidence is present, not when the
  // ledger scan itself finishes. A false value is a useful partial report.
  complete: boolean;
  balanced: boolean;
  hasDivergences: boolean;
  grossDivergenceCount: number;
  feeDivergenceCount: number;
  reviewIssueCount?: number;
  reviewItems?: MercadoPagoReviewItem[];
  reviewItemsOmittedCount?: number;
};

type ProviderPeriodPayload = {
  storeId?: string;
  summary?: ProviderPeriodSummary;
  error?: string;
};

const money = (minor: number): string =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(minor / 100);

const knownMoney = (minor: number | null): string =>
  minor === null ? 'Sem evidência' : money(minor);

const reviewIssueLabel: Record<MercadoPagoReviewIssue, string> = {
  missing_reconciliation: 'Sem conciliação do provedor',
  invalid_reconciliation: 'Conciliação incompatível ou inválida',
  gross_divergence: 'Valor bruto divergente',
  fee_divergence: 'Taxa divergente',
  missing_provider_fee: 'Taxa sem evidência oficial',
  missing_net_amount: 'Líquido não informado',
  missing_refund_information: 'Situação de estorno não informada',
  missing_release_information: 'Liberação não informada',
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
  if (!payload.summary?.ledgerScanComplete) {
    throw new Error('A leitura dos registros mensais não foi concluída com segurança.');
  }
  return payload.summary;
}

export default function StoreMercadoPagoPeriodSummaryWorkspace({ storeId, period, onReviewPayment }: {
  storeId: string; period: string; onReviewPayment?: (paymentId: string) => void;
}) {
  const [summary, setSummary] = useState<ProviderPeriodSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const requestGuard = useRef(createFinanceRequestGuard());

  const load = useCallback(async () => {
    const generation = requestGuard.current.begin();
    setLoading(true);
    setError('');
    try {
      const next = await fetchProviderPeriod(storeId, period);
      if (!requestGuard.current.isCurrent(generation)) return;
      if (next.period !== period) throw new Error('A conciliação retornou uma competência diferente da selecionada.');
      setSummary(next);
    } catch (caught) {
      if (!requestGuard.current.isCurrent(generation)) return;
      setSummary(null);
      setError(caught instanceof Error ? caught.message : 'Não foi possível carregar a conciliação do Mercado Pago.');
    } finally {
      if (requestGuard.current.isCurrent(generation)) setLoading(false);
    }
  }, [storeId, period]);

  useEffect(() => {
    void load();
    return () => requestGuard.current.invalidate();
  }, [load]);

  const knownProviderFeesMinor = summary
    ? summary.ledgerProviderFeesMinor + summary.reconciliationFallbackFeesMinor
    : 0;
  const feeCoverageComplete = Boolean(summary && summary.paymentCount > 0 && summary.feeCoverageCount === summary.paymentCount);
  const reconciliationComplete = Boolean(summary && summary.paymentCount > 0 && summary.reconciledPaymentCount === summary.paymentCount);
  const evidenceComplete = summary?.complete === true;
  const hasDivergences = Boolean(summary?.hasDivergences);

  return (
    <section className="min-w-0 max-w-full overflow-hidden rounded-2xl border border-sky-500/20 bg-slate-900 p-3 text-white sm:p-5" data-kyrub-mercado-pago-period-summary="provider-evidence">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="font-mono text-[9px] font-black uppercase tracking-widest text-sky-300">Mercado Pago</span>
          <h4 className="mt-1 text-sm font-bold">Conciliação mensal</h4>
        </div>
        <span className="rounded-lg border border-sky-500/20 px-2 py-1 text-[9px] text-sky-100">Competência do painel</span>
      </div>

      {loading ? (
        <p className="mt-3 rounded-xl bg-slate-950 p-4 text-[10px] text-slate-400">Carregando evidências do Mercado Pago…</p>
      ) : error ? (
        <div className="mt-3 rounded-xl border border-rose-500/20 bg-slate-950 p-3 text-[10px] text-rose-200">
          {error}
          <button type="button" onClick={() => void load()} className="ml-3 min-h-9 rounded-lg border border-rose-400/30 px-3">Tentar novamente</button>
        </div>
      ) : summary?.paymentCount === 0 ? (
        <p className="mt-3 rounded-xl bg-slate-950 p-3 text-[10px] text-slate-400">Nenhuma venda Mercado Pago confirmada nesta competência.</p>
      ) : summary ? (
        <>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-700 bg-slate-950 p-3 text-[10px]"
            data-kyrub-mp-evidence-state={evidenceComplete ? 'complete' : 'partial'}>
            <strong className={evidenceComplete ? 'text-emerald-200' : 'text-amber-200'}>
              {evidenceComplete ? 'Evidências completas' : 'Conciliação com evidências pendentes'}
            </strong>
            <span className="text-slate-400">{summary.reviewIssueCount ?? 0} pagamento(s) para conferir</span>
          </div>

          <div className="mt-3 grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-4" data-kyrub-mp-compact-indicators="true">
            <article className="min-w-0 rounded-xl bg-slate-950 p-3">
              <span className="block text-[9px] text-slate-400">Pagamentos MP</span>
              <strong className="mt-1 block text-base">{summary.paymentCount}</strong>
            </article>
            <article className="min-w-0 rounded-xl bg-slate-950 p-3">
              <span className="block text-[9px] text-slate-400">Conciliados</span>
              <strong className={reconciliationComplete ? 'mt-1 block text-base text-emerald-200' : 'mt-1 block text-base text-amber-200'}>
                {summary.reconciledPaymentCount}/{summary.paymentCount}
              </strong>
            </article>
            <article className="min-w-0 rounded-xl bg-slate-950 p-3">
              <span className="block text-[9px] text-slate-400">Taxas conhecidas</span>
              <strong className="mt-1 block text-sm text-sky-100">
                {summary.feeCoverageCount === 0 ? 'Sem evidência' : money(knownProviderFeesMinor)}
              </strong>
              <span className="mt-1 block text-[8px] text-slate-500">Cobertura {summary.feeCoverageCount}/{summary.paymentCount}</span>
            </article>
            <article className="min-w-0 rounded-xl bg-slate-950 p-3">
              <span className="block text-[9px] text-slate-400">Líquido informado MP</span>
              <strong className="mt-1 block text-sm text-emerald-200">
                {summary.explicitNetReceivedCount === 0 ? 'Sem evidência' : money(summary.explicitNetReceivedMinor)}
              </strong>
              <span className="mt-1 block text-[8px] text-slate-500">Cobertura {summary.explicitNetReceivedCount}/{summary.paymentCount}</span>
            </article>
          </div>
          {(summary.feeCoverageCount > 0 && !feeCoverageComplete
            || summary.explicitNetReceivedCount > 0 && summary.explicitNetReceivedCount < summary.paymentCount) && (
            <p className="mt-2 text-[9px] text-amber-100">Totais parciais: existem pagamentos sem evidência. Os valores conhecidos não representam o mês inteiro.</p>
          )}

          {hasDivergences && (
            <p className="mt-3 rounded-xl border border-rose-500/25 bg-rose-500/10 p-3 text-[10px] text-rose-200"
              data-kyrub-mp-divergence="provider-vs-ledger">
              Divergências: {summary.grossDivergenceCount} valor(es) brutos e {summary.feeDivergenceCount} taxa(s).
              Nenhum valor foi corrigido automaticamente.
            </p>
          )}
          {(summary.reviewIssueCount ?? 0) > 0 && (
            <details className="mt-3 rounded-xl border border-amber-500/25 bg-slate-950 p-3" data-kyrub-mp-payment-review="true">
              <summary className="min-h-9 cursor-pointer text-[11px] font-bold text-amber-100">
                Ver pagamentos para conferência ({summary.reviewIssueCount})
              </summary>
              <p className="mt-2 text-[9px] text-slate-400">Nenhum valor é modificado nesta consulta. A conferência abre o Histórico financeiro da mesma loja.</p>
              <div className="mt-3 space-y-2">
                {(summary.reviewItems ?? []).map(item => (
                  <article key={item.paymentId} className="min-w-0 rounded-xl border border-slate-800 bg-slate-900 p-3 text-[10px]">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <strong className="block text-white" title={item.orderId}>
                          Pedido …{item.orderId.slice(-8)}
                        </strong>
                        <span className="text-[9px] text-slate-400">Bruto no livro: {money(item.canonicalGrossMinor)}</span>
                      </div>
                      {onReviewPayment && (
                        <button type="button" onClick={() => onReviewPayment(item.paymentId)}
                          className="min-h-9 rounded-lg border border-sky-400/30 bg-sky-500/10 px-3 text-[9px] font-bold text-sky-100"
                          data-kyrub-mp-review-open-history={item.paymentId}>
                          Conferir no Histórico
                        </button>
                      )}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {item.issues.map(issue => (
                        <span key={issue} className="rounded-md border border-amber-500/20 px-2 py-1 text-[9px] text-amber-100">
                          {reviewIssueLabel[issue] ?? issue}
                        </span>
                      ))}
                    </div>
                    <details className="mt-2 text-[9px] text-slate-400" data-kyrub-mp-item-evidence="collapsed">
                      <summary className="min-h-8 cursor-pointer py-1">Ver valores por fonte e identificadores</summary>
                      <div className="mt-1 space-y-1 rounded-lg bg-slate-950 p-2">
                        <p>Bruto no livro: {money(item.canonicalGrossMinor)}</p>
                        <p>Bruto MP: {knownMoney(item.providerGrossMinor)}</p>
                        <p>Taxa no livro: {knownMoney(item.ledgerProviderFeeMinor)}</p>
                        <p>Taxa MP: {knownMoney(item.providerFeeMinor)}</p>
                        <p>Líquido explícito MP: {knownMoney(item.netReceivedMinor)}</p>
                        <p className="break-all">Pedido: {item.orderId}</p>
                        <p className="break-all">Pagamento: {item.paymentId}</p>
                        <p className="break-all">ID Mercado Pago: {item.providerPaymentId}</p>
                      </div>
                    </details>
                  </article>
                ))}
              </div>
              {(summary.reviewItemsOmittedCount ?? 0) > 0 && (
                <p className="mt-3 text-[9px] text-amber-100">
                  Outros {summary.reviewItemsOmittedCount} pagamento(s) com pendências não aparecem nesta lista. Consulte o Histórico financeiro completo.
                </p>
              )}
            </details>
          )}

          <details className="mt-3 rounded-xl border border-slate-800 bg-slate-950 p-3 text-[10px] text-slate-400"
            data-kyrub-mp-evidence-technical="collapsed">
            <summary className="min-h-9 cursor-pointer font-medium text-slate-200">Cobertura da evidência e explicações</summary>
            <div className="mt-3 space-y-2">
              <div className="flex justify-between gap-3"><span>Taxa já presente no ledger</span><b>{summary.ledgerFeeEvidenceCount}</b></div>
              <div className="flex justify-between gap-3"><span>Taxa recuperada na conciliação</span><b>{summary.reconciliationFallbackFeeCount}</b></div>
              <div className="flex justify-between gap-3"><span>Líquido explícito do provedor</span><b>{summary.explicitNetReceivedCount}</b></div>
              <div className="flex justify-between gap-3"><span>Liberação informada pelo provedor</span><b>{summary.releaseDateEvidenceCount}</b></div>
              {!evidenceComplete && (
                <p className="rounded-lg border border-amber-500/20 p-2 text-amber-100"
                  data-kyrub-mp-missing-evidence="true">
                  Há evidências de conciliação ainda ausentes: taxas, líquido, estornos ou liberação.
                  O relatório mensal foi lido por completo, mas a conciliação continua parcial.
                </p>
              )}
              <p>Os valores das taxas combinam dados já registrados no livro e a evidência do MP apenas quando o livro ainda não a contém, sem contar a mesma taxa duas vezes.</p>
              <p>O líquido explícito utiliza somente valores informados pelo Mercado Pago. Isso não comprova transferência para a conta bancária.</p>
              <p>Pagamento confirmado não significa que as taxas, o líquido ou a liberação já foram conciliados.</p>
            </div>
          </details>
        </>
      ) : null}
    </section>
  );
}
