import React, { useEffect, useState } from 'react';
import {
  Bell,
  Camera,
  Check,
  Clock,
  Edit,
  Plus,
  Send,
  Share2,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { Note } from '../../types';

interface PerfilTabProps {
  notes: Note[];
  showSharedNotesModal: boolean;
  setShowSharedNotesModal: (val: boolean) => void;
  showAddNoteForm: boolean;
  setShowAddNoteForm: (val: boolean) => void;
  editingNoteId: string | null;
  setEditingNoteId: (val: string | null) => void;
  newNoteTitle: string;
  setNewNoteTitle: (val: string) => void;
  newNoteContent: string;
  setNewNoteContent: (val: string) => void;
  newNoteChecklist: string;
  setNewNoteChecklist: (val: string) => void;
  selectedFriendsForNote: string[];
  setSelectedFriendsForNote: React.Dispatch<
    React.SetStateAction<string[]>
  >;
  setShowUserSearchModal: (val: boolean) => void;
  newNoteMediaUrls: string[];
  setNewNoteMediaUrls: React.Dispatch<
    React.SetStateAction<string[]>
  >;
  newNoteReminderDateTime: string;
  setNewNoteReminderDateTime: (val: string) => void;
  newNoteIsPublishedToFeed: boolean;
  setNewNoteIsPublishedToFeed: (val: boolean) => void;
  isUploading: boolean;
  uploadProgress: number;
  handleSimulatedUpload: (
    event: React.ChangeEvent<HTMLInputElement>
  ) => void;
  handleCreateNote: (event: React.FormEvent) => void;
  handleEditClick: (note: Note) => void;
  handleDeleteNote: (id: string) => void;
  handleToggleChecklistItem: (
    noteId: string,
    itemId: string
  ) => void;
  handleShareNoteExternally: (id: string) => void;
  triggerToast: (
    msg: string,
    type?: 'success' | 'error' | 'info' | 'warning'
  ) => void;
}

const getNoteLastEditor = (note: Note) =>
  note.auditLogs[note.auditLogs.length - 1]?.user;

export function PerfilTab({
  notes,
  setShowSharedNotesModal,
  showAddNoteForm,
  setShowAddNoteForm,
  editingNoteId,
  setEditingNoteId,
  newNoteTitle,
  setNewNoteTitle,
  newNoteContent,
  setNewNoteContent,
  newNoteChecklist,
  setNewNoteChecklist,
  selectedFriendsForNote,
  setSelectedFriendsForNote,
  setShowUserSearchModal,
  newNoteMediaUrls,
  setNewNoteMediaUrls,
  newNoteReminderDateTime,
  setNewNoteReminderDateTime,
  newNoteIsPublishedToFeed,
  setNewNoteIsPublishedToFeed,
  isUploading,
  uploadProgress,
  handleSimulatedUpload,
  handleCreateNote,
  handleEditClick,
  handleDeleteNote,
  handleToggleChecklistItem,
  handleShareNoteExternally,
  triggerToast,
}: PerfilTabProps) {
  const [showReminderControl, setShowReminderControl] =
    useState(false);

  useEffect(() => {
    if (newNoteReminderDateTime) {
      setShowReminderControl(true);
    }
  }, [newNoteReminderDateTime]);

  const clearComposer = () => {
    setEditingNoteId(null);
    setNewNoteTitle('');
    setNewNoteContent('');
    setNewNoteChecklist('');
    setSelectedFriendsForNote([]);
    setNewNoteMediaUrls([]);
    setNewNoteReminderDateTime('');
    setNewNoteIsPublishedToFeed(false);
    setShowReminderControl(false);
  };

  const toggleComposer = () => {
    if (showAddNoteForm) clearComposer();
    setShowAddNoteForm(!showAddNoteForm);
  };

  const sharedNotesCount = notes.filter(
    note => getNoteLastEditor(note) !== 'Você'
  ).length;

  return (
    <div
      className="space-y-6 animate-fade-in"
      id="perfil-tab-container"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-black uppercase text-white">
          Meu dia
        </h2>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowSharedNotesModal(true)}
            className="relative flex h-9 w-9 items-center justify-center rounded-xl border border-slate-800 bg-slate-900 text-teal-400 transition-all hover:text-teal-300"
            title="Notas compartilhadas comigo"
            aria-label="Abrir notas compartilhadas comigo"
            id="btn-notas-compartilhadas"
          >
            <Users className="h-4 w-4" />
            {sharedNotesCount > 0 && (
              <span className="absolute -right-1 -top-1 rounded-full bg-teal-500 px-1 text-[8px] font-bold font-mono text-slate-950">
                {sharedNotesCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={toggleComposer}
            className="flex min-h-9 items-center gap-1 rounded-xl bg-teal-500 px-3 py-1.5 text-xs font-bold text-slate-950 transition-all hover:bg-teal-400"
          >
            {showAddNoteForm ? (
              <X className="h-3.5 w-3.5" />
            ) : (
              <Plus className="h-3.5 w-3.5" />
            )}
            <span>
              {editingNoteId ? 'Editando' : 'Nova nota'}
            </span>
          </button>
        </div>
      </div>

      {showAddNoteForm && (
        <form
          onSubmit={handleCreateNote}
          className="space-y-4 rounded-3xl border border-slate-800 bg-slate-900 p-5"
        >
          <div className="flex items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
            <h3 className="min-w-0 truncate text-xs font-bold font-mono uppercase text-slate-300">
              {editingNoteId
                ? 'Editar nota / checklist'
                : 'Criar nota / checklist'}
            </h3>

            <div
              className="flex shrink-0 items-center gap-1.5"
              aria-label="Ferramentas da nota"
            >
              <button
                type="button"
                onClick={() => setShowUserSearchModal(true)}
                className={`relative flex h-9 w-9 items-center justify-center rounded-xl border transition-all ${
                  selectedFriendsForNote.length > 0
                    ? 'border-teal-500/40 bg-teal-500/15 text-teal-300'
                    : 'border-slate-800 bg-slate-950 text-slate-400 hover:text-teal-300'
                }`}
                title="Buscar colaboradores"
                aria-label="Buscar colaboradores"
                id="btn-add-usuario-link"
              >
                <UserPlus className="h-4 w-4" />
                {selectedFriendsForNote.length > 0 && (
                  <span className="absolute -right-1 -top-1 rounded-full bg-teal-500 px-1 text-[8px] font-black text-slate-950">
                    {selectedFriendsForNote.length}
                  </span>
                )}
              </button>

              <label
                className={`relative flex h-9 w-9 cursor-pointer items-center justify-center rounded-xl border transition-all ${
                  newNoteMediaUrls.length > 0
                    ? 'border-orange-500/40 bg-orange-500/15 text-orange-300'
                    : 'border-slate-800 bg-slate-950 text-slate-400 hover:text-orange-300'
                }`}
                title="Adicionar mídia"
                aria-label="Adicionar mídia"
              >
                <Camera className="h-4 w-4" />
                {newNoteMediaUrls.length > 0 && (
                  <span className="absolute -right-1 -top-1 rounded-full bg-orange-500 px-1 text-[8px] font-black text-slate-950">
                    {newNoteMediaUrls.length}
                  </span>
                )}
                <input
                  type="file"
                  multiple
                  accept="image/*,video/*"
                  className="hidden"
                  onChange={handleSimulatedUpload}
                  disabled={isUploading}
                />
              </label>

              <button
                type="button"
                onClick={() =>
                  setShowReminderControl(previous => !previous)
                }
                className={`flex h-9 w-9 items-center justify-center rounded-xl border transition-all ${
                  newNoteReminderDateTime
                    ? 'border-orange-500/40 bg-orange-500/15 text-orange-300'
                    : 'border-slate-800 bg-slate-950 text-slate-400 hover:text-orange-300'
                }`}
                title="Agendar lembrete"
                aria-label="Agendar lembrete"
              >
                <Bell className="h-4 w-4" />
              </button>

              <button
                type="button"
                onClick={() =>
                  setNewNoteIsPublishedToFeed(
                    !newNoteIsPublishedToFeed
                  )
                }
                className={`flex h-9 w-9 items-center justify-center rounded-xl border transition-all ${
                  newNoteIsPublishedToFeed
                    ? 'border-teal-500/40 bg-teal-500/15 text-teal-300'
                    : 'border-slate-800 bg-slate-950 text-slate-400 hover:text-teal-300'
                }`}
                title={
                  newNoteIsPublishedToFeed
                    ? 'Publicação automática no feed ativada'
                    : 'Publicar automaticamente no feed'
                }
                aria-pressed={newNoteIsPublishedToFeed}
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="space-y-3">
            <input
              type="text"
              placeholder="Título da nota"
              value={newNoteTitle}
              onChange={event =>
                setNewNoteTitle(event.target.value)
              }
              className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-xs text-white focus:border-teal-500/50 focus:outline-none"
              required
            />

            <textarea
              placeholder="Conteúdo descritivo..."
              value={newNoteContent}
              onChange={event =>
                setNewNoteContent(event.target.value)
              }
              rows={3}
              className="w-full resize-y rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-xs text-white focus:border-teal-500/50 focus:outline-none"
              required
            />

            <input
              type="text"
              placeholder="Checklist (separe os itens por vírgula)"
              value={newNoteChecklist}
              onChange={event =>
                setNewNoteChecklist(event.target.value)
              }
              className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-xs text-white focus:border-teal-500/50 focus:outline-none"
            />
          </div>

          {showReminderControl && (
            <div className="flex items-center gap-2 rounded-2xl border border-orange-500/20 bg-orange-500/5 p-2.5">
              <Bell className="h-4 w-4 shrink-0 text-orange-400" />
              <input
                type="datetime-local"
                value={newNoteReminderDateTime}
                onChange={event => {
                  setNewNoteReminderDateTime(event.target.value);
                  if (event.target.value) {
                    triggerToast(
                      `Lembrete agendado para ${new Date(
                        event.target.value
                      ).toLocaleString('pt-BR')}.`,
                      'success'
                    );
                  }
                }}
                className="min-w-0 flex-1 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-200 focus:border-orange-500/50 focus:outline-none"
                title="Data e hora do lembrete"
              />
              {newNoteReminderDateTime && (
                <button
                  type="button"
                  onClick={() => {
                    setNewNoteReminderDateTime('');
                    triggerToast('Lembrete removido.', 'info');
                  }}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-red-400 hover:bg-red-500/10"
                  aria-label="Remover lembrete"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          )}

          {selectedFriendsForNote.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {selectedFriendsForNote.map(name => (
                <button
                  type="button"
                  key={name}
                  onClick={() => {
                    setSelectedFriendsForNote(previous =>
                      previous.filter(
                        selectedName => selectedName !== name
                      )
                    );
                    triggerToast(`${name} removido.`, 'info');
                  }}
                  className="flex items-center gap-1 rounded-lg border border-teal-500/30 bg-teal-500/10 px-2 py-1 text-[10px] font-mono text-teal-300 transition-all hover:border-red-500/30 hover:bg-red-500/10 hover:text-red-300"
                  title={`Remover ${name}`}
                >
                  <span>{name}</span>
                  <X className="h-3 w-3" />
                </button>
              ))}
            </div>
          )}

          {isUploading && (
            <div className="space-y-1.5 rounded-xl border border-slate-800 bg-slate-950 p-2.5">
              <div className="flex justify-between text-[10px] font-mono">
                <span className="text-orange-300">
                  Preparando anexos...
                </span>
                <span className="font-bold text-slate-400">
                  {uploadProgress}%
                </span>
              </div>
              <div className="h-1 overflow-hidden rounded-full bg-slate-900">
                <div
                  className="h-full bg-orange-500 transition-all"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            </div>
          )}

          {newNoteMediaUrls.length > 0 && (
            <div className="space-y-2">
              <span className="block text-[9px] font-mono uppercase text-slate-500">
                Anexos ({newNoteMediaUrls.length}/9)
              </span>
              <div className="grid grid-cols-5 gap-2 rounded-2xl border border-slate-800 bg-slate-950 p-2">
                {newNoteMediaUrls.map((url, index) => (
                  <div
                    key={`${url.slice(0, 24)}-${index}`}
                    className="group relative aspect-square overflow-hidden rounded-lg border border-slate-800 bg-slate-900"
                  >
                    {url.startsWith('data:video') ||
                    url.endsWith('.mp4') ? (
                      <div className="flex h-full w-full items-center justify-center text-orange-300">
                        <Camera className="h-4 w-4" />
                      </div>
                    ) : (
                      <img
                        src={url}
                        alt={`Anexo ${index + 1}`}
                        className="h-full w-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                    )}
                    <button
                      type="button"
                      onClick={() =>
                        setNewNoteMediaUrls(previous =>
                          previous.filter(
                            (_, mediaIndex) =>
                              mediaIndex !== index
                          )
                        )
                      }
                      className="absolute right-0 top-0 flex h-5 w-5 items-center justify-center rounded-bl-lg bg-red-600 text-white"
                      aria-label={`Remover anexo ${index + 1}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 text-[9px] font-mono">
            <span
              className={`rounded-lg border px-2 py-1 ${
                newNoteIsPublishedToFeed
                  ? 'border-teal-500/30 bg-teal-500/10 text-teal-300'
                  : 'border-slate-800 bg-slate-950 text-slate-500'
              }`}
            >
              {newNoteIsPublishedToFeed
                ? 'Feed ativado'
                : 'Nota privada'}
            </span>
            {newNoteReminderDateTime && (
              <span className="rounded-lg border border-orange-500/30 bg-orange-500/10 px-2 py-1 text-orange-300">
                Lembrete ativo
              </span>
            )}
          </div>

          <button
            type="submit"
            className="w-full rounded-xl bg-orange-600 py-2.5 text-xs font-bold uppercase text-white transition-all hover:bg-orange-500"
          >
            {editingNoteId
              ? 'Atualizar nota de trabalho'
              : 'Salvar nota de trabalho'}
          </button>
        </form>
      )}

      {notes.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-slate-800 bg-slate-900/40 px-5 py-10 text-center">
          <h3 className="text-sm font-black uppercase text-slate-200">
            Seu dia começa aqui
          </h3>
          <p className="mt-2 text-xs leading-relaxed text-slate-500">
            Crie uma nota, monte um checklist e adicione
            colaboradores quando precisar trabalhar em conjunto.
          </p>
        </div>
      ) : (
        <div
          className="grid grid-cols-2 gap-3.5"
          id="notes-grid"
        >
          {notes.map(note => (
            <article
              key={note.id}
              className="flex min-w-0 flex-col justify-between space-y-3 rounded-2xl border border-slate-800/80 bg-slate-900 p-4"
            >
              <div className="min-w-0">
                <h3 className="truncate text-xs font-black uppercase tracking-wide text-white">
                  {note.title}
                </h3>
                <p className="mt-1.5 text-[11px] leading-relaxed text-slate-400">
                  {note.content}
                </p>

                {note.mediaUrls &&
                  note.mediaUrls.length > 0 && (
                    <div className="mt-2.5 grid grid-cols-3 gap-1 rounded-xl border border-slate-800/60 bg-slate-950 p-1">
                      {note.mediaUrls
                        .slice(0, 3)
                        .map((url, index) => (
                          <div
                            key={`${note.id}-${index}`}
                            className="relative aspect-square overflow-hidden rounded-lg border border-slate-800"
                          >
                            {url.startsWith('data:video') ||
                            url.endsWith('.mp4') ? (
                              <div className="flex h-full w-full items-center justify-center text-orange-300">
                                <Camera className="h-3.5 w-3.5" />
                              </div>
                            ) : (
                              <img
                                src={url}
                                alt=""
                                className="h-full w-full object-cover"
                                referrerPolicy="no-referrer"
                              />
                            )}
                            {note.mediaUrls!.length > 3 &&
                              index === 2 && (
                                <div className="absolute inset-0 flex items-center justify-center bg-black/75 text-[9px] font-bold text-white">
                                  +{note.mediaUrls!.length - 3}
                                </div>
                              )}
                          </div>
                        ))}
                    </div>
                  )}

                {note.reminderDateTime && (
                  <div className="mt-2.5 flex items-center gap-1.5 rounded-xl border border-orange-500/20 bg-orange-950/40 px-2.5 py-1.5 text-orange-300">
                    <Clock className="h-3.5 w-3.5" />
                    <span className="text-[9px] font-bold font-mono">
                      {new Date(
                        note.reminderDateTime
                      ).toLocaleString('pt-BR', {
                        day: '2-digit',
                        month: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                )}

                {note.checklist.length > 0 && (
                  <div className="mt-3.5 space-y-2 border-t border-slate-800/60 pt-3">
                    <span className="block text-[9px] font-mono uppercase text-slate-500">
                      Checklist
                    </span>
                    {note.checklist.map(item => (
                      <label
                        key={item.id}
                        className="flex cursor-pointer items-start gap-1.5 text-[10px] text-slate-300"
                      >
                        <input
                          type="checkbox"
                          checked={item.done}
                          onChange={() =>
                            handleToggleChecklistItem(
                              note.id,
                              item.id
                            )
                          }
                          className="mt-0.5 accent-teal-500"
                        />
                        <span
                          className={
                            item.done
                              ? 'text-slate-500 line-through'
                              : ''
                          }
                        >
                          {item.text}
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-2 border-t border-slate-800/60 pt-3">
                {note.associatedUsers.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1">
                    <Users className="h-3 w-3 text-slate-500" />
                    {note.associatedUsers.map(user => (
                      <span
                        key={`${note.id}-${user}`}
                        className="rounded border border-slate-800 bg-slate-950 px-1.5 py-0.5 text-[9px] text-slate-400"
                      >
                        {user}
                      </span>
                    ))}
                  </div>
                )}

                <div className="rounded-lg border border-slate-800 bg-slate-950 p-2 text-[9px] font-mono text-slate-500">
                  <span className="block text-[8px] font-bold uppercase text-orange-400">
                    Última alteração
                  </span>
                  {note.auditLogs.slice(0, 1).map(log => (
                    <p
                      key={`${note.id}-${log.timestamp}`}
                      className="truncate"
                    >
                      {log.user}:{' '}
                      <span className="text-slate-300">
                        {log.action}
                      </span>
                    </p>
                  ))}
                </div>

                <div
                  className="flex items-center justify-between border-t border-slate-800/40 pt-3"
                  id={`note-footer-${note.id}`}
                >
                  {note.shared ? (
                    <div className="flex items-center gap-1 text-[10px] font-bold font-mono text-emerald-400">
                      <Check className="h-3.5 w-3.5" />
                      <span>Compartilhado</span>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() =>
                        handleShareNoteExternally(note.id)
                      }
                      className="flex items-center gap-1 text-[10px] font-bold font-mono text-teal-400 transition-all hover:text-teal-300"
                      title="Publicar nota no feed"
                      id={`btn-share-note-${note.id}`}
                    >
                      <Share2 className="h-3 w-3" />
                      <span>Compartilhar</span>
                    </button>
                  )}

                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleEditClick(note)}
                      className="p-1 text-slate-400 transition-all hover:text-teal-400"
                      title="Editar nota"
                      id={`btn-edit-note-${note.id}`}
                    >
                      <Edit className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        handleDeleteNote(note.id)
                      }
                      className="p-1 text-slate-400 transition-all hover:text-red-400"
                      title="Excluir nota"
                      id={`btn-delete-note-${note.id}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
