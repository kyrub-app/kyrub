import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  PackageCheck,
  Plus,
  RefreshCw,
  ShoppingCart,
  Truck,
  Users,
} from 'lucide-react';
import { auth } from '../../utils/firebase';
import type { PurchaseListEntry } from '../../utils/productInventory';
import {
  deriveStorePurchaseReceivingProgress,
  type StorePurchase,
  type StorePurchaseReceipt,
  type StoreSupplier,
} from '../../../shared/storePurchases';

type ProcurementSection = 'purchases' | 'receipts' | 'suppliers';

type PurchaseView = StorePurchase & {
  receivingState: 'not_started' | 'partially_received' | 'received';
  receivedReceiptCount: number;
};

type ProcurementOverview = {
  storeId: string;
  suppliers: StoreSupplier[];
  purchases: PurchaseView[];
  receipts: StorePurchaseReceipt[];
};

interface StoreProcurementWorkspaceProps {
  storeId: string;
  section: ProcurementSection;
  replenishmentDraft?: PurchaseListEntry[];
  onReplenishmentDraftConsumed?: () => void;
}

const statusLabel: Record<StorePurchase['status'], string> = {
  draft: 'Rascunho',
  ordered: 'Pedido realizado',
  partially_received: 'Recebido parcialmente',
  received: 'Recebido',
  cancelled: 'Cancelado',
};

const emptyOverview = (storeId: string): ProcurementOverview => ({
  storeId,
  suppliers: [],
  purchases: [],
  receipts: [],
});

const requestProcurement = async <T,>(
  storeId: string,
  init?: RequestInit
): Promise<T> => {
  const user = auth.currentUser;
  if (!user) throw new Error('Faça login novamente.');
  const token = await user.getIdToken();
  const response = await fetch(
    init?.method === 'POST'
      ? '/api/store-procurement'
      : `/api/store-procurement?storeId=${encodeURIComponent(storeId)}`,
    {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init?.headers ?? {}),
      },
    }
  );
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(typeof payload.error === 'string' ? payload.error : 'Operação indisponível.');
  }
  return payload as T;
};

const actionRequest = async <T,>(
  storeId: string,
  action: string,
  input: Record<string, unknown>
): Promise<T> => requestProcurement<T>(storeId, {
  method: 'POST',
  body: JSON.stringify({ action, storeId, ...input }),
});

const SupplierSection = ({
  overview,
  busy,
  onCreate,
}: {
  overview: ProcurementOverview;
  busy: boolean;
  onCreate: (input: Record<string, string>) => Promise<void>;
}) => {
  const [displayName, setDisplayName] = useState('');
  const [contactName, setContactName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');

  const submit = async (): Promise<void> => {
    await onCreate({ displayName, contactName, phone, email });
    setDisplayName('');
    setContactName('');
    setPhone('');
    setEmail('');
  };

  return <div className="space-y-4" id="store-procurement-suppliers">
    <section className="rounded-3xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
      <div className="flex items-center gap-2 text-white">
        <Users className="h-4 w-4 text-cyan-300" />
        <h3 className="text-sm font-black">Novo fornecedor</h3>
      </div>
      <p className="mt-1 text-[10px] text-slate-500">Cadastre a identidade operacional do fornecedor. Dados fiscais continuam opcionais e fora deste contrato.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <input value={displayName} onChange={event => setDisplayName(event.target.value)} placeholder="Nome do fornecedor" className="min-h-10 rounded-xl border border-slate-700 bg-slate-950 px-3 text-xs text-white" />
        <input value={contactName} onChange={event => setContactName(event.target.value)} placeholder="Contato (opcional)" className="min-h-10 rounded-xl border border-slate-700 bg-slate-950 px-3 text-xs text-white" />
        <input value={phone} onChange={event => setPhone(event.target.value)} placeholder="Telefone (opcional)" className="min-h-10 rounded-xl border border-slate-700 bg-slate-950 px-3 text-xs text-white" />
        <input value={email} onChange={event => setEmail(event.target.value)} placeholder="E-mail (opcional)" className="min-h-10 rounded-xl border border-slate-700 bg-slate-950 px-3 text-xs text-white" />
      </div>
      <button type="button" disabled={busy || !displayName.trim()} onClick={() => void submit()} className="mt-4 min-h-10 rounded-xl bg-cyan-400 px-4 text-[9px] font-black uppercase text-slate-950 disabled:opacity-40">
        <Plus className="mr-1 inline h-3.5 w-3.5" /> Cadastrar fornecedor
      </button>
    </section>

    <section className="grid gap-3 sm:grid-cols-2">
      {overview.suppliers.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-700 p-6 text-center text-[10px] text-slate-500 sm:col-span-2">Nenhum fornecedor cadastrado ainda.</p>
      ) : overview.suppliers.map(supplier => (
        <article key={supplier.id} className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
          <div className="flex items-start justify-between gap-2">
            <strong className="text-xs text-white">{supplier.displayName}</strong>
            <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-[8px] font-black uppercase text-emerald-300">{supplier.status === 'active' ? 'Ativo' : 'Inativo'}</span>
          </div>
          {supplier.contactName && <p className="mt-2 text-[9px] text-slate-400">Contato: {supplier.contactName}</p>}
          {supplier.phone && <p className="text-[9px] text-slate-500">{supplier.phone}</p>}
          {supplier.email && <p className="truncate text-[9px] text-slate-500">{supplier.email}</p>}
        </article>
      ))}
    </section>
  </div>;
};

const PurchaseSection = ({
  overview,
  replenishmentDraft,
  busy,
  onCreateDraft,
  onOrder,
}: {
  overview: ProcurementOverview;
  replenishmentDraft: PurchaseListEntry[];
  busy: boolean;
  onCreateDraft: (supplierId: string) => Promise<void>;
  onOrder: (purchaseId: string) => Promise<void>;
}) => {
  const [supplierId, setSupplierId] = useState('');
  const supplierName = useMemo(
    () => new Map(overview.suppliers.map(supplier => [supplier.id, supplier.displayName])),
    [overview.suppliers]
  );

  useEffect(() => {
    if (supplierId && !overview.suppliers.some(supplier => supplier.id === supplierId && supplier.status === 'active')) {
      setSupplierId('');
    }
  }, [overview.suppliers, supplierId]);

  return <div className="space-y-4" id="store-procurement-purchases">
    {replenishmentDraft.length > 0 && (
      <section className="rounded-3xl border border-violet-500/25 bg-violet-500/5 p-4 sm:p-5">
        <div className="flex items-center gap-2 text-white">
          <ShoppingCart className="h-4 w-4 text-violet-300" />
          <h3 className="text-sm font-black">Rascunho vindo da reposição</h3>
        </div>
        <p className="mt-1 text-[10px] text-slate-400">{replenishmentDraft.length} item(ns) selecionado(s). Escolha o fornecedor canônico antes de registrar a compra.</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {replenishmentDraft.map(entry => (
            <div key={entry.inventoryItemId} className="rounded-xl border border-violet-500/15 bg-slate-950/60 p-3 text-[9px] text-slate-400">
              <strong className="block text-[10px] text-white">{entry.name}</strong>
              {entry.suggestedQuantity} {entry.unit} sugeridos
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <select value={supplierId} onChange={event => setSupplierId(event.target.value)} className="min-h-10 min-w-48 flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3 text-xs text-white">
            <option value="">Selecione um fornecedor</option>
            {overview.suppliers.filter(supplier => supplier.status === 'active').map(supplier => (
              <option key={supplier.id} value={supplier.id}>{supplier.displayName}</option>
            ))}
          </select>
          <button type="button" disabled={busy || !supplierId} onClick={() => void onCreateDraft(supplierId)} className="min-h-10 rounded-xl bg-violet-400 px-4 text-[9px] font-black uppercase text-slate-950 disabled:opacity-40">Criar rascunho</button>
        </div>
        {overview.suppliers.length === 0 && <p className="mt-2 text-[9px] text-amber-300">Cadastre um fornecedor na aba Fornecedores antes de criar a compra.</p>}
      </section>
    )}

    <section className="space-y-3">
      {overview.purchases.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-700 p-8 text-center text-[10px] text-slate-500">Nenhuma compra registrada.</p>
      ) : overview.purchases.map(purchase => (
        <article key={purchase.id} className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <strong className="text-xs text-white">Compra {purchase.id.slice(-8)}</strong>
              <p className="mt-1 text-[9px] text-slate-500">{supplierName.get(purchase.supplierId) ?? purchase.supplierId} · {purchase.lines.length} item(ns)</p>
            </div>
            <span className="rounded-full bg-slate-800 px-2 py-1 text-[8px] font-black uppercase text-slate-300">{statusLabel[purchase.status]}</span>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {purchase.lines.map(line => (
              <p key={line.id} className="rounded-xl bg-slate-950/60 p-2 text-[9px] text-slate-400">{line.name}: <b className="text-slate-200">{line.orderedQuantity} {line.unit}</b></p>
            ))}
          </div>
          {purchase.status === 'draft' && (
            <button type="button" disabled={busy} onClick={() => void onOrder(purchase.id)} className="mt-3 min-h-9 rounded-xl bg-orange-400 px-3 text-[8px] font-black uppercase text-slate-950 disabled:opacity-40">Marcar como pedido realizado</button>
          )}
        </article>
      ))}
    </section>
  </div>;
};

const ReceiptSection = ({
  overview,
  busy,
  onCreateDraft,
  onConfirm,
}: {
  overview: ProcurementOverview;
  busy: boolean;
  onCreateDraft: (purchaseId: string, lines: Array<{ purchaseLineId: string; receivedQuantity: number }>, sourceReference: string) => Promise<void>;
  onConfirm: (receiptId: string) => Promise<void>;
}) => {
  const [purchaseId, setPurchaseId] = useState('');
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [sourceReference, setSourceReference] = useState('');
  const receiptsByPurchase = useMemo(() => {
    const map = new Map<string, StorePurchaseReceipt[]>();
    for (const receipt of overview.receipts) {
      const current = map.get(receipt.purchaseId) ?? [];
      current.push(receipt);
      map.set(receipt.purchaseId, current);
    }
    return map;
  }, [overview.receipts]);
  const receivable = overview.purchases.filter(purchase => purchase.status === 'ordered' || purchase.status === 'partially_received');
  const selectedPurchase = receivable.find(purchase => purchase.id === purchaseId) ?? null;
  const progress = selectedPurchase ? deriveStorePurchaseReceivingProgress({
    purchase: selectedPurchase,
    receipts: receiptsByPurchase.get(selectedPurchase.id) ?? [],
  }) : null;
  const lineById = new Map(selectedPurchase?.lines.map(line => [line.id, line]) ?? []);

  useEffect(() => {
    if (!selectedPurchase || !progress) {
      setQuantities({});
      return;
    }
    setQuantities(Object.fromEntries(
      progress.lines.filter(line => line.remainingQuantity > 0).map(line => [line.purchaseLineId, String(line.remainingQuantity)])
    ));
  }, [purchaseId]);

  const create = async (): Promise<void> => {
    if (!selectedPurchase || !progress) return;
    const lines = progress.lines.flatMap(line => {
      const quantity = Number(quantities[line.purchaseLineId]);
      return Number.isFinite(quantity) && quantity > 0
        ? [{ purchaseLineId: line.purchaseLineId, receivedQuantity: quantity }]
        : [];
    });
    await onCreateDraft(selectedPurchase.id, lines, sourceReference);
    setPurchaseId('');
    setSourceReference('');
  };

  return <div className="space-y-4" id="store-procurement-receipts">
    <section className="rounded-3xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
      <div className="flex items-center gap-2 text-white"><Truck className="h-4 w-4 text-emerald-300" /><h3 className="text-sm font-black">Preparar recebimento</h3></div>
      <p className="mt-1 text-[10px] text-slate-500">Criar este rascunho não altera estoque. A entrada física acontece somente na confirmação posterior.</p>
      <select value={purchaseId} onChange={event => setPurchaseId(event.target.value)} className="mt-4 min-h-10 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-xs text-white">
        <option value="">Selecione uma compra em aberto</option>
        {receivable.map(purchase => <option key={purchase.id} value={purchase.id}>Compra {purchase.id.slice(-8)} · {statusLabel[purchase.status]}</option>)}
      </select>
      {selectedPurchase && progress && (
        <div className="mt-4 space-y-3">
          {progress.lines.filter(line => line.remainingQuantity > 0).map(progressLine => {
            const purchaseLine = lineById.get(progressLine.purchaseLineId);
            return <label key={progressLine.purchaseLineId} className="block rounded-xl border border-slate-800 bg-slate-950/60 p-3">
              <span className="text-[10px] font-bold text-white">{purchaseLine?.name ?? progressLine.inventoryItemId}</span>
              <span className="ml-2 text-[9px] text-slate-500">Pendente: {progressLine.remainingQuantity} {progressLine.unit}</span>
              <input type="number" min="0" max={progressLine.remainingQuantity} step="any" value={quantities[progressLine.purchaseLineId] ?? ''} onChange={event => setQuantities(current => ({ ...current, [progressLine.purchaseLineId]: event.target.value }))} className="mt-2 min-h-9 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 text-xs text-white" />
            </label>;
          })}
          <input value={sourceReference} onChange={event => setSourceReference(event.target.value)} placeholder="Referência do documento/nota (opcional)" className="min-h-10 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-xs text-white" />
          <button type="button" disabled={busy} onClick={() => void create()} className="min-h-10 rounded-xl bg-emerald-400 px-4 text-[9px] font-black uppercase text-slate-950 disabled:opacity-40">Criar rascunho de recebimento</button>
        </div>
      )}
    </section>

    <section className="space-y-3">
      {overview.receipts.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-700 p-8 text-center text-[10px] text-slate-500">Nenhum recebimento registrado.</p>
      ) : overview.receipts.map(receipt => (
        <article key={receipt.id} className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <strong className="text-xs text-white">Recebimento {receipt.id.slice(-8)}</strong>
              <p className="mt-1 text-[9px] text-slate-500">Compra {receipt.purchaseId.slice(-8)} · {receipt.lines.length} item(ns)</p>
            </div>
            <span className={`rounded-full px-2 py-1 text-[8px] font-black uppercase ${receipt.status === 'confirmed' ? 'bg-emerald-500/10 text-emerald-300' : 'bg-amber-500/10 text-amber-300'}`}>{receipt.status === 'confirmed' ? 'Confirmado' : receipt.status === 'draft' ? 'Aguardando confirmação' : 'Cancelado'}</span>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {receipt.lines.map(line => (
              <p key={line.purchaseLineId} className="rounded-xl bg-slate-950/60 p-2 text-[9px] text-slate-400">{line.inventoryItemId}: <b className="text-slate-200">{line.receivedQuantity} {line.unit}</b></p>
            ))}
          </div>
          {receipt.status === 'draft' && (
            <button type="button" disabled={busy} onClick={() => void onConfirm(receipt.id)} className="mt-3 min-h-10 rounded-xl bg-emerald-400 px-4 text-[8px] font-black uppercase text-slate-950 disabled:opacity-40">
              <PackageCheck className="mr-1 inline h-3.5 w-3.5" /> Confirmar entrada no estoque
            </button>
          )}
          {receipt.status === 'confirmed' && <p className="mt-3 flex items-center gap-1 text-[9px] text-emerald-300"><CheckCircle2 className="h-3.5 w-3.5" /> Entrada física confirmada</p>}
        </article>
      ))}
    </section>
  </div>;
};

export function StoreProcurementWorkspace({
  storeId,
  section,
  replenishmentDraft = [],
  onReplenishmentDraftConsumed,
}: StoreProcurementWorkspaceProps) {
  const [overview, setOverview] = useState<ProcurementOverview>(() => emptyOverview(storeId));
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      setOverview(await requestProcurement<ProcurementOverview>(storeId));
      setError('');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar compras.');
    } finally {
      setLoading(false);
    }
  }, [storeId]);

  useEffect(() => { void load(); }, [load]);

  const execute = async (work: () => Promise<unknown>, successMessage: string): Promise<void> => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
      setNotice(successMessage);
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Não foi possível concluir a operação.');
    } finally {
      setBusy(false);
    }
  };

  return <section className="space-y-4" data-kyrub-procurement-section={section}>
    <header className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-slate-800 bg-slate-900 p-4">
      <div>
        <span className="font-mono text-[9px] font-black uppercase tracking-[0.16em] text-cyan-300">Compras e recebimentos</span>
        <h3 className="mt-1 text-sm font-black text-white">{section === 'suppliers' ? 'Fornecedores' : section === 'receipts' ? 'Recebimentos' : 'Compras'}</h3>
      </div>
      <button type="button" disabled={loading || busy} onClick={() => void load()} className="min-h-9 rounded-xl border border-slate-700 px-3 text-[8px] font-black uppercase text-slate-300 disabled:opacity-40"><RefreshCw className="mr-1 inline h-3.5 w-3.5" /> Atualizar</button>
    </header>

    {error && <p role="alert" className="flex items-start gap-2 rounded-2xl border border-red-500/20 bg-red-500/5 p-3 text-[10px] text-red-200"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}</p>}
    {notice && <p role="status" className="flex items-start gap-2 rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-[10px] text-emerald-200"><ClipboardCheck className="mt-0.5 h-4 w-4 shrink-0" />{notice}</p>}
    {loading ? <p className="rounded-2xl border border-slate-800 bg-slate-900 p-5 text-[10px] text-slate-500">Carregando operação de compras…</p> : section === 'suppliers' ? (
      <SupplierSection
        overview={overview}
        busy={busy}
        onCreate={input => execute(
          () => actionRequest(storeId, 'create_supplier', input),
          'Fornecedor cadastrado.'
        )}
      />
    ) : section === 'purchases' ? (
      <PurchaseSection
        overview={overview}
        replenishmentDraft={replenishmentDraft}
        busy={busy}
        onCreateDraft={supplierId => execute(async () => {
          await actionRequest(storeId, 'create_purchase_draft', {
            supplierId,
            lines: replenishmentDraft.map(entry => ({
              inventoryItemId: entry.inventoryItemId,
              unit: entry.unit,
              orderedQuantity: entry.suggestedQuantity,
              quotedUnitCostMinor: null,
            })),
          });
          onReplenishmentDraftConsumed?.();
        }, 'Rascunho de compra criado sem alterar o estoque.')}
        onOrder={purchaseId => execute(
          () => actionRequest(storeId, 'order_purchase', { purchaseId }),
          'Compra marcada como pedido realizado. O estoque ainda não foi alterado.'
        )}
      />
    ) : (
      <ReceiptSection
        overview={overview}
        busy={busy}
        onCreateDraft={(purchaseId, lines, sourceReference) => execute(
          () => actionRequest(storeId, 'create_receipt_draft', { purchaseId, lines, sourceReference }),
          'Rascunho de recebimento criado. Nenhuma entrada física foi realizada ainda.'
        )}
        onConfirm={receiptId => execute(
          () => actionRequest(storeId, 'confirm_receipt', { receiptId }),
          'Recebimento confirmado e entrada física registrada no estoque.'
        )}
      />
    )}
  </section>;
}
