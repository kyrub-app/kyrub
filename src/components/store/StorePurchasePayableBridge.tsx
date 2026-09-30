import { useCallback, useEffect, useMemo, useState } from 'react';
import { BadgeDollarSign, FileText, RefreshCw } from 'lucide-react';
import { auth } from '../../utils/firebase';
import type {
  StorePurchase,
  StoreSupplier,
} from '../../../shared/storePurchases';
import {
  nextStorePurchasePayableKey,
  storePurchasePayableKeyLabel,
  summarizeStorePurchasePayables,
} from '../../../shared/storePurchasePayableSchedule';

type CostNature = 'unspecified' | 'fixed' | 'variable';
type BillingDocumentType = 'none' | 'boleto' | 'invoice' | 'other';

type PurchaseView = StorePurchase & {
  receivingState: 'not_started' | 'partially_received' | 'received';
  receivedReceiptCount: number;
};

type ProcurementPayload = {
  purchases?: PurchaseView[];
  suppliers?: StoreSupplier[];
  error?: string;
};

type LinkedPayable = {
  id: string;
  status: 'open' | 'paid' | 'cancelled';
  amountMinor: number;
  dueDate: string;
  counterparty: string;
  sourceAuthority: 'store_owner_manual' | 'payroll_compensation_snapshot' | 'store_purchase';
  purchaseId?: string;
  supplierId?: string;
  purchasePayableKey?: string;
  costNature?: CostNature;
  billingDocumentType?: BillingDocumentType;
};

type FinancePayload = {
  payables?: LinkedPayable[];
  error?: string;
};

type LinkPayload = {
  status?: 'created' | 'existing';
  payable?: LinkedPayable;
  error?: string;
};

const money = (minor: number): string =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(minor / 100);

const amountToMinor = (value: string): number | null => {
  const normalized = value.trim().replace(/\s/g, '').replace(',', '.');
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const amount = Number(normalized);
  const minor = Math.round(amount * 100);
  return Number.isSafeInteger(minor) && minor > 0 ? minor : null;
};

const suggestedPurchaseTotalMinor = (purchase: StorePurchase): number | null => {
  if (purchase.lines.some(line => line.quotedUnitCostMinor === null)) return null;
  const total = purchase.lines.reduce(
    (sum, line) => sum + Math.round(line.orderedQuantity * Number(line.quotedUnitCostMinor)),
    0
  );
  return Number.isSafeInteger(total) && total > 0 ? total : null;
};

const payableStatusLabel = (status: LinkedPayable['status']): string => ({
  open: 'Em aberto',
  paid: 'Paga',
  cancelled: 'Cancelada',
}[status]);

const requestJson = async <T,>(url: string, init?: RequestInit): Promise<T> => {
  const user = auth.currentUser;
  if (!user) throw new Error('Faça login novamente.');
  const token = await user.getIdToken();
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (!contentType.includes('application/json')) {
    throw new Error('O servidor respondeu em um formato inesperado.');
  }
  const payload = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || 'Não foi possível concluir a operação.');
  return payload;
};

export function StorePurchasePayableBridge({ storeId }: { storeId: string }) {
  const [purchases, setPurchases] = useState<PurchaseView[]>([]);
  const [suppliers, setSuppliers] = useState<StoreSupplier[]>([]);
  const [payables, setPayables] = useState<LinkedPayable[]>([]);
  const [purchaseId, setPurchaseId] = useState('');
  const [amount, setAmount] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [costNature, setCostNature] = useState<CostNature>('unspecified');
  const [billingDocumentType, setBillingDocumentType] = useState<BillingDocumentType>('none');
  const [billingDocumentReference, setBillingDocumentReference] = useState('');
  const [billingDigitableLine, setBillingDigitableLine] = useState('');
  const [billingBarcode, setBillingBarcode] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError('');
    try {
      const [procurement, finance] = await Promise.all([
        requestJson<ProcurementPayload>(`/api/store-procurement?storeId=${encodeURIComponent(storeId)}`),
        requestJson<FinancePayload>(`/api/store-finance?storeId=${encodeURIComponent(storeId)}`),
      ]);
      setPurchases(Array.isArray(procurement.purchases) ? procurement.purchases : []);
      setSuppliers(Array.isArray(procurement.suppliers) ? procurement.suppliers : []);
      setPayables(Array.isArray(finance.payables) ? finance.payables : []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível carregar a ligação financeira.');
    } finally {
      setLoading(false);
    }
  }, [storeId]);

  useEffect(() => { void load(); }, [load]);

  const committedPurchases = useMemo(
    () => purchases.filter(purchase =>
      purchase.status === 'ordered'
      || purchase.status === 'partially_received'
      || purchase.status === 'received'
    ),
    [purchases]
  );
  const selectedPurchase = committedPurchases.find(purchase => purchase.id === purchaseId) ?? null;
  const supplierById = useMemo(
    () => new Map(suppliers.map(supplier => [supplier.id, supplier])),
    [suppliers]
  );
  const linkedPayables = useMemo(
    () => payables.filter(payable =>
      payable.sourceAuthority === 'store_purchase'
      && payable.purchaseId === purchaseId
    ),
    [payables, purchaseId]
  );
  const linkedPayablesSorted = useMemo(
    () => [...linkedPayables].sort((left, right) => {
      const byDueDate = left.dueDate.localeCompare(right.dueDate);
      if (byDueDate !== 0) return byDueDate;
      return (left.purchasePayableKey ?? '').localeCompare(right.purchasePayableKey ?? '');
    }),
    [linkedPayables]
  );
  const estimatedPurchaseTotalMinor = selectedPurchase
    ? suggestedPurchaseTotalMinor(selectedPurchase)
    : null;
  const payableSummary = useMemo(
    () => summarizeStorePurchasePayables(linkedPayables, estimatedPurchaseTotalMinor),
    [linkedPayables, estimatedPurchaseTotalMinor]
  );
  const nextPayableKey = nextStorePurchasePayableKey(
    linkedPayables.map(payable => payable.purchasePayableKey ?? '')
  );
  const nextPayableLabel = storePurchasePayableKeyLabel(nextPayableKey);

  useEffect(() => {
    if (!selectedPurchase) {
      setAmount('');
      setDueDate('');
      setFeedback('');
      setError('');
      return;
    }
    const suggested = payableSummary.differenceMinor !== null && payableSummary.differenceMinor > 0
      ? payableSummary.differenceMinor
      : linkedPayables.length === 0
        ? estimatedPurchaseTotalMinor
        : null;
    setAmount(suggested === null ? '' : (suggested / 100).toFixed(2).replace('.', ','));
    setDueDate('');
    setCostNature('unspecified');
    setBillingDocumentType('none');
    setBillingDocumentReference('');
    setBillingDigitableLine('');
    setBillingBarcode('');
    setFeedback('');
    setError('');
  }, [purchaseId, nextPayableKey, payableSummary.differenceMinor]);

  const createPayable = async (): Promise<void> => {
    if (!selectedPurchase) return;
    const amountMinor = amountToMinor(amount);
    if (amountMinor === null || !dueDate) {
      setError('Informe valor e vencimento válidos antes de registrar a obrigação.');
      return;
    }
    setSaving(true);
    setError('');
    setFeedback('');
    try {
      const result = await requestJson<LinkPayload>('/api/store-procurement/finance-payable', {
        method: 'POST',
        body: JSON.stringify({
          storeId,
          purchaseId: selectedPurchase.id,
          purchasePayableKey: nextPayableKey,
          amountMinor,
          dueDate,
          costNature,
          billingDocumentType,
          billingDocumentReference: billingDocumentType === 'none' ? '' : billingDocumentReference,
          billingDigitableLine: billingDocumentType === 'boleto' ? billingDigitableLine : '',
          billingBarcode: billingDocumentType === 'boleto' ? billingBarcode : '',
        }),
      });
      setFeedback(result.status === 'existing'
        ? `${nextPayableLabel} já estava vinculada; nenhuma duplicação foi criada.`
        : `${nextPayableLabel} registrada no Financeiro → Contas a pagar.`);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível registrar a obrigação.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="space-y-4 rounded-3xl border border-amber-500/20 bg-slate-900 p-4 sm:p-5" data-kyrub-purchase-payable-bridge="canonical">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-amber-200">
            <BadgeDollarSign className="h-4 w-4" />
            <span className="text-[9px] font-black uppercase tracking-[0.16em]">Compromisso financeiro</span>
          </div>
          <h3 className="mt-1 text-sm font-black text-white">Compra → Contas a pagar</h3>
          <p className="mt-1 max-w-2xl text-[10px] leading-relaxed text-slate-500">
            Uma compra pode ter várias obrigações com vencimentos próprios. Nada é parcelado automaticamente: cada obrigação é registrada explicitamente e continua independente do recebimento físico.
          </p>
        </div>
        <button type="button" disabled={loading} onClick={() => void load()} className="flex min-h-9 items-center gap-2 rounded-xl border border-slate-700 bg-slate-950 px-3 text-[8px] font-black uppercase text-slate-400 disabled:opacity-50">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Atualizar
        </button>
      </header>

      {error && <p className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-[9px] text-rose-200">{error}</p>}
      {feedback && <p className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-[9px] text-emerald-200">{feedback}</p>}

      <label className="block text-[8px] font-black uppercase text-slate-500">
        Compra realizada
        <select value={purchaseId} onChange={event => setPurchaseId(event.target.value)} className="mt-1 min-h-10 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-xs font-medium normal-case text-white">
          <option value="">Selecione uma compra</option>
          {committedPurchases.map(purchase => {
            const supplier = supplierById.get(purchase.supplierId);
            return <option key={purchase.id} value={purchase.id}>Compra {purchase.id.slice(-8)} · {supplier?.displayName ?? purchase.supplierId}</option>;
          })}
        </select>
      </label>

      {selectedPurchase && (
        <div className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <article className="rounded-2xl border border-slate-800 bg-slate-950/60 p-3">
              <span className="text-[8px] font-black uppercase text-slate-600">Total estimado da compra</span>
              <strong className="mt-1 block text-sm text-slate-200">
                {estimatedPurchaseTotalMinor === null ? 'Não informado' : money(estimatedPurchaseTotalMinor)}
              </strong>
            </article>
            <article className="rounded-2xl border border-slate-800 bg-slate-950/60 p-3">
              <span className="text-[8px] font-black uppercase text-slate-600">Obrigações ativas</span>
              <strong className="mt-1 block text-sm text-amber-100">{money(payableSummary.activeMinor)}</strong>
            </article>
            <article className="rounded-2xl border border-slate-800 bg-slate-950/60 p-3">
              <span className="text-[8px] font-black uppercase text-slate-600">Em aberto / pagas</span>
              <strong className="mt-1 block text-sm text-cyan-100">{money(payableSummary.openMinor)} / {money(payableSummary.paidMinor)}</strong>
            </article>
            <article className="rounded-2xl border border-slate-800 bg-slate-950/60 p-3">
              <span className="text-[8px] font-black uppercase text-slate-600">
                {payableSummary.differenceMinor !== null && payableSummary.differenceMinor < 0
                  ? 'Acima do estimado'
                  : 'Saldo não comprometido'}
              </span>
              <strong className={`mt-1 block text-sm ${payableSummary.differenceMinor !== null && payableSummary.differenceMinor < 0 ? 'text-rose-200' : 'text-emerald-200'}`}>
                {payableSummary.differenceMinor === null
                  ? '—'
                  : money(Math.abs(payableSummary.differenceMinor))}
              </strong>
            </article>
          </div>

          {linkedPayablesSorted.length > 0 && (
            <div className="space-y-2 rounded-2xl border border-cyan-500/15 bg-cyan-500/5 p-3">
              <div className="flex items-center justify-between gap-3">
                <strong className="text-[10px] text-cyan-100">Obrigações desta compra</strong>
                <span className="text-[8px] text-cyan-300/70">{linkedPayablesSorted.length} registrada(s)</span>
              </div>
              {linkedPayablesSorted.map(payable => (
                <div key={payable.id} className="flex flex-col gap-1 rounded-xl border border-slate-800 bg-slate-950/70 p-3 text-[9px] sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <strong className="text-slate-200">{storePurchasePayableKeyLabel(payable.purchasePayableKey ?? '')}</strong>
                    <span className="ml-2 text-slate-500">vence {payable.dueDate}</span>
                    <span className="ml-2 text-slate-500">· {payableStatusLabel(payable.status)}</span>
                  </div>
                  <strong className={payable.status === 'cancelled' ? 'text-slate-500 line-through' : 'text-amber-100'}>{money(payable.amountMinor)}</strong>
                </div>
              ))}
              {payableSummary.cancelledMinor > 0 && (
                <p className="text-[8px] text-slate-600">Obrigações canceladas não entram no total ativo: {money(payableSummary.cancelledMinor)}.</p>
              )}
            </div>
          )}

          <div className="rounded-2xl border border-amber-500/15 bg-amber-500/5 p-3">
            <strong className="text-[10px] text-amber-100">Registrar {nextPayableLabel}</strong>
            <p className="mt-1 text-[8px] leading-relaxed text-slate-500">
              O valor abaixo é apenas sugerido quando há total estimado e diferença positiva. Frete, desconto e outros ajustes podem fazer a soma financeira divergir do valor estimado da compra.
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-[8px] font-black uppercase text-slate-500">
              Valor da obrigação
              <input value={amount} onChange={event => setAmount(event.target.value)} inputMode="decimal" placeholder="0,00" className="mt-1 min-h-10 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-xs font-medium normal-case text-white" />
            </label>
            <label className="text-[8px] font-black uppercase text-slate-500">
              Vencimento
              <input type="date" value={dueDate} onChange={event => setDueDate(event.target.value)} className="mt-1 min-h-10 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-xs font-medium normal-case text-white" />
            </label>
            <label className="text-[8px] font-black uppercase text-slate-500">
              Natureza do custo
              <select value={costNature} onChange={event => setCostNature(event.target.value as CostNature)} className="mt-1 min-h-10 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-xs font-medium normal-case text-white">
                <option value="unspecified">Não classificado</option>
                <option value="fixed">Fixo</option>
                <option value="variable">Variável</option>
              </select>
            </label>
            <label className="text-[8px] font-black uppercase text-slate-500">
              Documento de cobrança
              <select
                value={billingDocumentType}
                onChange={event => {
                  const next = event.target.value as BillingDocumentType;
                  setBillingDocumentType(next);
                  if (next === 'none') setBillingDocumentReference('');
                  if (next !== 'boleto') {
                    setBillingDigitableLine('');
                    setBillingBarcode('');
                  }
                }}
                className="mt-1 min-h-10 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-xs font-medium normal-case text-white"
              >
                <option value="none">Sem documento informado</option>
                <option value="boleto">Boleto</option>
                <option value="invoice">Nota / fatura</option>
                <option value="other">Outro</option>
              </select>
            </label>
            {billingDocumentType !== 'none' && (
              <label className="text-[8px] font-black uppercase text-slate-500 md:col-span-2">
                Referência do documento / anexo
                <input value={billingDocumentReference} onChange={event => setBillingDocumentReference(event.target.value)} maxLength={500} placeholder="Número, URL ou referência do arquivo" className="mt-1 min-h-10 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-xs font-medium normal-case text-white" />
              </label>
            )}
            {billingDocumentType === 'boleto' && (
              <>
                <label className="text-[8px] font-black uppercase text-slate-500 md:col-span-2">
                  Linha digitável
                  <input value={billingDigitableLine} onChange={event => setBillingDigitableLine(event.target.value)} maxLength={220} className="mt-1 min-h-10 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-xs font-medium normal-case text-white" />
                </label>
                <label className="text-[8px] font-black uppercase text-slate-500 md:col-span-2">
                  Código de barras
                  <input value={billingBarcode} onChange={event => setBillingBarcode(event.target.value)} maxLength={220} className="mt-1 min-h-10 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-xs font-medium normal-case text-white" />
                </label>
              </>
            )}
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-3 text-[9px] leading-relaxed text-slate-500">
            <FileText className="mr-1 inline h-3.5 w-3.5" />
            Receber mercadoria não cria, quita ou altera parcelas. Cada obrigação registrada aqui continua sendo gerida no Financeiro → Contas a pagar.
          </div>

          <button type="button" disabled={saving} onClick={() => void createPayable()} className="min-h-10 rounded-xl bg-amber-400 px-4 text-[9px] font-black uppercase text-slate-950 disabled:opacity-50">
            {saving ? 'Registrando…' : `Registrar ${nextPayableLabel}`}
          </button>
        </div>
      )}

      {!loading && committedPurchases.length === 0 && (
        <p className="rounded-2xl border border-dashed border-slate-700 p-4 text-center text-[9px] text-slate-500">
          Nenhuma compra marcada como realizada está disponível para vínculo financeiro.
        </p>
      )}
    </section>
  );
}
