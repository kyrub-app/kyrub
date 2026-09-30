import { useState } from 'react';
import { Boxes, ClipboardList, History, PackageCheck, Truck, Users } from 'lucide-react';
import type { PurchaseListEntry } from '../../utils/productInventory';
import { StoreInventoryMovementTimeline } from './StoreInventoryMovementTimeline';
import { StoreProcurementWorkspace } from './StoreProcurementWorkspace';
import { StorePurchaseWorkspace } from './StorePurchaseWorkspace';

interface StockDirectRuntimeProps {
  storeId: string;
}

type StockSection = 'replenishment' | 'movements' | 'purchases' | 'receipts' | 'suppliers';

const tabs: Array<{ id: StockSection; label: string; icon: typeof Boxes }> = [
  { id: 'replenishment', label: 'Reposição', icon: ClipboardList },
  { id: 'movements', label: 'Movimentações', icon: History },
  { id: 'purchases', label: 'Compras', icon: Boxes },
  { id: 'receipts', label: 'Recebimentos', icon: PackageCheck },
  { id: 'suppliers', label: 'Fornecedores', icon: Users },
];

export function StockDirectRuntime({ storeId }: StockDirectRuntimeProps) {
  const [section, setSection] = useState<StockSection>('replenishment');
  const [replenishmentDraft, setReplenishmentDraft] = useState<PurchaseListEntry[]>([]);

  const preparePurchase = (entries: PurchaseListEntry[]): void => {
    setReplenishmentDraft(entries);
    setSection('purchases');
  };

  return (
    <div
      id="kyrub-stock-direct-runtime"
      data-kyrub-stock-native="true"
      className="space-y-4"
    >
      <nav className="flex gap-2 overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900 p-2" aria-label="Áreas do estoque">
        {tabs.map(tab => {
          const Icon = tab.icon;
          const active = tab.id === section;
          return (
            <button
              key={tab.id}
              type="button"
              data-kyrub-stock-section={tab.id}
              aria-pressed={active}
              onClick={() => setSection(tab.id)}
              className={`flex min-h-10 shrink-0 items-center gap-2 rounded-xl px-3 text-[9px] font-black uppercase transition ${active ? 'bg-orange-400 text-slate-950' : 'bg-slate-950 text-slate-400 hover:text-white'}`}
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
              {tab.id === 'purchases' && replenishmentDraft.length > 0 && (
                <span className="rounded-full bg-slate-950/20 px-1.5 py-0.5 text-[8px]">{replenishmentDraft.length}</span>
              )}
            </button>
          );
        })}
      </nav>

      {section === 'replenishment' ? (
        <StorePurchaseWorkspace
          storeId={storeId}
          onPreparePurchaseDraft={preparePurchase}
        />
      ) : section === 'movements' ? (
        <StoreInventoryMovementTimeline storeId={storeId} />
      ) : (
        <StoreProcurementWorkspace
          storeId={storeId}
          section={section}
          replenishmentDraft={replenishmentDraft}
          onReplenishmentDraftConsumed={() => setReplenishmentDraft([])}
        />
      )}

      <p className="flex items-center gap-2 rounded-2xl border border-slate-800 bg-slate-950/50 px-4 py-3 text-[9px] text-slate-500">
        <Truck className="h-3.5 w-3.5 text-slate-400" />
        Pedido ao fornecedor, recebimento físico e pagamento são eventos separados. Somente um recebimento confirmado altera o saldo do estoque.
      </p>
    </div>
  );
}
