import { CheckCircle2, ShoppingCart } from 'lucide-react';
import {
  buildInventoryPurchaseList,
  type InventoryCatalogItem,
} from '../../utils/productInventory';

interface ProductPurchaseListProps {
  catalog: InventoryCatalogItem[];
}

const currency = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

export function ProductPurchaseList({ catalog }: ProductPurchaseListProps) {
  const entries = buildInventoryPurchaseList(catalog);
  const estimatedTotal = entries.reduce(
    (sum, entry) => sum + entry.estimatedCost,
    0
  );

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
            {entries.map(entry => (
              <article
                key={entry.inventoryItemId}
                className="rounded-2xl border border-slate-800 bg-slate-950/65 p-4"
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
                  <span className="rounded-full bg-violet-500/10 px-2 py-1 text-[8px] font-black uppercase text-violet-300">
                    Comprar
                  </span>
                </div>
                <strong className="mt-4 block text-lg text-violet-200">
                  {entry.suggestedQuantity} {entry.unit}
                </strong>
                <div className="mt-3 border-t border-slate-800 pt-3 text-[9px] text-slate-500">
                  {entry.supplier && (
                    <p className="truncate">Fornecedor: {entry.supplier}</p>
                  )}
                  <p>
                    Custo estimado:{' '}
                    <span className="font-bold text-slate-300">
                      {currency.format(entry.estimatedCost)}
                    </span>
                  </p>
                </div>
              </article>
            ))}
          </div>

          <div className="flex items-center justify-between rounded-2xl border border-violet-500/20 bg-violet-500/5 p-4">
            <span className="text-[10px] font-black uppercase text-slate-400">
              Total estimado
            </span>
            <strong className="text-lg text-violet-200">
              {currency.format(estimatedTotal)}
            </strong>
          </div>
        </>
      )}
    </section>
  );
}
