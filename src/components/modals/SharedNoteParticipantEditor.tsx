import React, { useState } from 'react';
import { serverTimestamp, writeBatch, doc } from 'firebase/firestore';
import {
  ArrowLeft,
  CheckCircle2,
  Clock3,
  Plus,
  Save,
  Trash2,
} from 'lucide-react';
import type { Note, NoteChecklistItem } from '../../types';
import { auth, db } from '../../utils/firebase';
import {
  createAuditLog,
  formatNoteAuditTimestamp,
} from '../../utils/noteCollaboration';

export interface SharedNoteParticipantInvitation {
  id: string;
  ownerId: string;
  ownerName: string;
  noteId: string;
  status: 'accepted';
}

interface SharedNoteParticipantEditorProps {
  invitation: SharedNoteParticipantInvitation;
  note: Note;
  onClose: () => void;
}

const getCurrentUserName = (): string =>
  auth.currentUser?.displayName?.trim() ||
  auth.currentUser?.email ||
  'Você';

const checklistChanged = (
  current: NoteChecklistItem[],
  next: NoteChecklistItem[]
): boolean => JSON.stringify(current) !== JSON.stringify(next);

export const SharedNoteParticipantEditor: React.FC<
  SharedNoteParticipantEditorProps
> = ({ invitation, note, onClose }) => {
  const [draftTitle, setDraftTitle] = useState(note.title);
  const [draftContent, setDraftContent] = useState(note.content);
  const [draftChecklist, setDraftChecklist] = useState<NoteChecklistItem[]>(
    note.checklist.map(item => ({ ...item }))
  );
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const addChecklistItem = () => {
    setDraftChecklist(previous => [
      ...previous,
      {
        id: `item-participant-${Date.now()}-${previous.length}`,
        text: '',
        done: false,
      },
    ]);
  };

  const updateChecklistText = (itemId: string, text: string) => {
    setDraftChecklist(previous =>
      previous.map(item => (item.id === itemId ? { ...item, text } : item))
    );
  };

  const toggleChecklistItem = (itemId: string) => {
    setDraftChecklist(previous =>
      previous.map(item =>
        item.id === itemId ? { ...item, done: !item.done } : item
      )
    );
  };

  const removeChecklistItem = (itemId: string) => {
    setDraftChecklist(previous =>
      previous.filter(item => item.id !== itemId)
    );
  };

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();

    const user = auth.currentUser;
    if (!user || invitation.status !== 'accepted') {
      setSaveError('Sua participação precisa estar ativa para editar esta nota.');
      return;
    }

    const normalizedTitle = draftTitle.trim().toUpperCase();
    const normalizedContent = draftContent.trim();
    const normalizedChecklist = draftChecklist
      .map(item => ({ ...item, text: item.text.trim() }))
      .filter(item => item.text.length > 0);

    if (!normalizedTitle || !normalizedContent) {
      setSaveError('Preencha o título e o conteúdo antes de salvar.');
      return;
    }

    const changedSections: string[] = [];
    if (normalizedTitle !== note.title) changedSections.push('título');
    if (normalizedContent !== note.content) changedSections.push('conteúdo');
    if (checklistChanged(note.checklist, normalizedChecklist)) {
      changedSections.push('checklist');
    }

    if (changedSections.length === 0) {
      onClose();
      return;
    }

    setIsSaving(true);
    setSaveError('');
    const now = new Date().toISOString();

    try {
      const batch = writeBatch(db);
      batch.update(
        doc(db, 'users', invitation.ownerId, 'tasks', invitation.noteId),
        {
          title: normalizedTitle,
          content: normalizedContent,
          checklist: normalizedChecklist,
          auditLogs: [
            createAuditLog(
              getCurrentUserName(),
              `Editou ${changedSections.join(', ')} como participante`,
              user.uid,
              now
            ),
            ...note.auditLogs,
          ],
          updatedAtIso: now,
          serverUpdatedAt: serverTimestamp(),
        }
      );
      batch.update(doc(db, 'note_invitations', invitation.id), {
        noteUpdatedAtIso: now,
        updatedAt: serverTimestamp(),
      });
      await batch.commit();
      onClose();
    } catch (error) {
      console.warn('Falha ao salvar alterações do participante.', error);
      setSaveError(
        'Não foi possível sincronizar suas alterações. Confirme a conexão e tente novamente.'
      );
    } finally {
      setIsSaving(false);
    }
  };

  const latestLog = note.auditLogs[0];

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/90 p-4 backdrop-blur-md animate-fade-in">
      <form
        onSubmit={handleSave}
        className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-3xl border border-teal-500/20 bg-slate-900 p-5 shadow-2xl animate-scale-up"
      >
        <div className="sticky top-0 z-10 -mx-1 mb-5 flex items-start justify-between gap-3 border-b border-slate-800 bg-slate-900/95 px-1 pb-3 backdrop-blur">
          <div className="flex min-w-0 items-start gap-2.5">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-950 text-slate-400 transition-colors hover:text-white disabled:opacity-50"
              aria-label="Voltar para notas participantes"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div className="min-w-0">
              <h3 className="truncate text-base font-black text-white">
                Editar nota compartilhada
              </h3>
              <p className="mt-1 truncate text-[10px] text-slate-500">
                Criada por {invitation.ownerName}. Suas alterações serão sincronizadas para todos os participantes.
              </p>
            </div>
          </div>
          <span className="shrink-0 rounded-full border border-teal-500/25 bg-teal-500/10 px-2 py-1 text-[8px] font-bold font-mono uppercase text-teal-300">
            Participação ativa
          </span>
        </div>

        {saveError && (
          <div className="mb-4 rounded-2xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-[10px] leading-relaxed text-red-300">
            {saveError}
          </div>
        )}

        <div className="space-y-5">
          <div>
            <label
              htmlFor="shared-note-participant-title"
              className="mb-1.5 block text-[9px] font-mono uppercase text-slate-500"
            >
              Título
            </label>
            <input
              id="shared-note-participant-title"
              value={draftTitle}
              onChange={event => setDraftTitle(event.target.value)}
              disabled={isSaving}
              className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-sm font-bold text-white outline-none transition-colors focus:border-teal-500 disabled:opacity-60"
              maxLength={140}
            />
          </div>

          <div>
            <label
              htmlFor="shared-note-participant-content"
              className="mb-1.5 block text-[9px] font-mono uppercase text-slate-500"
            >
              Conteúdo
            </label>
            <textarea
              id="shared-note-participant-content"
              value={draftContent}
              onChange={event => setDraftContent(event.target.value)}
              disabled={isSaving}
              rows={7}
              className="w-full resize-y rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-xs leading-relaxed text-slate-200 outline-none transition-colors focus:border-teal-500 disabled:opacity-60"
              maxLength={12000}
            />
          </div>

          <section className="space-y-3 rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h4 className="text-xs font-black uppercase text-white">
                  Checklist compartilhado
                </h4>
                <p className="mt-1 text-[9px] text-slate-500">
                  Marque, renomeie, adicione ou remova tarefas.
                </p>
              </div>
              <button
                type="button"
                onClick={addChecklistItem}
                disabled={isSaving}
                className="flex shrink-0 items-center gap-1.5 rounded-lg border border-teal-500/25 bg-teal-500/10 px-2.5 py-1.5 text-[9px] font-bold uppercase text-teal-300 hover:bg-teal-500/20 disabled:opacity-50"
              >
                <Plus className="h-3.5 w-3.5" />
                Adicionar
              </button>
            </div>

            {draftChecklist.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-800 px-4 py-6 text-center text-[10px] italic text-slate-600">
                Nenhuma tarefa adicionada.
              </div>
            ) : (
              <div className="space-y-2">
                {draftChecklist.map(item => (
                  <div
                    key={item.id}
                    className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900 p-2"
                  >
                    <input
                      type="checkbox"
                      checked={item.done}
                      onChange={() => toggleChecklistItem(item.id)}
                      disabled={isSaving}
                      className="h-4 w-4 shrink-0 accent-teal-500"
                      aria-label={`Marcar ${item.text || 'nova tarefa'}`}
                    />
                    <input
                      value={item.text}
                      onChange={event =>
                        updateChecklistText(item.id, event.target.value)
                      }
                      disabled={isSaving}
                      placeholder="Descrição da tarefa"
                      className={`min-w-0 flex-1 bg-transparent px-1 py-1 text-xs outline-none ${
                        item.done
                          ? 'text-slate-500 line-through'
                          : 'text-slate-200'
                      }`}
                      maxLength={240}
                    />
                    <button
                      type="button"
                      onClick={() => removeChecklistItem(item.id)}
                      disabled={isSaving}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-600 hover:bg-red-500/10 hover:text-red-300 disabled:opacity-50"
                      aria-label="Remover tarefa"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {latestLog && (
            <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3 text-[9px] font-mono text-slate-500">
              <div className="flex items-center gap-1.5 text-orange-400">
                <Clock3 className="h-3 w-3" />
                <span className="font-bold uppercase">Última alteração registrada</span>
              </div>
              <p className="mt-1 text-slate-400">
                <span className="text-slate-300">{latestLog.user}</span>:{' '}
                {latestLog.action}
              </p>
              <span className="mt-1 block text-[8px] text-slate-600">
                {formatNoteAuditTimestamp(latestLog.timestamp)}
              </span>
            </div>
          )}
        </div>

        <div className="mt-6 grid grid-cols-2 gap-2 border-t border-slate-800 pt-4">
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="rounded-xl border border-slate-700 bg-slate-950 py-2.5 text-[10px] font-bold uppercase text-slate-300 hover:border-slate-600 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={isSaving}
            className="flex items-center justify-center gap-2 rounded-xl bg-teal-500 py-2.5 text-[10px] font-black uppercase text-slate-950 transition-colors hover:bg-teal-400 disabled:opacity-50"
          >
            {isSaving ? (
              <>
                <CheckCircle2 className="h-4 w-4 animate-pulse" />
                Salvando...
              </>
            ) : (
              <>
                <Save className="h-4 w-4" />
                Salvar alterações
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
};
