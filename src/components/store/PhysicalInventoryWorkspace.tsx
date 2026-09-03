import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Boxes,
  ClipboardCheck,
  PackagePlus,
  RefreshCw,
  ShieldCheck,
  X,
} from 'lucide-react';
import type { KyrubErpInventorySummary } from '../../../shared/kyrubErpContext';
import { readKyrubErpContext } from '../../actions/erpReadActionService';
import { auth } from '../../utils/firebase';
import {
  requestManualPhysicalInventoryAdjustment,
  type ManualPhysicalInventoryAdjustmentMode,
} from '../../utils/manualPhysicalInventoryAdjustment';
import {
  KYRUB_PHYSICAL_INVENTORY_FOCUS_EVENT,
  physicalInventoryItemElementId,
  type PhysicalInventoryFocusDetail,
} from '../../utils/physicalInventoryRemediation';

interface PhysicalInventoryWorkspaceProps {
  storeId: string;
}

type AdjustmentDraft = {
  itemId: string;
  mode: ManualPhysicalInventoryAdjustmentMode;
  quantity: string;
};

const quantity = new Intl.NumberFormat('pt-BR', {
  maximumFractionDigits: 3,
});

const parseQuantityInput = (value: string): number | null => {
  const parsed = Number(value.trim().replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
};

export function PhysicalInventoryWorkspace({ storeId }: PhysicalInventoryWorkspaceProps) {
  const [items, setItems] = useState<KyrubErpInventorySummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [inventoryAvailable, setInventoryAvailable] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [focusedItemId, setFocusedItemId] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [adjustmentDraft, setAdjustmentDraft] = useState<AdjustmentDraft | null>(null);
  const [actionMessage, setActionMessage] = useState('');

  const lowStockCount = useMemo(
    () => items.filter(item => item.currentQuantity <= item.minimumQuantity).length,
    [items]
  );

  const load = useCallback(async (force = false): Promise<void> => {
    const user = auth.currentUser;
    if (!user || user.uid !== storeId) {
      setItems([]);
      setInventoryAvailable(false);
      setLoaded(true);
      setErrorMessage('Faça login novamente para consultar o estoque físico da loja.');
      return;
    }

    setLoading(true);
    setErrorMessage('');
    try {
      const context = await readKyrubErpContext(user, { force });
      setItems(context.inventory);
      setInventoryAvailable(context.availability.inventory);
      setTruncated(context.inventoryTruncated);
      if (!context.availability.inventory) {
        setErrorMessage('O estoque privado de insumos não pôde ser consultado agora.');
      }
    } catch (error) {
      setItems([]);
      setInventoryAvailable(false);
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Não foi possível consultar o estoque físico da loja.'
      );
    } finally {
      setLoaded(true);
      setLoading(false);
    }
  }, [storeId]);

  useEffect(() => {
    void load(false);
  }, [load]);

  useEffect(() => {
    const handleFocus = (event: Event): void => {
      const detail = (event as CustomEvent<PhysicalInventoryFocusDetail>).detail;
      const inventoryItemId = detail?.inventoryItemId?.trim() ?? '';
      if (inventoryItemId) setFocusedItemId(inventoryItemId);
    };
    window.addEventListener(KYRUB_PHYSICAL_INVENTORY_FOCUS_EVENT, handleFocus);
    return () => window.removeEventListener(KYRUB_PHYSICAL_INVENTORY_FOCUS_EVENT, handleFocus);
  }, []);

  useEffect(() => {
    if (!focusedItemId || !loaded) return;
    const frame = window.requestAnimationFrame(() => {
      document
        .getElementById(physicalInventoryItemElementId(focusedItemId))
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusedItemId, items, loaded]);

  const focusedItemExists = !focusedItemId || items.some(item => item.id === focusedItemId);

  const beginAdjustment = (
    item: KyrubErpInventorySummary,
    mode: ManualPhysicalInventoryAdjustmentMode
  ): void => {
    setFocusedItemId(item.id);
    setActionMessage('');
    setErrorMessage('');
    setAdjustmentDraft({ itemId: item.id, mode, quantity: '' });
  };

  const reviewAdjustment = (item: KyrubErpInventorySummary): void => {
    if (!adjustmentDraft || adjustmentDraft.itemId !== item.id) return;
    const requestedQuantity = parseQuantityInput(adjustmentDraft.quantity);
    if (
      requestedQuantity === null ||
      (adjustmentDraft.mode === 'increment' ? requestedQuantity <= 0 : requestedQuantity < 0)
    ) {
      setErrorMessage(
        adjustmentDraft.mode === 'increment'
          ? 'Informe uma quantidade maior que zero para dar entrada.'
          : 'Informe uma contagem física igual ou maior que zero.'
      );
      return;
    }

    try {
      requestManualPhysicalInventoryAdjustment({
        item,
        mode: adjustmentDraft.mode,
        quantity: requestedQuantity,
      });
      setAdjustmentDraft(null);
      setActionMessage(
        'A proposta foi enviada para revisão. O saldo só muda depois da confirmação explícita no modal de estoque.'
      );
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Não foi possível preparar o ajuste para revisão.'
      );
    }
  };

  return (
    <section
      id="kyrub-physical-inventory-workspace"
      className="mb-5 space-y-4 rounded-3xl border border-cyan-500/15 bg-slate-900 p-4 sm:p-5"
      aria-label="Estoque físico de insumos e componentes"
    >
      <header className="flex flex-col gap-3 border-b border-slate-800 pb-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <span className="text-[9px] font-black uppercase tracking-[0.18em] text-cyan-300">
            Autoridade física Kyrub · somente leitura direta · ajustes por confirmação
          </span>
          <h4 className="mt-1 flex items-center gap-2 text-xs font-black uppercase tracking-wide text-white">
            <Boxes className="h-4 w-4 text-cyan-300" /> Estoque físico
          </h4>
          <p className="mt-1 max-w-2xl text-[10px] leading-relaxed text-slate-500">
            Insumos e componentes do inventário privado usados pelo ATP e pelas fichas técnicas. Os botões abaixo apenas preparam uma proposta; nenhuma quantidade é alterada sem o modal de confirmação do Kyrub.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load(true)}
          disabled={loading}
          className="inline-flex min-h-9 shrink-0 items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-950 px-3 text-[9px] font-black uppercase text-slate-300 disabled:opacity-40"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Atualizar
        </button>
      </header>

      <div className="grid grid-cols-2 gap-2 sm:max-w-md">
        <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-3">
          <span className="block text-[8px] font-black uppercase text-slate-500">Itens físicos</span>
          <strong className="mt-1 block text-base text-white">{items.length}</strong>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-3">
          <span className="block text-[8px] font-black uppercase text-slate-500">No mínimo/abaixo</span>
          <strong className={`mt-1 block text-base ${lowStockCount > 0 ? 'text-amber-300' : 'text-emerald-300'}`}>{lowStockCount}</strong>
        </div>
      </div>

      {errorMessage && (
        <p className="flex items-start gap-2 rounded-2xl border border-amber-500/20 bg-amber-500/5 p-3 text-[10px] leading-relaxed text-amber-100" role="status">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {errorMessage}
        </p>
      )}

      {actionMessage && (
        <p className="rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-3 text-[10px] leading-relaxed text-cyan-100" role="status">
          {actionMessage}
        </p>
      )}

      {focusedItemId && loaded && !focusedItemExists && (
        <p className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-3 text-[10px] leading-relaxed text-amber-100">
          O bloqueio aponta para o item exato <strong className="break-all">{focusedItemId}</strong>, mas ele não está presente na leitura atual{truncated ? ' (a leitura foi truncada)' : ''}. Nenhum item semelhante será selecionado por aproximação.
        </p>
      )}

      {!loaded || (loading && items.length === 0) ? (
        <p className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4 text-[10px] text-slate-500">
          Consultando estoque físico canônico…
        </p>
      ) : inventoryAvailable && items.length === 0 ? (
        <div className="flex items-center gap-2 rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-emerald-300">
          <ShieldCheck className="h-4 w-4" />
          <strong className="text-xs">Nenhum insumo ou componente cadastrado.</strong>
        </div>
      ) : items.length > 0 ? (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" id="kyrub-physical-inventory-grid">
          {items.map(item => {
            const focused = focusedItemId === item.id;
            const atOrBelowMinimum = item.currentQuantity <= item.minimumQuantity;
            const draft = adjustmentDraft?.itemId === item.id ? adjustmentDraft : null;
            return (
              <article
                key={item.id}
                id={physicalInventoryItemElementId(item.id)}
                data-inventory-item-id={item.id}
                className={`rounded-2xl border p-3 transition-all ${focused ? 'border-cyan-300 bg-cyan-500/10 ring-2 ring-cyan-400/25' : atOrBelowMinimum ? 'border-amber-500/20 bg-amber-500/[0.035]' : 'border-slate-800 bg-slate-950/55'}`}
                aria-current={focused ? 'true' : undefined}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <strong className="block truncate text-xs text-white">{item.name}</strong>
                    <span className="mt-1 block break-all font-mono text-[8px] text-slate-600">{item.id}</span>
                  </div>
                  {focused && (
                    <span className="shrink-0 rounded-full border border-cyan-400/30 bg-cyan-400/10 px-2 py-1 text-[7px] font-black uppercase text-cyan-200">
                      Bloqueio ATP
                    </span>
                  )}
                </div>
                <div className="mt-3 flex items-end justify-between gap-3">
                  <div>
                    <span className="block text-[8px] font-black uppercase text-slate-500">Saldo físico</span>
                    <strong className={atOrBelowMinimum ? 'text-amber-300' : 'text-emerald-300'}>
                      {quantity.format(item.currentQuantity)} {item.unit}
                    </strong>
                  </div>
                  <span className="text-right text-[8px] leading-relaxed text-slate-500">
                    mínimo {quantity.format(item.minimumQuantity)} {item.unit}
                  </span>
                </div>
                {item.supplier && (
                  <p className="mt-2 truncate text-[8px] text-slate-600">Fornecedor: {item.supplier}</p>
                )}

                {!draft ? (
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => beginAdjustment(item, 'increment')}
                      className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-2 text-[8px] font-black uppercase text-emerald-200"
                    >
                      <PackagePlus className="h-3.5 w-3.5" /> Dar entrada
                    </button>
                    <button
                      type="button"
                      onClick={() => beginAdjustment(item, 'set')}
                      className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-xl border border-violet-500/25 bg-violet-500/10 px-2 text-[8px] font-black uppercase text-violet-200"
                    >
                      <ClipboardCheck className="h-3.5 w-3.5" /> Corrigir contagem
                    </button>
                  </div>
                ) : (
                  <div className="mt-3 space-y-2 rounded-xl border border-slate-700 bg-slate-950/75 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className="block text-[8px] font-black uppercase text-cyan-300">
                          {draft.mode === 'increment' ? 'Entrada manual' : 'Contagem física'}
                        </span>
                        <p className="mt-1 text-[8px] leading-relaxed text-slate-500">
                          {draft.mode === 'increment'
                            ? 'Informe somente a quantidade que chegou. O Kyrub somará ao saldo atual após confirmação.'
                            : 'Informe o saldo físico total contado. O Kyrub substituirá o saldo atual somente após confirmação.'}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setAdjustmentDraft(null)}
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-slate-800 text-slate-500"
                        aria-label="Cancelar ajuste"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <label className="block text-[8px] font-black uppercase text-slate-500">
                      {draft.mode === 'increment' ? 'Quantidade de entrada' : 'Saldo contado'} ({item.unit})
                      <input
                        value={draft.quantity}
                        onChange={event => setAdjustmentDraft(current => current && current.itemId === item.id
                          ? { ...current, quantity: event.target.value }
                          : current)}
                        inputMode="decimal"
                        autoFocus
                        placeholder={draft.mode === 'increment' ? 'Ex.: 2,5' : `Atual: ${quantity.format(item.currentQuantity)}`}
                        className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-[10px] text-white outline-none focus:border-cyan-500"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => reviewAdjustment(item)}
                      className="w-full rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-2.5 text-[8px] font-black uppercase text-cyan-200"
                    >
                      Revisar ajuste
                    </button>
                    <p className="text-[8px] leading-relaxed text-slate-600">
                      O clique acima não altera o estoque. Ele abre a confirmação autoritativa do Kyrub com este ID canônico exato.
                    </p>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      ) : null}

      {truncated && (
        <p className="text-[9px] leading-relaxed text-slate-600">
          A leitura do contexto ERP foi limitada ao recorte seguro atual. Nenhum item fora do recorte é inferido ou substituído por nome.
        </p>
      )}
    </section>
  );
}
