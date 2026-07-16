import React from 'react';
import { 
  Users, 
  X, 
  Plus, 
  Camera, 
  Bell, 
  Play, 
  Clock, 
  Edit, 
  Trash2, 
  Share2, 
  Check 
} from 'lucide-react';
import { Note } from '../../types';

interface PerfilTabProps {
  // Notes states & methods
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
  setSelectedFriendsForNote: React.Dispatch<React.SetStateAction<string[]>>;
  setShowUserSearchModal: (val: boolean) => void;
  newNoteMediaUrls: string[];
  setNewNoteMediaUrls: React.Dispatch<React.SetStateAction<string[]>>;
  newNoteReminderDateTime: string;
  setNewNoteReminderDateTime: (val: string) => void;
  newNoteIsPublishedToFeed: boolean;
  setNewNoteIsPublishedToFeed: (val: boolean) => void;
  isUploading: boolean;
  uploadProgress: number;
  handleSimulatedUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleCreateNote: (e: React.FormEvent) => void;
  handleEditClick: (note: Note) => void;
  handleDeleteNote: (id: string) => void;
  handleToggleChecklistItem: (noteId: string, itemId: string) => void;
  handleShareNoteExternally: (id: string) => void;
  triggerToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

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
  triggerToast
}: PerfilTabProps) {
  return (
    <div className="space-y-6 animate-fade-in" id="perfil-tab-container">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-black text-white uppercase">Meu Dia</h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowSharedNotesModal(true)}
            className="flex items-center justify-center bg-slate-900 border border-slate-800 text-teal-400 hover:text-teal-300 p-2 rounded-xl text-xs transition-all relative"
            title="Notas Compartilhadas Comigo"
            id="btn-notas-compartilhadas"
          >
            <Users className="w-4 h-4" />
            {notes.filter(n => n.auditLogs[n.auditLogs.length - 1]?.user !== 'Você').length > 0 && (
              <span className="absolute -top-1 -right-1 bg-teal-500 text-slate-950 font-mono text-[8px] font-bold px-1 rounded-full">
                {notes.filter(n => n.auditLogs[n.auditLogs.length - 1]?.user !== 'Você').length}
              </span>
            )}
          </button>
          <button
            onClick={() => {
              if (showAddNoteForm) {
                setEditingNoteId(null);
                setNewNoteTitle('');
                setNewNoteContent('');
                setNewNoteChecklist('');
                setSelectedFriendsForNote([]);
              }
              setShowAddNoteForm(!showAddNoteForm);
            }}
            className="flex items-center gap-1 bg-teal-500 text-slate-950 font-bold px-3 py-1.5 rounded-xl text-xs hover:bg-teal-400 transition-all"
          >
            {showAddNoteForm ? <X className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
            <span>{editingNoteId ? 'Editando' : 'Nova Nota'}</span>
          </button>
        </div>
      </div>

      {/* Form to Create Note */}
      {showAddNoteForm && (
        <form onSubmit={handleCreateNote} className="bg-slate-900 p-5 rounded-3xl border border-slate-800 space-y-4">
          <h3 className="text-xs font-mono uppercase text-slate-300 font-bold">
            {editingNoteId ? 'Editar Nota / Checklist' : 'Criar Nota / Checklist'}
          </h3>
          
          <div className="space-y-3">
            <input
              type="text"
              placeholder="Título da Nota"
              value={newNoteTitle}
              onChange={(e) => setNewNoteTitle(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none"
              required
            />
            <textarea
              placeholder="Conteúdo descritivo..."
              value={newNoteContent}
              onChange={(e) => setNewNoteContent(e.target.value)}
              rows={2}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none"
              required
            />
            <input
              type="text"
              placeholder="Checklist (separe os itens por vírgula)"
              value={newNoteChecklist}
              onChange={(e) => setNewNoteChecklist(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none"
            />

            {/* Share checkbox selection with clickable link and search modal */}
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <button
                  type="button"
                  onClick={() => setShowUserSearchModal(true)}
                  className="text-[10px] text-teal-400 hover:text-teal-300 uppercase font-mono font-bold flex items-center gap-1 hover:underline cursor-pointer"
                  id="btn-add-usuario-link"
                >
                  <span>ADD USUÁRIO</span>
                  <span className="text-[9px] bg-teal-500/10 border border-teal-500/30 text-teal-300 px-1.5 py-0.5 rounded-md font-mono">+ BUSCAR</span>
                </button>
              </div>
              
              <div className="flex flex-wrap gap-1.5">
                {selectedFriendsForNote.length === 0 ? (
                  <span className="text-[10px] text-slate-500 italic font-mono">Nenhum colaborador adicionado</span>
                ) : (
                  selectedFriendsForNote.map(name => (
                    <button
                      type="button"
                      key={name}
                      onClick={() => {
                        setSelectedFriendsForNote(prev => prev.filter(n => n !== name));
                        triggerToast(`${name} removido`, 'info');
                      }}
                      className="px-2 py-0.5 rounded bg-teal-500/10 border border-teal-500/30 text-teal-400 text-[10px] font-mono hover:bg-red-500/10 hover:border-red-500/30 hover:text-red-400 transition-all flex items-center gap-1 cursor-pointer"
                      title="Clique para remover"
                    >
                      <span>{name}</span>
                      <span className="font-bold text-[9px]">✕</span>
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Media Upload, Alarm Settings & Auto-Publish Panel */}
          <div className="bg-slate-950 p-3 rounded-2xl border border-slate-800/80 space-y-3.5">
            <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 font-bold border-b border-slate-800/80 pb-2">
              <span>🛠️ COMPONENTES ADICIONAIS</span>
              <span className="text-[9px] text-teal-400">UPGRADE FIRESTORE</span>
            </div>

            {/* Media Input & Alarm Picker */}
            <div className="flex flex-col sm:flex-row gap-2">
              {/* Media Upload Label */}
              <label className="flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 hover:text-white cursor-pointer hover:bg-slate-800/50 transition-colors text-xs flex-1">
                <Camera className="w-4 h-4 text-orange-400" />
                <span className="font-medium">Adicionar Mídia</span>
                <input
                  type="file"
                  multiple
                  accept="image/*,video/*"
                  className="hidden"
                  onChange={handleSimulatedUpload}
                  disabled={isUploading}
                />
              </label>

              {/* Date Picker Input */}
              <div className="flex-1 relative">
                <div className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-orange-400">
                  <Bell className="w-3.5 h-3.5" />
                </div>
                <input
                  type="datetime-local"
                  value={newNoteReminderDateTime}
                  onChange={(e) => {
                    setNewNoteReminderDateTime(e.target.value);
                    if (e.target.value) {
                      triggerToast(`🔔 Alarme agendado para ${new Date(e.target.value).toLocaleString()}`, 'success');
                    }
                  }}
                  className="w-full bg-slate-900 border border-slate-800 text-slate-200 rounded-xl pl-8 pr-7 py-2 text-xs focus:outline-none focus:border-orange-500/50"
                  title="Agendar Alarme / Notificação"
                />
                {newNoteReminderDateTime && (
                  <button
                    type="button"
                    onClick={() => {
                      setNewNoteReminderDateTime('');
                      triggerToast('Alarme removido', 'info');
                    }}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-red-500 hover:text-red-400 text-xs font-bold"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>

            {/* Storage Simulated Progress Indicator */}
            {isUploading && (
              <div className="space-y-1.5 bg-slate-900/50 p-2.5 rounded-xl border border-slate-800">
                <div className="flex justify-between text-[10px] font-mono">
                  <span className="text-orange-400 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-ping"></span>
                    Enviando para o Storage...
                  </span>
                  <span className="text-slate-400 font-bold">{uploadProgress}%</span>
                </div>
                <div className="w-full bg-slate-950 h-1 rounded-full overflow-hidden">
                  <div
                    className="bg-orange-500 h-full transition-all duration-150"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
                <span className="text-[8px] text-slate-500 block font-mono">
                  Pasta Firebase: <span className="text-slate-400">/users/kyrub-owner/notes/{editingNoteId || 'nova-nota'}/</span>
                </span>
              </div>
            )}

            {/* Previews Row */}
            {newNoteMediaUrls.length > 0 && (
              <div className="space-y-1.5">
                <span className="text-[9px] font-mono uppercase text-slate-500 block">Arquivos Anexados ({newNoteMediaUrls.length})</span>
                <div className="flex flex-wrap gap-2 p-2 bg-slate-900 rounded-xl border border-slate-800/40">
                  {newNoteMediaUrls.map((url, i) => (
                    <div key={i} className="relative w-12 h-12 rounded-lg overflow-hidden border border-slate-800 group">
                      {url.includes('sample/ForBiggerBlazes.mp4') ? (
                        <div className="w-full h-full bg-slate-950 flex flex-col items-center justify-center text-[8px] text-orange-400 font-mono font-bold leading-none p-1 text-center">
                          <Play className="w-3.5 h-3.5 mb-0.5" />
                          VÍDEO
                        </div>
                      ) : (
                        <img src={url} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setNewNoteMediaUrls(prev => prev.filter((_, idx) => idx !== i));
                          triggerToast('Mídia removida', 'info');
                        }}
                        className="absolute top-0 right-0 bg-red-600 hover:bg-red-500 text-white w-4 h-4 rounded-bl flex items-center justify-center text-[9px] font-bold"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Auto-publish selector */}
            <label className="flex items-center gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={newNoteIsPublishedToFeed}
                onChange={(e) => setNewNoteIsPublishedToFeed(e.target.checked)}
                className="w-4 h-4 rounded border-slate-800 bg-slate-950 text-teal-500 focus:ring-teal-500/20"
              />
              <div className="flex flex-col">
                <span className="text-[10px] font-bold text-slate-300">Publicar Automaticamente no Feed Comunitário</span>
                <span className="text-[8px] text-slate-500 font-mono">Simula gravação reativa de gatilho no Firebase</span>
              </div>
            </label>
          </div>

          <button
            type="submit"
            className="w-full py-2.5 bg-orange-600 hover:bg-orange-500 text-white font-bold rounded-xl text-xs uppercase"
          >
            {editingNoteId ? 'Atualizar Nota de Trabalho' : 'Salvar Nota de Trabalho'}
          </button>
        </form>
      )}

      {/* Grid Layout of Notes - 2 Columns on Mobile, responsive */}
      <div className="grid grid-cols-2 gap-3.5" id="notes-grid">
        {notes.map(note => (
          <div key={note.id} className="bg-slate-900 border border-slate-800/80 rounded-2xl p-4 flex flex-col justify-between space-y-3">
            <div>
              <div className="flex justify-between items-start">
                <span className="text-xs font-black text-white tracking-wide uppercase truncate block w-[85%]">
                  {note.title}
                </span>
              </div>
              <p className="text-slate-400 text-[11px] mt-1.5 leading-relaxed">{note.content}</p>

              {/* Attached Media Small Gallery */}
              {note.mediaUrls && note.mediaUrls.length > 0 && (
                <div className="mt-2.5 grid grid-cols-3 gap-1 p-1 bg-slate-950 rounded-xl border border-slate-800/60">
                  {note.mediaUrls.slice(0, 3).map((url, i) => (
                    <div key={i} className="relative aspect-square rounded-lg overflow-hidden border border-slate-800">
                      {url.includes('sample/ForBiggerBlazes.mp4') ? (
                        <div className="w-full h-full bg-slate-900 flex flex-col items-center justify-center text-[7px] text-orange-400 font-mono font-bold leading-none">
                          <Play className="w-2.5 h-2.5 mb-0.5" />
                          VID
                        </div>
                      ) : (
                        <img src={url} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                      )}
                      {note.mediaUrls!.length > 3 && i === 2 && (
                        <div className="absolute inset-0 bg-black/75 backdrop-blur-xs flex items-center justify-center text-[9px] font-bold text-white">
                          +{note.mediaUrls!.length - 3}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Active Scheduled Alarm Badge */}
              {note.reminderDateTime && (
                <div className="mt-2.5 flex items-center justify-between bg-orange-950/40 border border-orange-500/20 px-2.5 py-1.5 rounded-xl">
                  <div className="flex items-center gap-1.5 text-orange-400">
                    <Clock className="w-3.5 h-3.5 animate-pulse" />
                    <span className="text-[9px] font-mono font-bold">
                      {new Date(note.reminderDateTime).toLocaleString('pt-BR', {
                        day: '2-digit',
                        month: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </span>
                  </div>
                  <span className="text-[8px] bg-orange-500 text-slate-950 font-black px-1.5 py-0.5 rounded-md uppercase tracking-wider scale-90">
                    Alarme
                  </span>
                </div>
              )}

              {/* Checklist displaying task execution */}
              {note.checklist.length > 0 && (
                <div className="mt-3.5 space-y-2 border-t border-slate-800/60 pt-3">
                  <span className="text-[9px] font-mono uppercase text-slate-500 block">Checklist de Tarefas</span>
                  {note.checklist.map(item => (
                    <label key={item.id} className="flex items-start gap-1.5 cursor-pointer text-[10px] text-slate-300">
                      <input
                        type="checkbox"
                        checked={item.done}
                        onChange={() => handleToggleChecklistItem(note.id, item.id)}
                        className="mt-0.5 accent-teal-500"
                      />
                      <span className={item.done ? 'line-through text-slate-500' : ''}>{item.text}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-2 border-t border-slate-800/60 pt-3">
              {/* Associated Users / Shared */}
              {note.associatedUsers.length > 0 && (
                <div className="flex flex-wrap gap-1 items-center">
                  <Users className="w-3 h-3 text-slate-500" />
                  {note.associatedUsers.map((user, idx) => (
                    <span key={idx} className="bg-slate-950 px-1.5 py-0.5 rounded text-[9px] text-slate-400 border border-slate-800">
                      {user}
                    </span>
                  ))}
                </div>
              )}

              {/* Audit Log (Last Modification) */}
              <div className="bg-slate-950 p-2 rounded-lg border border-slate-800 text-[9px] font-mono text-slate-500 space-y-1">
                <span className="text-[8px] uppercase font-bold text-orange-400 block">Histórico de Auditoria</span>
                {note.auditLogs.slice(0, 1).map((log, i) => (
                  <p key={i} className="truncate">
                    {log.user}: <span className="text-slate-300">{log.action}</span> - {log.timestamp.split(', ')[1] || log.timestamp}
                  </p>
                ))}
              </div>

              {/* Quick Actions Footer */}
              <div className="flex items-center justify-between border-t border-slate-800/40 pt-3 mt-1.5" id={`note-footer-${note.id}`}>
                {/* Left: Public Share button */}
                <div className="flex items-center">
                  {note.shared ? (
                    <div className="flex items-center gap-1 text-[10px] text-emerald-400 font-mono font-bold animate-fade-in">
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Compartilhado</span>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleShareNoteExternally(note.id)}
                      className="text-[10px] text-teal-400 hover:text-teal-300 font-mono font-bold flex items-center gap-1 hover:underline cursor-pointer transition-all"
                      title="Publicar nota no feed público"
                      id={`btn-share-note-${note.id}`}
                    >
                      <Share2 className="w-3 h-3" />
                      <span>+ Compartilhar</span>
                    </button>
                  )}
                </div>

                {/* Right: Edit & Delete buttons */}
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleEditClick(note)}
                    className="p-1 text-slate-400 hover:text-teal-400 transition-all"
                    title="Editar Nota"
                    id={`btn-edit-note-${note.id}`}
                  >
                    <Edit className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteNote(note.id)}
                    className="p-1 text-slate-400 hover:text-red-400 transition-all"
                    title="Excluir Nota"
                    id={`btn-delete-note-${note.id}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
