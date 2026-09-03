import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Boxes, RefreshCw, ShieldCheck } from 'lucide-react';
import type { KyrubErpInventorySummary } from '../../../shared/kyrubErpContext';
import { readKyrubErpContext } from '../../actions/erpReadActionService';
import { auth } from '../../utils/firebase';
import {
  KYRUB_PHYSICAL_INVENTORY_FOCUS_EVENT,
  physicalInventoryItemElementId,
  type PhysicalInventoryFocusDetail,
} from '../../utils/physicalInventoryRemediation';

interface PhysicalInventoryWorkspaceProps {
  storeId: string;
}

const quantity = new Intl.NumberFormat('pt-BR', {
  maximumFractionDigits: 3,
});

export function PhysicalInventoryWorkspace({ storeId }: PhysicalInventoryWorkspaceProps) {
  const [items, setItems] = useState<KyrubErpInventorySummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [inventoryAvailable, setInventoryAvailable] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [focusedItemId, setFocusedItemId] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

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

  return (
    <section
      id="kyrub-physical-inventory-workspace"
      className="mb-5 space-y-4 rounded-3xl border border-cyan-500/15 bg-slate-900 p-4 sm:p-5"
      aria-label="Estoque físico de insumos e componentes"
    >
      <header className="flex flex-col gap-3 border-b border-slate-800 pb-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <span className="text-[9px] font-black uppercase tracking-[0.18em] text-cyan-300">
            Autoridade física Kyrub · somente leitura
          </span>
          <h4 className="mt-1 flex items-center gap-2 text-xs font-black uppercase tracking-wide text-white">
            <Boxes className="h-4 w-4 text-cyan-300" /> Estoque físico
          </h4>
          <p className="mt-1 max-w-2xl text-[10px] leading-relaxed text-slate-500">
            Insumos e componentes do inventário privado usados pelo ATP e pelas fichas técnicas. Esta visão não altera saldo.
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
