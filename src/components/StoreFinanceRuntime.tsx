import { useCallback, useEffect, useMemo, useState } from 'react';
import { auth } from '../utils/firebase';
import HistoricalFiscalSaleWorkspace from './store/HistoricalFiscalSaleWorkspace';

type LedgerKind =
  | 'payment_capture'
  | 'payment_refund'
  | 'payment_chargeback'
  | 'payment_chargeback_reversal';

type ObservedCost = {
  id: string;
  kind: 'provider_processing' | 'platform_service' | 'other';
  amountMinor: number;
  borneBy: 'customer' | 'store' | 'kyrub' | 'partner';
  beneficiary: string;
  source: string;
};

type StoreFinanceEntry = {
  id: string;
  kind: LedgerKind;
  currency: 'BRL';
  amountMinor: number;
  paymentId: string;
  paymentIntentId: string;
  orderId: string;
  buyerId: string;
  paymentMethod: 'pix' | 'card' | 'cash' | 'other';
  provider: string;
  providerPaymentId: string;
  sourceAuthority: 'provider_webhook' | 'canonical_payment_snapshot' | 'operator_attestation';
  occurredAt: string;
  economicAllocation?: {
    observedCosts?: ObservedCost[];
  };
};

type StoreFinanceSummary = {
  currency: 'BRL';
  capturedMinor: number;
  refundedMinor: number;
  grossAfterRefundsMinor: number;
  chargedBackMinor: number;
  chargebackReversedMinor: number;
  economicNetMinor: number;
  entryCount: number;
};

type StoreReceivableStatus = 'pending' | 'eligible' | 'settled' | 'reversed';

type StoreReceivable = {
  id: string;
  status: StoreReceivableStatus;
  amountMinor: number;
  paymentId: string;
  orderId: string;
  createdAt: string;
  eligibleAt: string;
  settledAt: string;
  reversedAt: string;
};

type StoreReceivableSummary = {
  currency: 'BRL';
  pendingMinor: number;
  eligibleMinor: number;
  settledMinor: number;
  reversedMinor: number;
  openMinor: number;
  count: number;
};

type StoreFinancePayload = {
  storeId?: string;
  summary?: StoreFinanceSummary;
  entries?: StoreFinanceEntry[];
  recoveredCount?: number;
  receivableSummary?: StoreReceivableSummary;
  receivables?: StoreReceivable[];
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

const authorityLabel = (authority: StoreFinanceEntry['sourceAuthority']): string => ({
  provider_webhook: 'Confirmado pelo provedor',
  canonical_payment_snapshot: 'Pagamento reconciliado',
  operator_attestation: 'Registro operacional',
}[authority]);

const methodLabel = (method: StoreFinanceEntry['paymentMethod']): string => ({
  pix: 'Pix', card: 'Cartão', cash: 'Dinheiro', other: 'Outro',
}[method]);

const receivableStatusLabel = (status: StoreReceivableStatus): string => ({
  pending: 'Aguardando condição de repasse',
  eligible: 'Elegível para repasse',
  settled: 'Repasse liquidado',
  reversed: 'Obrigação revertida',
}[status]);

const receivableStatusClass = (status: StoreReceivableStatus): string => ({
  pending: 'border-amber-500/20 bg-amber-500/10 text-amber-200',
  eligible: 'border-cyan-500/20 bg-cyan-500/10 text-cyan-200',
  settled: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200',
  reversed: 'border-slate-700 bg-slate-900 text-slate-400',
}[status]);

const providerFeeMinor = (entry: StoreFinanceEntry): number | null => {
  const costs = entry.economicAllocation?.observedCosts ?? [];
  const fees = costs.filter(cost => cost.kind === 'provider_processing' && cost.borneBy === 'store');
  if (!fees.length) return null;
  return fees.reduce((total, fee) => total + fee.amountMinor, 0);
};

async function loadStoreFinance(storeId: string): Promise<StoreFinancePayload> {
  const user = auth.currentUser;
  if (!user) throw new Error('Faça login novamente.');
  const token = await user.getIdToken();
  const response = await fetch(`/api/store-finance?storeId=${encodeURIComponent(storeId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (!contentType.includes('application/json')) {
    throw new Error('O Financeiro respondeu em um formato inesperado.');
  }
  const payload = await response.json() as StoreFinancePayload;
  if (!response.ok) throw new Error(payload.error || 'Não foi possível carregar o Financeiro.');
  return payload;
}

export function StoreFinanceRuntime({ storeId }: { storeId: string }) {
  const [payload, setPayload] = useState<StoreFinancePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [fiscalOrderId, setFiscalOrderId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setPayload(await loadStoreFinance(storeId));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível carregar o Financeiro.');
    } finally {
      setLoading(false);
    }
  }, [storeId]);

  useEffect(() => { void load(); }, [load]);

  const entries = payload?.entries ?? [];
  const summary = payload?.summary;
  const receivables = payload?.receivables ?? [];
  const receivableSummary = payload?.receivableSummary;
  const knownProviderFeesMinor = useMemo(
    () => entries.reduce((total, entry) => total + (providerFeeMinor(entry) ?? 0), 0),
    [entries]
  );
  const hasKnownProviderFees = useMemo(
    () => entries.some(entry => providerFeeMinor(entry) !== null),
    [entries]
  );

  if (loading) {
    return <section className="rounded-3xl border border-emerald-500/20 bg-slate-900 p-5 text-[10px] text-slate-400">Carregando movimentações financeiras reais…</section>;
  }

  if (error) {
    return (
      <section className="rounded-3xl border border-rose-500/25 bg-slate-900 p-5 text-white">
        <h3 className="text-sm font-black">Financeiro indisponível</h3>
        <p className="mt-2 text-[10px] text-rose-300">{error}</p>
        <button type="button" onClick={() => void load()} className="mt-4 min-h-10 rounded-xl border border-slate-700 px-4 text-[9px] font-black uppercase">Tentar novamente</button>
      </section>
    );
  }

  return (
    <section className="max-w-full space-y-4 overflow-x-hidden text-white" data-kyrub-store-finance-runtime="canonical-ledger">
      <div className="max-w-full overflow-hidden rounded-3xl border border-emerald-500/25 bg-slate-900 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <span className="font-mono text-[9px] font-black uppercase tracking-[0.16em] text-emerald-300">Financeiro Interno</span>
            <h3 className="mt-1 text-base font-black">Movimentações da loja</h3>
            <p className="mt-1 text-[10px] leading-relaxed text-slate-400">Valores vindos dos pagamentos canônicos do Kyrub. Nenhum lançamento de demonstração é exibido aqui.</p>
          </div>
          <button type="button" onClick={() => void load()} className="min-h-10 rounded-xl border border-slate-700 bg-slate-950 px-4 text-[9px] font-black uppercase text-slate-300">Atualizar</button>
        </div>
        {(payload?.recoveredCount ?? 0) > 0 && (
          <p className="mt-4 rounded-2xl border border-cyan-500/20 bg-cyan-500/10 p-3 text-[10px] text-cyan-100">
            {payload?.recoveredCount} pagamento(s) antigo(s) confirmado(s) foram reconciliados com o Financeiro.
          </p>
        )}
      </div>

      <div className="grid min-w-0 max-w-full gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <article className="min-w-0 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 p-4"><span className="text-[8px] font-black uppercase text-slate-500">Recebido bruto</span><strong className="mt-2 block text-lg">{money(summary?.capturedMinor ?? 0)}</strong></article>
        <article className="min-w-0 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 p-4"><span className="text-[8px] font-black uppercase text-slate-500">Estornos</span><strong className="mt-2 block text-lg">{money(summary?.refundedMinor ?? 0)}</strong></article>
        <article className="min-w-0 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 p-4"><span className="text-[8px] font-black uppercase text-slate-500">Taxas conhecidas do provedor</span><strong className="mt-2 block text-lg">{hasKnownProviderFees ? money(knownProviderFeesMinor) : 'Não informado'}</strong></article>
        <article className="min-w-0 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 p-4"><span className="text-[8px] font-black uppercase text-slate-500">Saldo após reversões</span><strong className="mt-2 block text-lg">{money(summary?.economicNetMinor ?? 0)}</strong><span className="mt-1 block text-[8px] text-slate-500">Não representa o líquido do PSP quando a taxa ainda não foi informada.</span></article>
      </div>

      <div className="min-w-0 max-w-full overflow-hidden rounded-3xl border border-cyan-500/20 bg-slate-900 p-5" data-kyrub-store-receivables="canonical">
        <div className="min-w-0">
          <span className="font-mono text-[9px] font-black uppercase tracking-[0.16em] text-cyan-300">Repasses a receber</span>
          <h4 className="mt-1 text-xs font-black uppercase">Obrigações econômicas da loja</h4>
          <p className="mt-2 text-[9px] leading-relaxed text-slate-400">
            Mostra somente repasses canônicos criados a partir de vendas pagas com alocação econômica registrada. Não inclui contas a receber lançadas manualmente nem estima valores sem evidência.
          </p>
        </div>

        <div className="mt-4 grid min-w-0 gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <article className="min-w-0 rounded-2xl border border-slate-800 bg-slate-950 p-3"><span className="text-[8px] font-black uppercase text-slate-600">Aguardando condição</span><strong className="mt-1 block text-sm text-amber-200">{money(receivableSummary?.pendingMinor ?? 0)}</strong></article>
          <article className="min-w-0 rounded-2xl border border-slate-800 bg-slate-950 p-3"><span className="text-[8px] font-black uppercase text-slate-600">Elegível para repasse</span><strong className="mt-1 block text-sm text-cyan-200">{money(receivableSummary?.eligibleMinor ?? 0)}</strong></article>
          <article className="min-w-0 rounded-2xl border border-slate-800 bg-slate-950 p-3"><span className="text-[8px] font-black uppercase text-slate-600">Em aberto</span><strong className="mt-1 block text-sm">{money(receivableSummary?.openMinor ?? 0)}</strong></article>
          <article className="min-w-0 rounded-2xl border border-slate-800 bg-slate-950 p-3"><span className="text-[8px] font-black uppercase text-slate-600">Já liquidado</span><strong className="mt-1 block text-sm text-emerald-200">{money(receivableSummary?.settledMinor ?? 0)}</strong></article>
        </div>

        {receivables.length === 0 ? (
          <p className="mt-4 rounded-2xl border border-dashed border-slate-700 p-4 text-center text-[9px] leading-relaxed text-slate-500">
            Ainda não há repasse canônico registrado para esta loja. Vendas diretas sem alocação econômica não são transformadas artificialmente em contas a receber.
          </p>
        ) : (
          <div className="mt-4 min-w-0 space-y-2">
            {receivables.map(receivable => (
              <article key={receivable.id} className="min-w-0 max-w-full overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 p-3">
                <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <span className={`inline-block max-w-full whitespace-normal break-words rounded-full border px-2 py-1 text-[7px] font-black uppercase leading-tight ${receivableStatusClass(receivable.status)}`}>
                      {receivableStatusLabel(receivable.status)}
                    </span>
                    <p className="mt-2 max-w-full break-words text-[9px] leading-relaxed text-slate-500 [overflow-wrap:anywhere]">Pedido {receivable.orderId}</p>
                    <p className="mt-1 text-[8px] text-slate-600">Criado em {dateTime(receivable.createdAt)}</p>
                    {receivable.status === 'eligible' && receivable.eligibleAt && <p className="mt-1 text-[8px] text-cyan-300/70">Elegível desde {dateTime(receivable.eligibleAt)}</p>}
                    {receivable.status === 'settled' && receivable.settledAt && <p className="mt-1 text-[8px] text-emerald-300/70">Liquidado em {dateTime(receivable.settledAt)}</p>}
                    {receivable.status === 'reversed' && receivable.reversedAt && <p className="mt-1 text-[8px] text-slate-500">Revertido em {dateTime(receivable.reversedAt)}</p>}
                  </div>
                  <strong className="shrink-0 text-left text-sm text-cyan-100 sm:text-right">{money(receivable.amountMinor)}</strong>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      <div className="min-w-0 max-w-full overflow-hidden rounded-3xl border border-slate-800 bg-slate-900 p-5">
        <div className="mb-4 flex items-center justify-between gap-3"><div className="min-w-0"><h4 className="text-xs font-black uppercase">Movimentações</h4><p className="mt-1 text-[9px] text-slate-500">{summary?.entryCount ?? entries.length} lançamento(s)</p></div></div>
        {entries.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-slate-700 p-5 text-center text-[10px] text-slate-400">Ainda não há pagamento confirmado registrado para esta loja.</p>
        ) : (
          <div className="min-w-0 space-y-3">
            {entries.map(entry => {
              const feeMinor = providerFeeMinor(entry);
              const providerNetMinor = entry.kind === 'payment_capture' && feeMinor !== null
                ? entry.amountMinor - feeMinor
                : null;
              const fiscalOpen = fiscalOrderId === entry.orderId;
              return (
                <article key={entry.id} className="min-w-0 max-w-full overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 p-4">
                  <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <strong className="text-xs">{kindLabel(entry.kind)}</strong>
                        <span className="max-w-full whitespace-normal break-words rounded-full bg-emerald-500/10 px-2 py-1 text-left text-[8px] font-black uppercase leading-tight text-emerald-300">{authorityLabel(entry.sourceAuthority)}</span>
                      </div>
                      <p className="mt-1 max-w-full break-words text-[9px] leading-relaxed text-slate-500 [overflow-wrap:anywhere]">Pedido {entry.orderId} · {methodLabel(entry.paymentMethod)} · {entry.provider || 'provedor não informado'}</p>
                      <p className="mt-1 text-[9px] text-slate-600">{dateTime(entry.occurredAt)}</p>
                    </div>
                    <strong className={`shrink-0 text-left sm:text-right ${entry.amountMinor >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>{money(entry.amountMinor)}</strong>
                  </div>
                  {entry.kind === 'payment_capture' && (
                    <>
                      <div className="mt-3 grid min-w-0 gap-2 border-t border-slate-800 pt-3 text-[9px] sm:grid-cols-3">
                        <div className="min-w-0"><span className="block uppercase text-slate-600">Bruto</span><b>{money(entry.amountMinor)}</b></div>
                        <div className="min-w-0"><span className="block uppercase text-slate-600">Taxa do provedor</span><b>{feeMinor === null ? 'Não informada' : money(feeMinor)}</b></div>
                        <div className="min-w-0"><span className="block uppercase text-slate-600">Líquido do provedor</span><b>{providerNetMinor === null ? 'Aguardando evidência' : money(providerNetMinor)}</b></div>
                      </div>

                      <div className="mt-3 min-w-0 rounded-xl border border-violet-500/20 bg-violet-500/[0.035] p-3">
                        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-[8px] font-black uppercase tracking-wide text-violet-300">Documento fiscal</span>
                              <span className="rounded-full border border-violet-500/20 bg-violet-500/10 px-2 py-1 text-[7px] font-black uppercase text-violet-200">Homologação</span>
                            </div>
                            <p className="mt-1 text-[8px] leading-relaxed text-slate-500">Reabra o pedido original desta venda para consultar as evidências fiscais e preparar o documento, inclusive quando o cliente solicitar a nota depois da compra.</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => setFiscalOrderId(fiscalOpen ? null : entry.orderId)}
                            className="min-h-9 shrink-0 rounded-lg border border-violet-500/25 bg-violet-500/10 px-3 text-[8px] font-black uppercase text-violet-100"
                            aria-expanded={fiscalOpen}
                          >
                            {fiscalOpen ? 'Fechar fiscal' : 'Abrir fiscal'}
                          </button>
                        </div>
                      </div>

                      {fiscalOpen && (
                        <HistoricalFiscalSaleWorkspace
                          orderId={entry.orderId}
                          onClose={() => setFiscalOrderId(null)}
                        />
                      )}
                    </>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
