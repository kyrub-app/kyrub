import { Boxes, Save } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { OptionInventoryImpactRecord } from '../../../shared/optionInventoryImpact';
import type { InventoryCatalogItem } from '../../utils/productInventory';
import {
  getCatalogOptionInventoryImpact,
  saveCatalogOptionInventoryImpact,
} from '../../utils/productOptionInventory';
import { auth } from '../../utils/firebase';
import type { ProductOptionGroupDraft } from './ProductOptionGroupsEditor';

interface OptionInventoryImpactEditorProps {
  path: string;
  groups: ProductOptionGroupDraft[];
  inventoryCatalog: InventoryCatalogItem[];
  impacts: OptionInventoryImpactRecord[];
  onImpactsChange: (impacts: OptionInventoryImpactRecord[]) => void;
  disabled?: boolean;
}

type DraftImpact = {
  inventoryItemId: string;
  quantity: string;
};

const impactKey = (groupId: string, choiceId: string): string =>
  `${groupId}:${choiceId}`;

export function OptionInventoryImpactEditor({
  path,
  groups,
  inventoryCatalog,
  impacts,
  onImpactsChange,
  disabled = false,
}: OptionInventoryImpactEditorProps) {
  const [drafts, setDrafts] = useState<Record<string, DraftImpact>>({});
  const [savingKey, setSavingKey] = useState('');
  const [message, setMessage] = useState('');

  const choices = useMemo(
    () =>
      groups.flatMap(group =>
        group.choices
          .filter(choice => choice.name.trim())
          .map(choice => ({
            groupId: group.id,
            groupName: group.name.trim() || 'Grupo',
            choiceId: choice.id,
            choiceName: choice.name.trim(),
            priceDelta: choice.priceDelta,
          }))
      ),
    [groups]
  );

  const currentDraft = (groupId: string, choiceId: string): DraftImpact => {
    const key = impactKey(groupId, choiceId);
    if (drafts[key]) return drafts[key];
    const impact = getCatalogOptionInventoryImpact(
      impacts,
      path,
      groupId,
      choiceId
    );
    const firstLine = impact?.lines[0];
    return {
      inventoryItemId: firstLine?.inventoryItemId ?? '',
      quantity: firstLine ? String(firstLine.quantity) : '',
    };
  };

  const updateDraft = (
    groupId: string,
    choiceId: string,
    patch: Partial<DraftImpact>
  ): void => {
    const key = impactKey(groupId, choiceId);
    setDrafts(previous => ({
      ...previous,
      [key]: { ...currentDraft(groupId, choiceId), ...patch },
    }));
    setMessage('');
  };

  const saveChoice = async (groupId: string, choiceId: string): Promise<void> => {
    const user = auth.currentUser;
    if (!user) {
      setMessage('Faça login novamente para salvar o consumo do adicional.');
      return;
    }

    const key = impactKey(groupId, choiceId);
    const draft = currentDraft(groupId, choiceId);
    const quantity = Number.parseFloat(draft.quantity.replace(',', '.'));
    if (draft.inventoryItemId && (!Number.isFinite(quantity) || quantity <= 0)) {
      setMessage('Informe uma quantidade maior que zero para o insumo escolhido.');
      return;
    }

    setSavingKey(key);
    setMessage('');
    try {
      const next = await saveCatalogOptionInventoryImpact(
        user,
        path,
        groupId,
        choiceId,
        draft.inventoryItemId
          ? [{ inventoryItemId: draft.inventoryItemId, quantity }]
          : []
      );
      onImpactsChange(next);
      setDrafts(previous => {
        const copy = { ...previous };
        delete copy[key];
        return copy;
      });
      setMessage(
        draft.inventoryItemId
          ? 'Baixa de estoque vinculada à opção.'
          : 'Esta opção não fará baixa adicional de estoque.'
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Não foi possível salvar a baixa do adicional.'
      );
    } finally {
      setSavingKey('');
    }
  };

  return (
    <section
      className="space-y-3 rounded-2xl border border-cyan-500/20 bg-cyan-500/[0.04] p-4"
      id="option-inventory-impact-control"
    >
      <div>
        <h4 className="flex items-center gap-2 font-mono text-xs uppercase text-slate-300">
          <Boxes className="h-4 w-4 text-cyan-400" />
          Impacto dos adicionais no estoque
        </h4>
        <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
          Vincule uma opção cobrada a um insumo privado. Ex.: “Bacon extra + R$ 5” pode consumir 30 g de Bacon além da ficha técnica normal do lanche.
        </p>
      </div>

      {choices.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-800 px-3 py-4 text-center text-[10px] text-slate-600">
          Crie primeiro uma opção no Grupo/Subgrupo para vincular consumo adicional.
        </div>
      ) : inventoryCatalog.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-800 px-3 py-4 text-center text-[10px] text-slate-600">
          Cadastre os insumos na aba Estoque de um produto antes de vincular adicionais.
        </div>
      ) : (
        <div className="space-y-2">
          {choices.map(choice => {
            const key = impactKey(choice.groupId, choice.choiceId);
            const draft = currentDraft(choice.groupId, choice.choiceId);
            const selectedItem = inventoryCatalog.find(
              item => item.id === draft.inventoryItemId
            );
            return (
              <article
                key={key}
                className="rounded-xl border border-slate-800 bg-slate-950/75 p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <strong className="block truncate text-[10px] text-slate-200">
                      {choice.groupName} · {choice.choiceName}
                    </strong>
                    <span className="text-[8px] text-slate-500">
                      Acréscimo: {choice.priceDelta || '0'}
                    </span>
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-[minmax(0,1fr)_100px_40px] gap-2">
                  <select
                    value={draft.inventoryItemId}
                    onChange={event =>
                      updateDraft(choice.groupId, choice.choiceId, {
                        inventoryItemId: event.target.value,
                        quantity: event.target.value ? draft.quantity : '',
                      })
                    }
                    disabled={disabled || savingKey === key}
                    className="min-w-0 rounded-xl border border-slate-800 bg-slate-900 px-2.5 py-2 text-[10px] text-white disabled:opacity-45"
                    aria-label={`Insumo de ${choice.choiceName}`}
                  >
                    <option value="">Sem baixa adicional</option>
                    {inventoryCatalog.map(item => (
                      <option key={item.id} value={item.id}>
                        {item.name} ({item.unit})
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min="0"
                    step="0.001"
                    value={draft.quantity}
                    onChange={event =>
                      updateDraft(choice.groupId, choice.choiceId, {
                        quantity: event.target.value,
                      })
                    }
                    disabled={
                      disabled || savingKey === key || !draft.inventoryItemId
                    }
                    placeholder={selectedItem?.unit ?? 'qtd.'}
                    className="rounded-xl border border-slate-800 bg-slate-900 px-2 py-2 text-[10px] text-white disabled:opacity-35"
                    aria-label={`Quantidade consumida por ${choice.choiceName}`}
                  />
                  <button
                    type="button"
                    onClick={() => void saveChoice(choice.groupId, choice.choiceId)}
                    disabled={disabled || savingKey === key}
                    className="flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-500 text-slate-950 disabled:opacity-40"
                    aria-label={`Salvar impacto de ${choice.choiceName}`}
                  >
                    <Save className="h-3.5 w-3.5" />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {message && (
        <p className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-[9px] text-slate-300">
          {message}
        </p>
      )}
    </section>
  );
}
