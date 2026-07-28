import { useMemo, useState } from 'react';
import {
  Boxes,
  Check,
  PackagePlus,
  Pencil,
  Plus,
  Trash2,
  UtensilsCrossed,
} from 'lucide-react';
import {
  EMPTY_PRODUCT_COMPOSITION,
  INVENTORY_UNITS,
  calculateProductAvailableStock,
  createInventoryCatalogItemId,
  type InventoryCatalogItem,
  type InventoryUnit,
  type ProductComposition,
} from '../../utils/productInventory';

interface ProductInventoryCompositionEditorProps {
  catalog: InventoryCatalogItem[];
  composition: ProductComposition;
  onCatalogChange: (catalog: InventoryCatalogItem[]) => void;
  onCompositionChange: (composition: ProductComposition) => void;
  disabled?: boolean;
}

interface CatalogDraft {
  name: string;
  unit: InventoryUnit;
  currentQuantity: string;
  minimumQuantity: string;
  purchaseCost: string;
  supplier: string;
}

const emptyDraft = (): CatalogDraft => ({
  name: '',
  unit: 'un',
  currentQuantity: '0',
  minimumQuantity: '0',
  purchaseCost: '0',
  supplier: '',
});

const numberFromInput = (value: string): number =>
  Number.parseFloat(value.replace(',', '.'));

export function ProductInventoryCompositionEditor({
  catalog,
  composition,
  onCatalogChange,
  onCompositionChange,
  disabled = false,
}: ProductInventoryCompositionEditorProps) {
  const [managerOpen, setManagerOpen] = useState(catalog.length === 0);
  const [editingId, setEditingId] = useState('');
  const [draft, setDraft] = useState<CatalogDraft>(emptyDraft);
  const [error, setError] = useState('');

  const selectedIds = useMemo(
    () => new Set(composition.lines.map(line => line.inventoryItemId)),
    [composition.lines]
  );
  const catalogById = useMemo(
    () => new Map(catalog.map(item => [item.id, item])),
    [catalog]
  );
  const availableStock = calculateProductAvailableStock(catalog, composition);

  const resetDraft = (): void => {
    setEditingId('');
    setDraft(emptyDraft());
    setError('');
  };

  const toggleComponent = (itemId: string): void => {
    const exists = selectedIds.has(itemId);
    onCompositionChange({
      ...composition,
      lines: exists
        ? composition.lines.filter(line => line.inventoryItemId !== itemId)
        : [...composition.lines, { inventoryItemId: itemId, quantity: 1 }],
    });
  };

  const updateLineQuantity = (itemId: string, value: string): void => {
    const quantity = numberFromInput(value);
    onCompositionChange({
      ...composition,
      lines: composition.lines.map(line =>
        line.inventoryItemId === itemId
          ? { ...line, quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 0 }
          : line
      ),
    });
  };

  const editCatalogItem = (item: InventoryCatalogItem): void => {
    setManagerOpen(true);
    setEditingId(item.id);
    setDraft({
      name: item.name,
      unit: item.unit,
      currentQuantity: String(item.currentQuantity),
      minimumQuantity: String(item.minimumQuantity),
      purchaseCost: String(item.purchaseCost),
      supplier: item.supplier,
    });
    setError('');
  };

  const saveCatalogItem = (): void => {
    setError('');
    const name = draft.name.trim();
    const currentQuantity = numberFromInput(draft.currentQuantity);
    const minimumQuantity = numberFromInput(draft.minimumQuantity);
    const purchaseCost = numberFromInput(draft.purchaseCost || '0');

    if (!name) {
      setError('Informe o nome do insumo ou componente.');
      return;
    }
    if (
      !Number.isFinite(currentQuantity) ||
      currentQuantity < 0 ||
      !Number.isFinite(minimumQuantity) ||
      minimumQuantity < 0 ||
      !Number.isFinite(purchaseCost) ||
      purchaseCost < 0
    ) {
      setError('Quantidades e custo precisam ser números iguais ou maiores que zero.');
      return;
    }

    const now = new Date().toISOString();
    const nextItem: InventoryCatalogItem = {
      id: editingId || createInventoryCatalogItemId(),
      name,
      unit: draft.unit,
      currentQuantity,
      minimumQuantity,
      purchaseCost,
      supplier: draft.supplier.trim(),
      updatedAt: now,
    };

    onCatalogChange(
      editingId
        ? catalog.map(item => item.id === editingId ? nextItem : item)
        : [...catalog, nextItem]
    );
    resetDraft();
  };

  const removeCatalogItem = (item: InventoryCatalogItem): void => {
    const confirmed = window.confirm(
      `Remover “${item.name}” do estoque e de todas as composições?`
    );
    if (!confirmed) return;
    onCatalogChange(catalog.filter(candidate => candidate.id !== item.id));
    onCompositionChange({
      ...composition,
      lines: composition.lines.filter(
        line => line.inventoryItemId !== item.id
      ),
    });
    if (editingId === item.id) resetDraft();
  };

  return (
    <div className="space-y-4" id="product-inventory-composition-editor">
      <section className="rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <span className="font-mono text-[9px] font-black uppercase tracking-[0.16em] text-cyan-300">
              Composição do item
            </span>
            <h4 className="mt-1 flex items-center gap-2 text-sm font-black text-white">
              {composition.kind === 'recipe' ? (
                <UtensilsCrossed className="h-4 w-4 text-cyan-300" />
              ) : (
                <Boxes className="h-4 w-4 text-cyan-300" />
              )}
              {composition.kind === 'recipe'
                ? 'Ficha técnica de produção'
                : 'Kit ou combinação de varejo'}
            </h4>
            <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
              Selecione os componentes consumidos para produzir ou montar este item.
              Cada componente usa sua própria unidade-base, sem conversão automática.
            </p>
          </div>
          <div className="rounded-xl border border-cyan-500/20 bg-slate-950 px-3 py-2 text-right">
            <span className="block text-[8px] font-black uppercase text-slate-500">
              Estoque vendável calculado
            </span>
            <strong className="text-lg text-cyan-300">
              {availableStock === null ? 'Sem composição' : `${availableStock} un.`}
            </strong>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_160px]">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={disabled}
              onClick={() => onCompositionChange({ ...composition, kind: 'recipe' })}
              className={`min-h-10 rounded-xl border px-3 text-[9px] font-black uppercase ${
                composition.kind === 'recipe'
                  ? 'border-cyan-500/50 bg-cyan-500/15 text-cyan-200'
                  : 'border-slate-800 bg-slate-950 text-slate-500'
              }`}
            >
              Ficha técnica
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onCompositionChange({ ...composition, kind: 'bundle' })}
              className={`min-h-10 rounded-xl border px-3 text-[9px] font-black uppercase ${
                composition.kind === 'bundle'
                  ? 'border-cyan-500/50 bg-cyan-500/15 text-cyan-200'
                  : 'border-slate-800 bg-slate-950 text-slate-500'
              }`}
            >
              Kit / combinação
            </button>
          </div>
          <label className="text-[9px] font-black uppercase text-slate-500">
            Rendimento
            <input
              type="number"
              min="1"
              step="1"
              value={composition.yieldQuantity}
              onChange={event => onCompositionChange({
                ...composition,
                yieldQuantity: Math.max(1, Number.parseInt(event.target.value || '1', 10)),
              })}
              disabled={disabled}
              className="mt-1.5 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-xs text-white"
            />
          </label>
        </div>
      </section>

      <section className="space-y-3 rounded-2xl border border-slate-800 bg-slate-950/55 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h4 className="text-xs font-black uppercase text-white">
              Caixa de seleção
            </h4>
            <p className="mt-1 text-[9px] text-slate-500">
              Marque os componentes que fazem parte deste item.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setManagerOpen(current => !current)}
            disabled={disabled}
            className="flex min-h-9 items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900 px-3 text-[9px] font-black uppercase text-slate-300"
          >
            <PackagePlus className="h-3.5 w-3.5" />
            Gerenciar opções
          </button>
        </div>

        {catalog.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-800 px-4 py-8 text-center text-[10px] text-slate-500">
            Crie o primeiro insumo ou componente em “Gerenciar opções”.
          </div>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {catalog.map(item => {
              const selected = selectedIds.has(item.id);
              return (
                <label
                  key={item.id}
                  className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${
                    selected
                      ? 'border-cyan-500/35 bg-cyan-500/10'
                      : 'border-slate-800 bg-slate-900/60'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => toggleComponent(item.id)}
                    disabled={disabled}
                    className="mt-0.5 accent-cyan-500"
                  />
                  <span className="min-w-0">
                    <strong className="block truncate text-[11px] text-white">
                      {item.name}
                    </strong>
                    <span className="text-[9px] text-slate-500">
                      {item.currentQuantity} {item.unit} disponíveis
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        )}
      </section>

      {composition.lines.length > 0 && (
        <section className="space-y-2 rounded-2xl border border-slate-800 bg-slate-950/55 p-4">
          <h4 className="text-xs font-black uppercase text-white">
            Quantidade consumida
          </h4>
          {composition.lines.map(line => {
            const item = catalogById.get(line.inventoryItemId);
            if (!item) return null;
            return (
              <div
                key={line.inventoryItemId}
                className="grid grid-cols-[1fr_120px_auto] items-end gap-2 rounded-xl border border-slate-800 bg-slate-900/60 p-3"
              >
                <div className="min-w-0">
                  <strong className="block truncate text-[11px] text-white">
                    {item.name}
                  </strong>
                  <span className="text-[9px] text-slate-500">
                    Unidade-base: {item.unit}
                  </span>
                </div>
                <label className="text-[8px] font-black uppercase text-slate-500">
                  Por rendimento
                  <div className="mt-1 flex items-center overflow-hidden rounded-lg border border-slate-700 bg-slate-950">
                    <input
                      type="number"
                      min="0.0001"
                      step="any"
                      value={line.quantity || ''}
                      onChange={event => updateLineQuantity(item.id, event.target.value)}
                      disabled={disabled}
                      className="min-w-0 flex-1 bg-transparent px-2 py-2 text-xs text-white outline-none"
                    />
                    <span className="border-l border-slate-700 px-2 text-[9px] text-slate-500">
                      {item.unit}
                    </span>
                  </div>
                </label>
                <button
                  type="button"
                  onClick={() => toggleComponent(item.id)}
                  disabled={disabled}
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-red-500/20 bg-red-500/10 text-red-300"
                  aria-label={`Remover ${item.name} da composição`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </section>
      )}

      {managerOpen && (
        <section className="space-y-4 rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4" id="inventory-catalog-manager">
          <div>
            <span className="font-mono text-[9px] font-black uppercase text-amber-300">
              Opções da caixa de seleção
            </span>
            <h4 className="mt-1 text-sm font-black text-white">
              Criar, editar ou remover componentes
            </h4>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-[9px] font-black uppercase text-slate-500 sm:col-span-2">
              Nome
              <input
                value={draft.name}
                onChange={event => setDraft(current => ({ ...current, name: event.target.value }))}
                disabled={disabled}
                placeholder="Ex.: farinha, embalagem, camiseta azul"
                className="mt-1.5 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-xs normal-case text-white"
              />
            </label>
            <label className="text-[9px] font-black uppercase text-slate-500">
              Unidade-base
              <select
                value={draft.unit}
                onChange={event => setDraft(current => ({
                  ...current,
                  unit: event.target.value as InventoryUnit,
                }))}
                disabled={disabled}
                className="mt-1.5 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-xs text-white"
              >
                {INVENTORY_UNITS.map(unit => (
                  <option key={unit} value={unit}>{unit}</option>
                ))}
              </select>
            </label>
            <label className="text-[9px] font-black uppercase text-slate-500">
              Quantidade atual
              <input
                type="number"
                min="0"
                step="any"
                value={draft.currentQuantity}
                onChange={event => setDraft(current => ({ ...current, currentQuantity: event.target.value }))}
                disabled={disabled}
                className="mt-1.5 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-xs text-white"
              />
            </label>
            <label className="text-[9px] font-black uppercase text-slate-500">
              Estoque mínimo
              <input
                type="number"
                min="0"
                step="any"
                value={draft.minimumQuantity}
                onChange={event => setDraft(current => ({ ...current, minimumQuantity: event.target.value }))}
                disabled={disabled}
                className="mt-1.5 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-xs text-white"
              />
            </label>
            <label className="text-[9px] font-black uppercase text-slate-500">
              Custo por unidade
              <input
                type="number"
                min="0"
                step="0.01"
                value={draft.purchaseCost}
                onChange={event => setDraft(current => ({ ...current, purchaseCost: event.target.value }))}
                disabled={disabled}
                className="mt-1.5 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-xs text-white"
              />
            </label>
            <label className="text-[9px] font-black uppercase text-slate-500 sm:col-span-2">
              Fornecedor opcional
              <input
                value={draft.supplier}
                onChange={event => setDraft(current => ({ ...current, supplier: event.target.value }))}
                disabled={disabled}
                className="mt-1.5 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-xs normal-case text-white"
              />
            </label>
          </div>

          {error && (
            <p className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-[10px] text-red-300">
              {error}
            </p>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={saveCatalogItem}
              disabled={disabled}
              className="flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-amber-400 px-3 text-[9px] font-black uppercase text-slate-950"
            >
              {editingId ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
              {editingId ? 'Salvar opção' : 'Criar opção'}
            </button>
            {editingId && (
              <button
                type="button"
                onClick={resetDraft}
                disabled={disabled}
                className="min-h-10 rounded-xl border border-slate-700 bg-slate-950 px-4 text-[9px] font-black uppercase text-slate-400"
              >
                Cancelar edição
              </button>
            )}
          </div>

          {catalog.length > 0 && (
            <div className="space-y-2 border-t border-amber-500/15 pt-3">
              {catalog.map(item => (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/70 p-3"
                >
                  <div className="min-w-0">
                    <strong className="block truncate text-[11px] text-white">
                      {item.name}
                    </strong>
                    <span className="text-[9px] text-slate-500">
                      {item.currentQuantity} {item.unit} · mínimo {item.minimumQuantity} {item.unit}
                    </span>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      onClick={() => editCatalogItem(item)}
                      disabled={disabled}
                      className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-700 bg-slate-900 text-slate-300"
                      aria-label={`Editar ${item.name}`}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeCatalogItem(item)}
                      disabled={disabled}
                      className="flex h-8 w-8 items-center justify-center rounded-lg border border-red-500/20 bg-red-500/10 text-red-300"
                      aria-label={`Remover ${item.name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {composition.lines.some(line => line.quantity <= 0) && (
        <p className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-[10px] text-red-300">
          Todos os componentes selecionados precisam ter quantidade maior que zero.
        </p>
      )}

      {catalog.length === 0 && composition.lines.length === 0 && (
        <input type="hidden" value={EMPTY_PRODUCT_COMPOSITION.kind} readOnly />
      )}
    </div>
  );
}
