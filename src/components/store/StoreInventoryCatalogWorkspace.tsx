import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  PackagePlus,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import { doc, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../../utils/firebase';
import {
  INVENTORY_UNITS,
  createInventoryCatalogItemId,
  getProductInventoryDocumentPath,
  readProductInventorySettings,
  type InventoryCatalogItem,
  type InventoryUnit,
} from '../../utils/productInventory';
import { persistStoreInventoryCatalog } from '../../utils/storeInventoryCatalog';

interface StoreInventoryCatalogWorkspaceProps {
  storeId: string;
}

type InventoryDraft = {
  name: string;
  unit: InventoryUnit;
  initialQuantity: string;
  minimumQuantity: string;
  purchaseCost: string;
  supplier: string;
};

const emptyDraft = (): InventoryDraft => ({
  name: '',
  unit: 'un',
  initialQuantity: '0',
  minimumQuantity: '0',
  purchaseCost: '0',
  supplier: '',
});

const parseNumber = (value: string): number =>
  Number.parseFloat(value.trim().replace(',', '.'));

const currency = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

export function StoreInventoryCatalogWorkspace({
  storeId,
}: StoreInventoryCatalogWorkspaceProps) {
  const [catalog, setCatalog] = useState<InventoryCatalogItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [editingId, setEditingId] = useState('');
  const [draft, setDraft] = useState<InventoryDraft>(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const user = auth.currentUser;
    if (!user || user.uid !== storeId) {
      setCatalog([]);
      setLoaded(true);
      setError('Faça login novamente para administrar o estoque da loja.');
      return;
    }

    return onSnapshot(
      doc(db, getProductInventoryDocumentPath(user.uid)),
      snapshot => {
        setCatalog(readProductInventorySettings(snapshot.data()).catalog);
        setLoaded(true);
        setError('');
      },
      snapshotError => {
        console.warn('Não foi possível carregar o cadastro global do estoque.', snapshotError);
        setLoaded(true);
        setError('O cadastro de estoque está indisponível neste momento.');
      }
    );
  }, [storeId]);

  const lowStockCount = useMemo(
    () => catalog.filter(item => item.currentQuantity <= item.minimumQuantity).length,
    [catalog]
  );

  const resetDraft = (): void => {
    setEditingId('');
    setDraft(emptyDraft());
    setError('');
  };

  const beginEdit = (item: InventoryCatalogItem): void => {
    setEditingId(item.id);
    setDraft({
      name: item.name,
      unit: item.unit,
      initialQuantity: String(item.currentQuantity),
      minimumQuantity: String(item.minimumQuantity),
      purchaseCost: String(item.purchaseCost),
      supplier: item.supplier,
    });
    setMessage('');
    setError('');
    document
      .getElementById('store-inventory-catalog-form')
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const saveDraft = async (): Promise<void> => {
    const user = auth.currentUser;
    if (!user || user.uid !== storeId) {
      setError('Faça login novamente para salvar o item de estoque.');
      return;
    }

    const name = draft.name.trim();
    const initialQuantity = parseNumber(draft.initialQuantity || '0');
    const minimumQuantity = parseNumber(draft.minimumQuantity || '0');
    const purchaseCost = parseNumber(draft.purchaseCost || '0');

    if (!name) {
      setError('Informe o nome do item de estoque.');
      return;
    }
    if (
      !Number.isFinite(initialQuantity) || initialQuantity < 0 ||
      !Number.isFinite(minimumQuantity) || minimumQuantity < 0 ||
      !Number.isFinite(purchaseCost) || purchaseCost < 0
    ) {
      setError('Quantidade, estoque mínimo e custo devem ser números iguais ou maiores que zero.');
      return;
    }

    const existing = editingId
      ? catalog.find(item => item.id === editingId) ?? null
      : null;
    const now = new Date().toISOString();
    const nextItem: InventoryCatalogItem = {
      id: existing?.id ?? createInventoryCatalogItemId(),
      name,
      unit: existing?.unit ?? draft.unit,
      currentQuantity: existing?.currentQuantity ?? initialQuantity,
      minimumQuantity,
      purchaseCost,
      supplier: draft.supplier.trim(),
      updatedAt: now,
    };
    const nextCatalog = existing
      ? catalog.map(item => item.id === existing.id ? nextItem : item)
      : [...catalog, nextItem];

    setSaving(true);
    setError('');
    setMessage('');
    try {
      await persistStoreInventoryCatalog(user, nextCatalog);
      setMessage(existing ? 'Item de estoque atualizado.' : 'Item de estoque criado.');
      resetDraft();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : 'Não foi possível salvar o item de estoque.'
      );
    } finally {
      setSaving(false);
    }
  };

  const removeItem = async (item: InventoryCatalogItem): Promise<void> => {
    const user = auth.currentUser;
    if (!user || user.uid !== storeId) {
      setError('Faça login novamente para remover o item de estoque.');
      return;
    }
    const confirmed = window.confirm(
      `Remover “${item.name}” do estoque? Ele também será desvinculado das fichas técnicas que o utilizam.`
    );
    if (!confirmed) return;

    setSaving(true);
    setError('');
    setMessage('');
    try {
      await persistStoreInventoryCatalog(
        user,
        catalog.filter(candidate => candidate.id !== item.id)
      );
      if (editingId === item.id) resetDraft();
      setMessage('Item removido do estoque.');
    } catch (removeError) {
      setError(
        removeError instanceof Error
          ? removeError.message
          : 'Não foi possível remover o item de estoque.'
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      id="store-inventory-catalog-workspace"
      className="space-y-4 rounded-3xl border border-slate-800 bg-slate-900 p-4 sm:p-5"
    >
      <header className="flex flex-col gap-3 border-b border-slate-800 pb-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <span className="text-[9px] font-black uppercase tracking-[0.18em] text-cyan-300">
            Cadastro global da loja
          </span>
          <h4 className="mt-1 text-sm font-black uppercase text-white">
            Itens de estoque
          </h4>
          <p className="mt-1 max-w-2xl text-[10px] leading-relaxed text-slate-500">
            Cadastre aqui insumos, embalagens, mercadorias e componentes. A ficha técnica dos produtos apenas referencia estes itens.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 text-center sm:min-w-[190px]">
          <div className="rounded-xl border border-slate-800 bg-slate-950 p-2">
            <span className="block text-[7px] font-black uppercase text-slate-500">Cadastrados</span>
            <strong className="text-sm text-white">{catalog.length}</strong>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-950 p-2">
            <span className="block text-[7px] font-black uppercase text-slate-500">No mínimo</span>
            <strong className={lowStockCount > 0 ? 'text-amber-300' : 'text-emerald-300'}>{lowStockCount}</strong>
          </div>
        </div>
      </header>

      <div
        id="store-inventory-catalog-form"
        className="space-y-3 rounded-2xl border border-cyan-500/20 bg-cyan-500/[0.04] p-4"
      >
        <div className="flex items-center gap-2">
          <PackagePlus className="h-4 w-4 text-cyan-300" />
          <strong className="text-[10px] font-black uppercase text-white">
            {editingId ? 'Editar item de estoque' : 'Novo item de estoque'}
          </strong>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-[9px] font-black uppercase text-slate-500 sm:col-span-2">
            Nome
            <input
              value={draft.name}
              onChange={event => setDraft(current => ({ ...current, name: event.target.value }))}
              disabled={saving}
              placeholder="Ex.: pão, farinha, embalagem, squeeze"
              className="mt-1.5 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-xs normal-case text-white"
            />
          </label>
          <label className="text-[9px] font-black uppercase text-slate-500">
            Unidade-base
            <select
              value={draft.unit}
              onChange={event => setDraft(current => ({ ...current, unit: event.target.value as InventoryUnit }))}
              disabled={saving || Boolean(editingId)}
              className="mt-1.5 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-xs text-white disabled:opacity-45"
            >
              {INVENTORY_UNITS.map(unit => (
                <option key={unit} value={unit}>{unit}</option>
              ))}
            </select>
            {editingId && (
              <span className="mt-1 block text-[8px] normal-case font-normal text-slate-600">
                A unidade-base é preservada para não reinterpretar movimentos existentes.
              </span>
            )}
          </label>
          <label className="text-[9px] font-black uppercase text-slate-500">
            {editingId ? 'Saldo atual' : 'Quantidade inicial'}
            <input
              type="number"
              min="0"
              step="any"
              value={draft.initialQuantity}
              onChange={event => setDraft(current => ({ ...current, initialQuantity: event.target.value }))}
              disabled={saving || Boolean(editingId)}
              className="mt-1.5 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-xs text-white disabled:opacity-45"
            />
            {editingId && (
              <span className="mt-1 block text-[8px] normal-case font-normal text-slate-600">
                Use “Dar entrada” ou “Corrigir contagem” no estoque físico para alterar o saldo.
              </span>
            )}
          </label>
          <label className="text-[9px] font-black uppercase text-slate-500">
            Estoque mínimo
            <input
              type="number"
              min="0"
              step="any"
              value={draft.minimumQuantity}
              onChange={event => setDraft(current => ({ ...current, minimumQuantity: event.target.value }))}
              disabled={saving}
              className="mt-1.5 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-xs text-white"
            />
          </label>
          <label className="text-[9px] font-black uppercase text-slate-500">
            Custo por unidade-base
            <input
              type="number"
              min="0"
              step="0.01"
              value={draft.purchaseCost}
              onChange={event => setDraft(current => ({ ...current, purchaseCost: event.target.value }))}
              disabled={saving}
              className="mt-1.5 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-xs text-white"
            />
          </label>
          <label className="text-[9px] font-black uppercase text-slate-500 sm:col-span-2">
            Fornecedor opcional
            <input
              value={draft.supplier}
              onChange={event => setDraft(current => ({ ...current, supplier: event.target.value }))}
              disabled={saving}
              className="mt-1.5 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-xs normal-case text-white"
            />
          </label>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void saveDraft()}
            disabled={saving}
            className="flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-cyan-400 px-3 text-[9px] font-black uppercase text-slate-950 disabled:opacity-40"
          >
            {editingId ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
            {editingId ? 'Salvar cadastro' : 'Criar item'}
          </button>
          {editingId && (
            <button
              type="button"
              onClick={resetDraft}
              disabled={saving}
              className="min-h-10 rounded-xl border border-slate-700 bg-slate-950 px-4 text-[9px] font-black uppercase text-slate-400"
            >
              Cancelar
            </button>
          )}
        </div>
      </div>

      {error && (
        <p className="flex items-start gap-2 rounded-2xl border border-red-500/20 bg-red-500/10 p-3 text-[10px] text-red-200" role="alert">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </p>
      )}
      {message && (
        <p className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-[10px] text-emerald-200">
          {message}
        </p>
      )}

      {!loaded ? (
        <p className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4 text-[10px] text-slate-500">
          Carregando cadastro de estoque…
        </p>
      ) : catalog.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-800 bg-slate-950/40 p-5 text-center text-[10px] text-slate-500">
          Nenhum item de estoque cadastrado ainda.
        </p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2" id="store-inventory-catalog-list">
          {catalog.map(item => (
            <article key={item.id} className="rounded-2xl border border-slate-800 bg-slate-950/60 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <strong className="block truncate text-xs text-white">{item.name}</strong>
                  <span className="mt-1 block text-[9px] text-slate-500">
                    {item.currentQuantity} {item.unit} · mínimo {item.minimumQuantity} {item.unit}
                  </span>
                  <span className="mt-1 block text-[8px] text-slate-600">
                    {currency.format(item.purchaseCost)} / {item.unit}{item.supplier ? ` · ${item.supplier}` : ''}
                  </span>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    onClick={() => beginEdit(item)}
                    disabled={saving}
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-700 bg-slate-900 text-slate-300"
                    aria-label={`Editar ${item.name}`}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void removeItem(item)}
                    disabled={saving}
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-red-500/20 bg-red-500/10 text-red-300"
                    aria-label={`Remover ${item.name}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
