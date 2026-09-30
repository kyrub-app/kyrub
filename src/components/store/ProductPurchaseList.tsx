import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ShoppingCart } from 'lucide-react';
import {
  buildInventoryPurchaseList,
  type InventoryCatalogItem,
  type PurchaseListEntry,
} from '../../utils/productInventory';

interface ProductPurchaseListProps {
  catalog: InventoryCatalogItem[];
  onPreparePurchaseDraft?: (entries: PurchaseListEntry[]) => void;
}

const currency = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

export function ProductPurchaseList({
  catalog,
  onPreparePurchaseDraft,
}: ProductPurchaseListProps) {
  const entries = useMemo(() => buildInventoryPurchaseList(catalog), [catalog]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const estimatedTotal = entries.reduce(
    (sum, entry) => sum + entry.estimatedCost,
    0
  );

  useEffect(() => {
    const available = new Set(entries.map(entry => entry.inventoryItemId));
    setSelectedIds(current => current.filter(id => available.has(id)));
  }, [entries]);

  const selected = entries.filter(entry => selectedIds.includes(entry.inventoryItemId));
  const toggle = (inventoryItemId: string): void => {
    setSelectedIds(current => current.includes(inventoryItemId)
      ? current.filter(id => id !== inventoryItemId)
      : [...current, inventoryItemId]);
  };

  return (
    <section className="space-y-4" id="product-purchase-list">
      <div className="rounded-2xl border border-violet-500/20 bg-violet-500/5 p-4">
        <span className="font-mono text-[9px] font-black uppercase tracking-[0.16em] text-violet-300">
          Lista de compras
        </span>
        <h4 className="mt-1 flex items-center gap-2 text-sm font-black text-white">
          <ShoppingCart className="h-4 w-4 text-violet-300" />
          Reposição sugerida pelo estoque mínimo
        </h4>
        <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
          A lista é calculada automaticamente comparando a quantidade atual de
          cada componente com seu estoque mínimo.
        </p>
      </div>

      {entries.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-emerald-500/25 bg-emerald-500/5 px-5 py-12 text-center">
          <CheckCircle2 className="mx-auto h-9 w-9 text-emerald-400" />
          <p className="mt-3 text-xs font-black uppercase text-emerald-300">
            Nenhuma compra necessária
          </p>
          <p className="mt-1 text-[10px] text-slate-500">
            Todos os componentes estão no estoque mínimo ou acima dele.
          </p>
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            {entries.map(entry => {
              const checked = selectedIds.includes(entry.inventoryItemId);
              return (
                <article
                  key={entry.inventoryItemId}
                  className={`rounded-2xl border p-4 ${checked ? 'border-violet-400/50 bg-violet-500/10' : 'border-slate-800 bg-slate-950/65'}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h5 className="truncate text-xs font-black text-white">
                        {entry.name}
                      </h5>
                      <p className="mt-1 text-[9px] text-slate-500">
                        Atual: {entry.currentQuantity} {entry.unit} · mínimo:{' '}
                        {entry.minimumQuantity} {entry.unit}
                      </p>
                    </div>
                    {onPreparePurchaseDraft ? (
                      <label className="flex cursor-pointer items-center gap-2 rounded-full bg-violet-500/10 px-2 py-1 text-[8px] font-black uppercase text-violet-300">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggle(entry.inventoryItemId)}
                          className="h-3 w-3 accent-violet-400"
                        />
                        Selecionar
                      </label>
                    ) : (
                      <span className="rounded-full bg-violet-500/10 px-2 py-1 text-[8px] font-black uppercase text-violet-300">
                        Comprar
                      </span>
                    )}
                  </div>
                  <strong className="mt-4 block text-lg text-violet-200">
                    {entry.suggestedQuantity} {entry.unit}
                  </strong>
                  <div className="mt-3 border-t border-slate-800 pt-3 text-[9px] text-slate-500">
                    {entry.supplier && (
                      <p className="truncate">Fornecedor anterior: {entry.supplier}</p>
                    )}
                    <p>
                      Custo estimado:{' '}
                      <span className="font-bold text-slate-300">
                        {currency.format(entry.estimatedCost)}
                      </span>
                    </p>
                  </div>
                </article>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-violet-500/20 bg-violet-500/5 p-4">
            <div>
              <span className="text-[10px] font-black uppercase text-slate-400">
                Total estimado
              </span>
              <strong className="ml-3 text-lg text-violet-200">
                {currency.format(estimatedTotal)}
              </strong>
            </div>
            {onPreparePurchaseDraft && (
              <button
                type="button"
                disabled={selected.length === 0}
                onClick={() => onPreparePurchaseDraft(selected)}
                className="min-h-10 rounded-xl bg-violet-400 px-4 text-[9px] font-black uppercase text-slate-950 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Preparar compra ({selected.length})
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
