import { MessageSquarePlus, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { parseProductQuickNotes } from '../../utils/productCustomization';

interface ProductQuickNotesEditorProps {
  value: string[];
  onChange: (notes: string[]) => void;
  disabled?: boolean;
}

export function ProductQuickNotesEditor({
  value,
  onChange,
  disabled = false,
}: ProductQuickNotesEditorProps) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');

  const addNote = (): void => {
    const note = draft.trim().slice(0, 60);
    if (!note) return;
    const next = parseProductQuickNotes([...value, note]);
    if (next.length === value.length) {
      setError('Essa observação já foi cadastrada.');
      return;
    }
    onChange(next);
    setDraft('');
    setError('');
  };

  const updateNote = (index: number, note: string): void => {
    const next = [...value];
    next[index] = note.slice(0, 60);
    onChange(next);
    setError('');
  };

  return (
    <section
      className="space-y-3 rounded-2xl border border-slate-800 bg-slate-950/55 p-4"
      id="product-quick-notes-control"
    >
      <div>
        <h4 className="flex items-center gap-2 font-mono text-xs uppercase text-slate-400">
          <MessageSquarePlus className="h-4 w-4 text-teal-400" />
          Botões rápidos de observação
        </h4>
        <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
          Cadastre atalhos opcionais que aparecem ao montar o item no PDV, como Sem gelo, Limão, Pouco açúcar, Bem passado ou Copo 1.
        </p>
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={draft}
          onChange={event => setDraft(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter') {
              event.preventDefault();
              addNote();
            }
          }}
          disabled={disabled || value.length >= 30}
          maxLength={60}
          placeholder="Ex.: sem gelo"
          className="min-w-0 flex-1 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-xs text-white outline-none focus:border-teal-500 disabled:opacity-45"
        />
        <button
          type="button"
          onClick={addNote}
          disabled={disabled || !draft.trim() || value.length >= 30}
          className="flex min-h-10 shrink-0 items-center gap-1 rounded-xl bg-teal-500 px-3 text-[9px] font-black uppercase text-slate-950 disabled:opacity-40"
          id="add-product-quick-note"
        >
          <Plus className="h-4 w-4" />
          Adicionar
        </button>
      </div>

      {value.length > 0 ? (
        <div className="grid gap-2 sm:grid-cols-2" id="product-quick-notes-list">
          {value.map((note, index) => (
            <div
              key={`quick-note-${index}`}
              className="grid grid-cols-[minmax(0,1fr)_36px] gap-2 rounded-xl border border-slate-800 bg-slate-900/75 p-2"
            >
              <input
                value={note}
                onChange={event => updateNote(index, event.target.value)}
                onBlur={() => onChange(parseProductQuickNotes(value))}
                disabled={disabled}
                maxLength={60}
                className="min-w-0 rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-2 text-[10px] text-white outline-none focus:border-teal-500 disabled:opacity-45"
                aria-label={`Observação rápida ${index + 1}`}
              />
              <button
                type="button"
                onClick={() => onChange(value.filter((_, itemIndex) => itemIndex !== index))}
                disabled={disabled}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-red-500/20 bg-red-500/10 text-red-300 disabled:opacity-40"
                aria-label={`Excluir observação ${note}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-slate-800 px-3 py-5 text-center text-[10px] text-slate-600">
          Nenhum atalho cadastrado. O campo livre de observação continua disponível no pedido.
        </div>
      )}

      {error && (
        <p className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[9px] text-amber-200">
          {error}
        </p>
      )}
    </section>
  );
}
