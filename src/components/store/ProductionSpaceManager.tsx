import { useEffect, useMemo, useState } from 'react';
import { Factory, Plus, Save, ToggleLeft, ToggleRight } from 'lucide-react';

const KNOWN_SPACES_STORAGE_KEY = 'kyrub_producao_spaces_known_v2';

const normalize = (value: string): string =>
  value.trim().toLocaleUpperCase('pt-BR');

const uniqueLabels = (values: string[]): string[] => {
  const seen = new Set<string>();
  return values.filter(value => {
    const label = value.trim();
    const key = normalize(label);
    if (!label || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const readKnownSpaces = (): string[] => {
  try {
    const raw = localStorage.getItem(KNOWN_SPACES_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? uniqueLabels(parsed.filter((item): item is string => typeof item === 'string'))
      : [];
  } catch {
    return [];
  }
};

type PendingRename = {
  previousLabel: string;
  nextLabel: string;
  stage: 'request-add' | 'await-add';
};

type ProductionSpaceManagerProps = {
  newSpace: string;
  setNewSpace: (value: string) => void;
  addSpace: () => void;
  activeSpaces: string[];
  removeSpace: (space: string) => void;
};

export function ProductionSpaceManager({
  newSpace,
  setNewSpace,
  addSpace,
  activeSpaces,
  removeSpace,
}: ProductionSpaceManagerProps) {
  const [knownSpaces, setKnownSpaces] = useState<string[]>(() =>
    uniqueLabels([...readKnownSpaces(), ...activeSpaces])
  );
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [pendingActivation, setPendingActivation] = useState<string | null>(null);
  const [pendingRename, setPendingRename] = useState<PendingRename | null>(null);

  const activeKeys = useMemo(
    () => new Set(activeSpaces.map(normalize)),
    [activeSpaces]
  );

  useEffect(() => {
    setKnownSpaces(current => {
      const merged = uniqueLabels([...current, ...activeSpaces]);
      localStorage.setItem(KNOWN_SPACES_STORAGE_KEY, JSON.stringify(merged));
      return merged;
    });
  }, [activeSpaces]);

  useEffect(() => {
    if (!pendingActivation) return;
    if (normalize(newSpace) !== normalize(pendingActivation)) return;
    addSpace();
    setPendingActivation(null);
  }, [addSpace, newSpace, pendingActivation]);

  useEffect(() => {
    if (!pendingRename) return;

    if (pendingRename.stage === 'request-add') {
      if (normalize(newSpace) !== normalize(pendingRename.nextLabel)) return;
      addSpace();
      setPendingRename(current => current ? { ...current, stage: 'await-add' } : null);
      return;
    }

    const addedLabel = activeSpaces.find(
      space => normalize(space) === normalize(pendingRename.nextLabel)
    );
    if (!addedLabel) return;

    removeSpace(pendingRename.previousLabel);
    setKnownSpaces(current => {
      const next = uniqueLabels(
        current.map(space =>
          normalize(space) === normalize(pendingRename.previousLabel)
            ? addedLabel
            : space
        )
      );
      localStorage.setItem(KNOWN_SPACES_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
    setDrafts(current => {
      const next = { ...current };
      delete next[pendingRename.previousLabel];
      next[addedLabel] = addedLabel;
      return next;
    });
    setPendingRename(null);
  }, [activeSpaces, addSpace, newSpace, pendingRename, removeSpace]);

  const addNewSpace = (): void => {
    if (!newSpace.trim()) return;
    addSpace();
  };

  const saveLabel = (space: string): void => {
    const nextLabel = (drafts[space] ?? space).trim();
    if (!nextLabel || normalize(nextLabel) === normalize(space)) return;

    const duplicate = knownSpaces.some(
      current => normalize(current) === normalize(nextLabel) && normalize(current) !== normalize(space)
    );
    if (duplicate) return;

    if (!activeKeys.has(normalize(space))) {
      setKnownSpaces(current => {
        const next = uniqueLabels(
          current.map(item => normalize(item) === normalize(space) ? nextLabel : item)
        );
        localStorage.setItem(KNOWN_SPACES_STORAGE_KEY, JSON.stringify(next));
        return next;
      });
      setDrafts(current => {
        const next = { ...current };
        delete next[space];
        next[nextLabel] = nextLabel;
        return next;
      });
      return;
    }

    setNewSpace(nextLabel);
    setPendingRename({
      previousLabel: space,
      nextLabel,
      stage: 'request-add',
    });
  };

  const toggleSpace = (space: string): void => {
    const isActive = activeKeys.has(normalize(space));
    if (isActive) {
      removeSpace(space);
      return;
    }

    setNewSpace(space);
    setPendingActivation(space);
  };

  return (
    <section
      className="space-y-4 rounded-2xl border border-slate-850 bg-slate-950/40 p-4"
      id="production-space-manager"
    >
      <div>
        <div className="flex items-center gap-2">
          <Factory className="h-4 w-4 text-teal-400" />
          <h4 className="text-[10px] font-black uppercase text-teal-400">
            Espaços de produção
          </h4>
        </div>
        <p className="mt-1 text-[9px] leading-relaxed text-slate-500">
          Cadastre as áreas reais onde os pedidos são preparados. Use os nomes que fazem sentido para sua operação.
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
        <input
          type="text"
          value={newSpace}
          onChange={event => setNewSpace(event.target.value)}
          onKeyDown={event => event.key === 'Enter' && addNewSpace()}
          placeholder="Ex.: Saladas, Chapa, Cozinha, Bancada 2"
          className="min-h-10 rounded-xl border border-slate-800 bg-slate-950 px-3 text-xs text-white outline-none focus:border-teal-500/40"
        />
        <button
          type="button"
          onClick={addNewSpace}
          disabled={!newSpace.trim()}
          className="flex min-h-10 items-center justify-center gap-2 rounded-xl bg-teal-500 px-4 text-[9px] font-black uppercase text-slate-950 disabled:bg-slate-800 disabled:text-slate-600"
        >
          <Plus className="h-4 w-4" />
          Adicionar
        </button>
      </div>

      {knownSpaces.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-800 py-7 text-center text-[9px] text-slate-500">
          Nenhum espaço de produção cadastrado. Adicione somente o que realmente existe na sua operação.
        </div>
      ) : (
        <div className="space-y-2">
          {knownSpaces.map(space => {
            const isActive = activeKeys.has(normalize(space));
            const draft = drafts[space] ?? space;
            return (
              <div
                key={space}
                className={`rounded-2xl border p-3 ${isActive ? 'border-slate-800 bg-slate-950' : 'border-slate-850 bg-slate-950/50 opacity-70'}`}
              >
                <div className="space-y-2">
                  <input
                    value={draft}
                    onChange={event => setDrafts(current => ({
                      ...current,
                      [space]: event.target.value,
                    }))}
                    className="min-h-9 w-full rounded-xl border border-slate-800 bg-slate-900 px-3 text-[10px] text-white outline-none focus:border-teal-500/40"
                    aria-label={`Nome do espaço de produção ${space}`}
                  />
                  <button
                    type="button"
                    onClick={() => saveLabel(space)}
                    disabled={!draft.trim() || normalize(draft) === normalize(space)}
                    className="flex min-h-9 w-full items-center justify-center gap-1 rounded-xl border border-slate-700 px-3 text-[8px] font-black uppercase text-slate-300 disabled:opacity-50"
                  >
                    <Save className="h-3.5 w-3.5" />
                    Salvar
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleSpace(space)}
                    className={`flex min-h-9 w-full items-center justify-center gap-1 rounded-xl border px-3 text-[8px] font-black uppercase ${isActive ? 'border-emerald-500/20 text-emerald-300' : 'border-slate-700 text-slate-500'}`}
                  >
                    {isActive ? <ToggleRight className="h-4 w-4" /> : <ToggleLeft className="h-4 w-4" />}
                    {isActive ? 'Ativo' : 'Inativo'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
