import React from 'react';
import { Users } from 'lucide-react';
import { Note } from '../../types';

interface SharedNotesModalProps {
  isOpen: boolean;
  onClose: () => void;
  notes: Note[];
  handleToggleChecklistItem: (noteId: string, itemId: string) => void;
}

export const SharedNotesModal: React.FC<SharedNotesModalProps> = ({
  isOpen,
  onClose,
  notes,
  handleToggleChecklistItem
}) => {
  if (!isOpen) return null;

  const sharedNotes = notes.filter(note => note.auditLogs[note.auditLogs.length - 1]?.user !== 'Você');

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in" id="modal-notas-compartilhadas">
      <div className="bg-slate-900 border border-slate-800 w-full max-w-md p-6 rounded-3xl shadow-2xl relative space-y-4 max-h-[85vh] overflow-y-auto animate-scale-up">
        <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
          <h3 className="text-base font-black text-white flex items-center gap-2">
            <Users className="w-5 h-5 text-teal-400" />
            <span>Notas Compartilhadas Comigo</span>
          </h3>
          <button 
            onClick={onClose}
            className="text-slate-500 hover:text-slate-300 font-bold bg-slate-950 w-7 h-7 rounded-full flex items-center justify-center text-xs"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4">
          {sharedNotes.length === 0 ? (
            <div className="text-center py-8 text-slate-500 text-xs italic">
              Nenhuma nota compartilhada com você no momento.
            </div>
          ) : (
            <div className="space-y-3.5">
              {sharedNotes.map(note => {
                const creator = note.auditLogs[note.auditLogs.length - 1]?.user || 'Outro Usuário';
                return (
                  <div key={note.id} className="bg-slate-950 border border-slate-800 p-4 rounded-2xl space-y-3">
                    <div className="flex justify-between items-start">
                      <div>
                        <span className="text-[9px] font-mono text-orange-400 uppercase font-bold">Criada por: {creator}</span>
                        <h4 className="text-sm font-black text-white uppercase mt-0.5">{note.title}</h4>
                      </div>
                      <span className="text-[9px] bg-slate-900 px-2 py-0.5 rounded text-slate-400 border border-slate-800 font-mono">
                        ID: {note.id}
                      </span>
                    </div>

                    <p className="text-xs text-slate-300 leading-relaxed">{note.content}</p>

                    {note.checklist.length > 0 && (
                      <div className="space-y-2 pt-2 border-t border-slate-900">
                        <span className="text-[9px] font-mono uppercase text-slate-500 block">Checklist Compartilhado</span>
                        <div className="space-y-1.5">
                          {note.checklist.map(item => (
                            <label key={item.id} className="flex items-start gap-2 cursor-pointer text-xs text-slate-300">
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
                      </div>
                    )}

                    <div className="flex justify-between items-center text-[9px] font-mono text-slate-500 pt-2 border-t border-slate-900">
                      <span className="truncate max-w-[70%]">Membros: {note.associatedUsers.join(', ')}</span>
                      <span>Auditada: {note.auditLogs[0]?.timestamp.split(', ')[1] || 'Recente'}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="pt-2">
          <button
            onClick={onClose}
            className="w-full bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold py-2.5 rounded-xl text-xs transition-all uppercase tracking-wider"
          >
            Fechar Painel
          </button>
        </div>
      </div>
    </div>
  );
};
