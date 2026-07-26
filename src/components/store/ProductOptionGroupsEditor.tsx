import {
  ListPlus,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import type { ProductOptionGroup } from '../../types';

export type ProductOptionChoiceDraft = {
  id: string;
  name: string;
  priceDelta: string;
};

export type ProductOptionGroupDraft = {
  id: string;
  name: string;
  minSelections: number;
  maxSelections: number;
  choices: ProductOptionChoiceDraft[];
};

const createId = (prefix: string): string =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export const createProductOptionChoiceDraft = (): ProductOptionChoiceDraft => ({
  id: createId('choice'),
  name: '',
  priceDelta: '0',
});

export const createProductOptionGroupDraft = (): ProductOptionGroupDraft => ({
  id: createId('group'),
  name: '',
  minSelections: 1,
  maxSelections: 1,
  choices: [createProductOptionChoiceDraft(), createProductOptionChoiceDraft()],
});

export const productOptionGroupsToDrafts = (
  groups: ProductOptionGroup[] | undefined
): ProductOptionGroupDraft[] =>
  (groups ?? []).map(group => ({
    id: group.id,
    name: group.name,
    minSelections: group.minSelections,
    maxSelections: group.maxSelections,
    choices: group.choices.map(choice => ({
      id: choice.id,
      name: choice.name,
      priceDelta: String(choice.priceDelta),
    })),
  }));

export const buildProductOptionGroups = (
  drafts: ProductOptionGroupDraft[]
): ProductOptionGroup[] =>
  drafts.map((group, groupIndex) => {
    const name = group.name.trim();
    const choices = group.choices.flatMap((choice, choiceIndex) => {
      const choiceName = choice.name.trim();
      if (!choiceName) return [];
      const parsedDelta = Number.parseFloat(choice.priceDelta.replace(',', '.'));
      if (!Number.isFinite(parsedDelta) || parsedDelta < 0) {
        throw new Error(
          `Revise o preço adicional de “${choiceName || `opção ${choiceIndex + 1}`}”.`
        );
      }
      return [{
        id: choice.id || `choice-${groupIndex + 1}-${choiceIndex + 1}`,
        name: choiceName,
        priceDelta: Number(parsedDelta.toFixed(2)),
      }];
    });

    if (!name) {
      throw new Error(`Informe o nome da etapa/grupo ${groupIndex + 1}.`);
    }
    if (choices.length === 0) {
      throw new Error(`Adicione opções à etapa “${name}”.`);
    }
    if (
      group.minSelections < 0 ||
      group.maxSelections < 1 ||
      group.minSelections > group.maxSelections ||
      group.maxSelections > choices.length
    ) {
      throw new Error(`Revise o mínimo e o máximo de escolhas em “${name}”.`);
    }

    return {
      id: group.id || `group-${groupIndex + 1}`,
      name,
      minSelections: group.minSelections,
      maxSelections: group.maxSelections,
      choices,
    };
  });

interface ProductOptionGroupsEditorProps {
  value: ProductOptionGroupDraft[];
  onChange: (groups: ProductOptionGroupDraft[]) => void;
  disabled?: boolean;
}

export function ProductOptionGroupsEditor({
  value,
  onChange,
  disabled = false,
}: ProductOptionGroupsEditorProps) {
  const updateGroup = (
    groupId: string,
    patch: Partial<ProductOptionGroupDraft>
  ): void => {
    onChange(
      value.map(group =>
        group.id === groupId ? { ...group, ...patch } : group
      )
    );
  };

  const updateChoice = (
    groupId: string,
    choiceId: string,
    patch: Partial<ProductOptionChoiceDraft>
  ): void => {
    onChange(
      value.map(group =>
        group.id === groupId
          ? {
              ...group,
              choices: group.choices.map(choice =>
                choice.id === choiceId ? { ...choice, ...patch } : choice
              ),
            }
          : group
      )
    );
  };

  return (
    <section
      className="space-y-3 rounded-2xl border border-slate-800 bg-slate-950/55 p-4"
      id="product-option-groups-control"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="flex items-center gap-2 font-mono text-xs uppercase text-slate-400">
            <ListPlus className="h-4 w-4 text-orange-400" />
            Personalização, etapas e múltiplas escolhas
          </h4>
          <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
            Crie etapas como Entrada, Principal e Sobremesa, ou grupos como Tamanho, Ingredientes, Cores e Acessórios. Mínimo zero torna o grupo opcional; máximo maior que um permite múltiplas escolhas.
          </p>
        </div>
        <button
          type="button"
          onClick={() => onChange([...value, createProductOptionGroupDraft()])}
          disabled={disabled || value.length >= 10}
          className="flex min-h-10 shrink-0 items-center gap-1 rounded-xl bg-orange-500 px-3 text-[9px] font-black uppercase text-slate-950 disabled:opacity-40"
          id="add-product-option-group"
        >
          <Plus className="h-4 w-4" />
          Grupo
        </button>
      </div>

      {value.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-800 px-4 py-6 text-center text-[10px] text-slate-600">
          Este item será adicionado diretamente. Crie um grupo quando o cliente precisar montar, personalizar ou escolher etapas.
        </div>
      ) : (
        <div className="space-y-3" id="product-option-groups-list">
          {value.map((group, groupIndex) => (
            <article
              key={group.id}
              className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/75 p-3"
            >
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <span className="font-mono text-[8px] font-black uppercase tracking-wide text-orange-400">
                    Etapa/grupo {groupIndex + 1}
                  </span>
                  <input
                    type="text"
                    value={group.name}
                    onChange={event =>
                      updateGroup(group.id, { name: event.target.value })
                    }
                    disabled={disabled}
                    placeholder="Ex.: Entrada, Principal, Ingredientes, Acessórios"
                    className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white focus:border-orange-500 focus:outline-none disabled:opacity-45"
                  />
                </div>
                <button
                  type="button"
                  onClick={() =>
                    onChange(value.filter(candidate => candidate.id !== group.id))
                  }
                  disabled={disabled}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-red-500/20 bg-red-500/10 text-red-300 disabled:opacity-40"
                  aria-label={`Remover grupo ${group.name || groupIndex + 1}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <label className="text-[9px] font-bold uppercase text-slate-500">
                  Mínimo
                  <input
                    type="number"
                    min="0"
                    max={group.maxSelections}
                    value={group.minSelections}
                    onChange={event =>
                      updateGroup(group.id, {
                        minSelections: Math.max(0, Number(event.target.value) || 0),
                      })
                    }
                    disabled={disabled}
                    className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white disabled:opacity-45"
                  />
                </label>
                <label className="text-[9px] font-bold uppercase text-slate-500">
                  Máximo
                  <input
                    type="number"
                    min="1"
                    max={Math.max(1, group.choices.length)}
                    value={group.maxSelections}
                    onChange={event =>
                      updateGroup(group.id, {
                        maxSelections: Math.max(1, Number(event.target.value) || 1),
                      })
                    }
                    disabled={disabled}
                    className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white disabled:opacity-45"
                  />
                </label>
              </div>

              <div className="space-y-2">
                {group.choices.map((choice, choiceIndex) => (
                  <div
                    key={choice.id}
                    className="grid grid-cols-[minmax(0,1fr)_100px_36px] gap-2"
                  >
                    <input
                      type="text"
                      value={choice.name}
                      onChange={event =>
                        updateChoice(group.id, choice.id, {
                          name: event.target.value,
                        })
                      }
                      disabled={disabled}
                      placeholder={`Opção ${choiceIndex + 1}`}
                      className="min-w-0 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white focus:border-orange-500 focus:outline-none disabled:opacity-45"
                    />
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={choice.priceDelta}
                      onChange={event =>
                        updateChoice(group.id, choice.id, {
                          priceDelta: event.target.value,
                        })
                      }
                      disabled={disabled}
                      placeholder="+ R$"
                      title="Preço adicional"
                      className="rounded-xl border border-slate-800 bg-slate-950 px-2 py-2 text-xs text-white focus:border-orange-500 focus:outline-none disabled:opacity-45"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        updateGroup(group.id, {
                          choices: group.choices.filter(
                            candidate => candidate.id !== choice.id
                          ),
                        })
                      }
                      disabled={disabled || group.choices.length <= 1}
                      className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-800 bg-slate-950 text-slate-500 disabled:opacity-30"
                      aria-label={`Remover opção ${choice.name || choiceIndex + 1}`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={() =>
                  updateGroup(group.id, {
                    choices: [
                      ...group.choices,
                      createProductOptionChoiceDraft(),
                    ],
                  })
                }
                disabled={disabled || group.choices.length >= 30}
                className="flex min-h-9 items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-950 px-3 text-[9px] font-black uppercase text-slate-300 disabled:opacity-40"
              >
                <Plus className="h-3.5 w-3.5" />
                Adicionar opção
              </button>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
