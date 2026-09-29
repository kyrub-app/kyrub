import { useCallback, useEffect, useMemo, useState } from 'react';
import { auth } from '../../utils/firebase';

type LedgerKind = 'payment_capture' | 'payment_refund' | 'payment_chargeback' | 'payment_chargeback_reversal';
type PaymentMethod = 'pix' | 'card' | 'cash' | 'other';
type SourceAuthority = 'provider_webhook' | 'canonical_payment_snapshot' | 'operator_attestation';
type Transaction = {
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
  items?: Transaction[];
  nextCursor?: string;
  hasMore?: boolean;
  recoveredCount?: number;
  error?: string;
};

const money = (minor: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(minor / 100);
const dateTime = (value: string) => {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date) : value;
};
const kindLabel = (kind: LedgerKind) => ({
  payment_capture: 'Venda recebida',
  payment_refund: 'Estorno',
  payment_chargeback: 'Chargeback',
  payment_chargeback_reversal: 'Reversão de chargeback',
}[kind]);
const methodLabel = (method: PaymentMethod) => ({ pix: 'Pix', card: 'Cartão', cash: 'Dinheiro', other: 'Outro' }[method]);

async function fetchTransactions(input: { storeId: string; cursor?: string }): Promise<HistoryPayload> {
  const user = auth.currentUser;
  if (!user) throw new Error('Faça login novamente.');
  const token = await user.getIdToken();
  const params = new URLSearchParams({
    transport: 'store-promotions',
    surface: 'finance-history',
    mode: 'history',
    storeId: input.storeId,
    limit: '25',
    kind: 'all',
    paymentMethod: 'all',
  });
  if (input.cursor) params.set('cursor', input.cursor);
  const response = await fetch(`/api/health?${params.toString()}`, { headers: { Authorization: `Bearer ${token}` } });
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (!contentType.includes('application/json')) throw new Error('As transações do Caixa responderam em um formato inesperado.');
  const payload = await response.json() as HistoryPayload;
  if (!response.ok) throw new Error(payload.error || 'Não foi possível carregar as transações do Caixa.');
  return payload;
}

export default function StoreCashTransactionsWorkspace({ storeId }: { storeId: string }) {
  const [items, setItems] = useState<Transaction[]>([]);
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
      const payload = await fetchTransactions({ storeId, ...(append && cursor ? { cursor } : {}) });
      const nextItems = payload.items ?? [];
      setItems(current => append ? [...current, ...nextItems] : nextItems);
      setCursor(payload.nextCursor ?? '');
      setHasMore(Boolean(payload.hasMore && payload.nextCursor));
      setRecoveredCount(current => append ? current + (payload.recoveredCount ?? 0) : (payload.recoveredCount ?? 0));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível carregar as transações do Caixa.');
      if (!append) setItems([]);
    } finally {
      append ? setLoadingMore(false) : setLoading(false);
    }
  }, [storeId, cursor]);

  useEffect(() => {
    setCursor('');
    setHasMore(false);
    setRecoveredCount(0);
    void load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId]);

  const capturedMinor = useMemo(() => items.filter(item => item.kind === 'payment_capture').reduce((sum, item) => sum + Math.abs(item.amountMinor), 0), [items]);
  const refundedMinor = useMemo(() => items.filter(item => item.kind === 'payment_refund').reduce((sum, item) => sum + Math.abs(item.amountMinor), 0), [items]);

  return (
    <section className="min-w-0 max-w-full overflow-hidden rounded-3xl border border-cyan-500/20 bg-slate-900 p-5 text-white" data-kyrub-cash-transactions="canonical-readonly">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <span className="font-mono text-[9px] font-black uppercase tracking-[0.16em] text-cyan-300">Transações</span>
          <h4 className="mt-1 text-xs font-black uppercase">Pagamentos reais da loja</h4>
          <p className="mt-2 max-w-3xl text-[9px] leading-relaxed text-slate-400">Visão operacional somente leitura do ledger econômico canônico. Funciona independentemente de haver turno de caixa aberto e não duplica lançamentos no Financeiro.</p>
        </div>
        <span className="shrink-0 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-2 text-[8px] font-black uppercase text-cyan-200">Somente leitura</span>
      </div>

      <div className="mt-4 grid min-w-0 gap-2 sm:grid-cols-3">
        <article className="rounded-2xl border border-slate-800 bg-slate-950 p-3"><span className="text-[8px] font-black uppercase text-slate-600">Recebido carregado</span><strong className="mt-1 block text-sm text-emerald-200">{money(capturedMinor)}</strong></article>
        <article className="rounded-2xl border border-slate-800 bg-slate-950 p-3"><span className="text-[8px] font-black uppercase text-slate-600">Estornado carregado</span><strong className="mt-1 block text-sm text-rose-200">{money(refundedMinor)}</strong></article>
        <article className="rounded-2xl border border-slate-800 bg-slate-950 p-3"><span className="text-[8px] font-black uppercase text-slate-600">Transações carregadas</span><strong className="mt-1 block text-sm text-slate-200">{items.length}</strong></article>
      </div>

      {recoveredCount > 0 && <p className="mt-3 rounded-xl border border-cyan-500/20 bg-cyan-500/10 p-3 text-[9px] text-cyan-100">{recoveredCount} pagamento(s) histórico(s) confirmado(s) foram incorporados ao ledger durante esta leitura, sem duplicar receita.</p>}
      {loading ? <p className="mt-4 rounded-2xl border border-dashed border-slate-700 p-5 text-center text-[9px] text-slate-500">Carregando transações…</p> : error ? <div className="mt-4 rounded-2xl border border-rose-500/20 bg-rose-500/10 p-4 text-[9px] text-rose-200">{error}<button type="button" onClick={() => void load(false)} className="ml-3 rounded-lg border border-rose-400/30 px-3 py-1.5 text-[8px] font-black uppercase">Tentar novamente</button></div> : items.length === 0 ? <p className="mt-4 rounded-2xl border border-dashed border-slate-700 p-5 text-center text-[9px] text-slate-500">Nenhuma transação canônica encontrada.</p> : <div className="mt-4 min-w-0 space-y-2">{items.map(item => <article key={item.id} className="min-w-0 rounded-2xl border border-slate-800 bg-slate-950 p-4"><div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><strong className="text-[10px]">{kindLabel(item.kind)}</strong><span className="rounded-full border border-slate-700 px-2 py-1 text-[7px] font-black uppercase text-slate-500">{methodLabel(item.paymentMethod)}</span>{item.provider && <span className="max-w-full break-words rounded-full border border-slate-700 px-2 py-1 text-[7px] font-black uppercase text-slate-500">{item.provider}</span>}</div><p className="mt-2 break-words text-[8px] text-slate-500 [overflow-wrap:anywhere]">Pedido {item.orderId || 'não informado'}</p><p className="mt-1 break-words text-[8px] text-slate-600 [overflow-wrap:anywhere]">Pagamento {item.paymentId}</p><p className="mt-1 text-[8px] text-slate-600">{dateTime(item.occurredAt)}</p></div><strong className={`shrink-0 text-left text-sm sm:text-right ${item.kind === 'payment_capture' || item.kind === 'payment_chargeback_reversal' ? 'text-emerald-200' : 'text-rose-200'}`}>{item.kind === 'payment_capture' || item.kind === 'payment_chargeback_reversal' ? '+' : '−'}{money(Math.abs(item.amountMinor))}</strong></div></article>)}</div>}

      {hasMore && <button type="button" disabled={loadingMore} onClick={() => void load(true)} className="mt-4 min-h-10 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 text-[8px] font-black uppercase text-slate-300 disabled:opacity-50">{loadingMore ? 'Carregando…' : 'Carregar mais transações'}</button>}
      <p className="mt-4 text-[8px] leading-relaxed text-slate-600">O comando de reembolso permanece deliberadamente desabilitado nesta etapa. Primeiro validamos pedido, pagamento e valor capturado reais.</p>
    </section>
  );
}
