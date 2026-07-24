import React, { useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import {
  arrayRemove,
  arrayUnion,
  collectionGroup,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  Check,
  CheckCircle2,
  Clock3,
  RefreshCw,
  UserRoundCheck,
  UserRoundX,
  Users,
  X,
} from 'lucide-react';
import { Note } from '../../types';
import { auth, db } from '../../utils/firebase';
import {
  createAuditLog,
  formatNoteAuditTimestamp,
  normalizeCloudNote,
  sortNotesByUpdatedAt,
} from '../../utils/noteCollaboration';

interface SharedNotesModalProps {
  isOpen: boolean;
  onClose: () => void;
  notes: Note[];
  handleToggleChecklistItem: (noteId: string, itemId: string) => void;
}

type SharedView = 'requests' | 'participating';

const getCurrentUserName = (): string =>
  auth.currentUser?.displayName?.trim() ||
  auth.currentUser?.email ||
  'Você';

export const SharedNotesModal: React.FC<SharedNotesModalProps> = ({
  isOpen,
  onClose,
  notes: _legacyNotes,
  handleToggleChecklistItem: _legacyToggleChecklistItem,
}) => {
  const [sharedNotes, setSharedNotes] = useState<Note[]>([]);
  const [activeView, setActiveView] = useState<SharedView>('requests');
  const [isLoading, setIsLoading] = useState(false);
  const [syncError, setSyncError] = useState('');
  const [busyNoteId, setBusyNoteId] = useState('');

  useEffect(() => {
    if (!isOpen) return;

    let unsubscribeSharedNotes = () => undefined;

    const unsubscribeAuth = onAuthStateChanged(auth, user => {
      unsubscribeSharedNotes();
      setSyncError('');

      if (!user) {
        setSharedNotes([]);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      const sharedTasksQuery = query(
        collectionGroup(db, 'tasks'),
        where('sharedWith', 'array-contains', user.uid)
      );

      unsubscribeSharedNotes = onSnapshot(
        sharedTasksQuery,
        { includeMetadataChanges: true },
        snapshot => {
          const notes = snapshot.docs
            .map(snapshotDocument => {
              const ownerId = snapshotDocument.ref.parent.parent?.id ?? '';
              return {
                ...normalizeCloudNote(
                  snapshotDocument.id,
                  snapshotDocument.data() as Record<string, unknown>,
                  ownerId
                ),
                syncState: snapshotDocument.metadata.hasPendingWrites
                  ? 'pending' as const
                  : 'synced' as const,
              };
            })
            .filter(note => note.ownerId !== user.uid);

          setSharedNotes(sortNotesByUpdatedAt(notes));
          setIsLoading(false);
        },
        error => {
          console.warn('Não foi possível carregar as notas compartilhadas.', error);
          setSyncError(
            'Não foi possível atualizar as solicitações agora. Os dados já armazenados continuarão disponíveis offline.'
          );
          setIsLoading(false);
        }
      );
    });

    return () => {
      unsubscribeAuth();
      unsubscribeSharedNotes();
    };
  }, [isOpen]);

  const currentUserId = auth.currentUser?.uid ?? '';
  const pendingNotes = useMemo(
    () => sharedNotes.filter(note => !(note.acceptedWith ?? []).includes(currentUserId)),
    [currentUserId, sharedNotes]
  );
  const participatingNotes = useMemo(
    () => sharedNotes.filter(note => (note.acceptedWith ?? []).includes(currentUserId)),
    [currentUserId, sharedNotes]
  );

  useEffect(() => {
    if (pendingNotes.length === 0 && participatingNotes.length > 0) {
      setActiveView('participating');
    }
  }, [participatingNotes.length, pendingNotes.length]);

  if (!isOpen) return null;

  const updateSharedNote = async (
    note: Note,
    changes: Record<string, unknown>
  ): Promise<void> => {
    if (!note.ownerId || !auth.currentUser) return;

    setBusyNoteId(note.id);
    try {
      await updateDoc(
        doc(db, 'users', note.ownerId, 'tasks', note.id),
        {
          ...changes,
          updatedAtIso: new Date().toISOString(),
          serverUpdatedAt: serverTimestamp(),
        }
      );
    } finally {
      setBusyNoteId('');
    }
  };

  const handleAccept = async (note: Note) => {
    const user = auth.currentUser;
    if (!user) return;
    const now = new Date().toISOString();

    try {
      await updateSharedNote(note, {
        acceptedWith: arrayUnion(user.uid),
        auditLogs: [
          createAuditLog(
            getCurrentUserName(),
            'Aceitou o convite para colaborar na nota',
            user.uid,
            now
          ),
          ...note.auditLogs,
        ],
      });
      setActiveView('participating');
    } catch (error) {
      console.warn('Falha ao aceitar colaboração.', error);
      setSyncError(
        'A aceitação não pôde ser confirmada agora. Tente novamente quando a conexão estiver disponível.'
      );
    }
  };

  const handleDecline = async (note: Note) => {
    const user = auth.currentUser;
    if (!user) return;

    try {
      await updateSharedNote(note, {
        sharedWith: arrayRemove(user.uid),
        acceptedWith: arrayRemove(user.uid),
        auditLogs: [
          createAuditLog(
            getCurrentUserName(),
            'Recusou o convite para colaborar na nota',
            user.uid
          ),
          ...note.auditLogs,
        ],
      });
    } catch (error) {
      console.warn('Falha ao recusar colaboração.', error);
      setSyncError('Não foi possível recusar o convite agora.');
    }
  };

  const handleToggleSharedChecklist = async (
    note: Note,
    itemId: string
  ) => {
    const user = auth.currentUser;
    if (!user || !(note.acceptedWith ?? []).includes(user.uid)) return;

    const toggledItem = note.checklist.find(item => item.id === itemId);
    const checklist = note.checklist.map(item =>
      item.id === itemId ? { ...item, done: !item.done } : item
    );
    const now = new Date().toISOString();

    try {
      await updateSharedNote(note, {
        checklist,
        auditLogs: [
          createAuditLog(
            getCurrentUserName(),
            toggledItem
              ? `Marcou "${toggledItem.text}" como ${
                  toggledItem.done ? 'PENDENTE' : 'CONCLUÍDO'
                }`
              : 'Alterou item do checklist compartilhado',
            user.uid,
            now
          ),
          ...note.auditLogs,
        ],
      });
    } catch (error) {
      console.warn('Falha ao atualizar checklist compartilhado.', error);
      setSyncError(
        'A alteração ficou pendente. Ela será reenviada quando a conexão estiver disponível.'
      );
    }
  };

  const visibleNotes = activeView === 'requests' ? pendingNotes : participatingNotes;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm animate-fade-in"
      id="modal-notas-compartilhadas"
    >
      <div className="relative max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-3xl border border-slate-800 bg-slate-900 p-5 shadow-2xl animate-scale-up">
        <div className="sticky top-0 z-10 -mx-1 mb-4 flex items-center justify-between border-b border-slate-800 bg-slate-900/95 px-1 pb-3 backdrop-blur">
          <div className="min-w-0">
            <h3 className="flex items-center gap-2 text-base font-black text-white">
              <Users className="h-5 w-5 shrink-0 text-teal-400" />
              <span className="truncate">Notas compartilhadas comigo</span>
            </h3>
            <p className="mt-1 text-[10px] text-slate-500">
              Convites e notas em que você já participa, sincronizados entre dispositivos.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-3 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-950 text-slate-500 hover:text-slate-300"
            aria-label="Fechar notas compartilhadas"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-2 rounded-2xl border border-slate-800 bg-slate-950 p-1.5">
          <button
            type="button"
            onClick={() => setActiveView('requests')}
            className={`rounded-xl px-3 py-2 text-[10px] font-black uppercase transition-all ${
              activeView === 'requests'
                ? 'bg-orange-500 text-slate-950'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            Solicitações ({pendingNotes.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveView('participating')}
            className={`rounded-xl px-3 py-2 text-[10px] font-black uppercase transition-all ${
              activeView === 'participating'
                ? 'bg-teal-500 text-slate-950'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            Participando ({participatingNotes.length})
          </button>
        </div>

        {syncError && (
          <div className="mb-4 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-[10px] leading-relaxed text-amber-300">
            {syncError}
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-xs text-slate-500">
            <RefreshCw className="h-4 w-4 animate-spin" />
            Atualizando notas compartilhadas...
          </div>
        ) : visibleNotes.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-950/60 px-5 py-10 text-center">
            <Users className="mx-auto h-7 w-7 text-slate-700" />
            <p className="mt-3 text-xs italic text-slate-500">
              {activeView === 'requests'
                ? 'Nenhuma solicitação de colaboração no momento.'
                : 'Você ainda não participa de nenhuma nota compartilhada.'}
            </p>
          </div>
        ) : (
          <div className="space-y-3.5">
            {visibleNotes.map(note => {
              const latestLog = note.auditLogs[0];
              const isBusy = busyNoteId === note.id;

              return (
                <article
                  key={`${note.ownerId}-${note.id}`}
                  className="space-y-3 rounded-2xl border border-slate-800 bg-slate-950 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <span className="block truncate text-[9px] font-bold font-mono uppercase text-orange-400">
                        {activeView === 'requests' ? 'Convite de' : 'Criada por'}: {note.ownerName || 'Usuário Kyrub'}
                      </span>
                      <h4 className="mt-0.5 truncate text-sm font-black uppercase text-white">
                        {note.title}
                      </h4>
                    </div>
                    <span className={`shrink-0 rounded-full border px-2 py-1 text-[8px] font-bold font-mono uppercase ${
                      note.syncState === 'pending'
                        ? 'border-amber-500/20 bg-amber-500/10 text-amber-300'
                        : 'border-teal-500/20 bg-teal-500/10 text-teal-300'
                    }`}>
                      {note.syncState === 'pending' ? 'Sincronizando' : 'Na nuvem'}
                    </span>
                  </div>

                  <p className="text-xs leading-relaxed text-slate-300">
                    {note.content}
                  </p>

                  {activeView === 'participating' && note.checklist.length > 0 && (
                    <div className="space-y-2 border-t border-slate-900 pt-3">
                      <span className="block text-[9px] font-mono uppercase text-slate-500">
                        Checklist compartilhado
                      </span>
                      {note.checklist.map(item => (
                        <label
                          key={item.id}
                          className="flex cursor-pointer items-start gap-2 text-xs text-slate-300"
                        >
                          <input
                            type="checkbox"
                            checked={item.done}
                            disabled={isBusy}
                            onChange={() => handleToggleSharedChecklist(note, item.id)}
                            className="mt-0.5 accent-teal-500"
                          />
                          <span className={item.done ? 'text-slate-500 line-through' : ''}>
                            {item.text}
                          </span>
                        </label>
                      ))}
                    </div>
                  )}

                  {latestLog && (
                    <div className="rounded-xl border border-slate-900 bg-slate-900/60 p-2.5 text-[9px] font-mono text-slate-500">
                      <div className="flex items-center gap-1.5 text-orange-400">
                        <Clock3 className="h-3 w-3" />
                        <span className="font-bold uppercase">Última alteração</span>
                      </div>
                      <p className="mt-1 text-slate-400">
                        <span className="text-slate-300">{latestLog.user}</span>: {latestLog.action}
                      </p>
                      <span className="mt-1 block text-[8px] text-slate-600">
                        {formatNoteAuditTimestamp(latestLog.timestamp)}
                      </span>
                    </div>
                  )}

                  {activeView === 'requests' ? (
                    <div className="grid grid-cols-2 gap-2 border-t border-slate-900 pt-3">
                      <button
                        type="button"
                        onClick={() => handleDecline(note)}
                        disabled={isBusy}
                        className="flex items-center justify-center gap-1.5 rounded-xl border border-red-500/25 bg-red-500/10 py-2 text-[10px] font-bold uppercase text-red-300 disabled:opacity-50"
                      >
                        <UserRoundX className="h-3.5 w-3.5" />
                        Recusar
                      </button>
                      <button
                        type="button"
                        onClick={() => handleAccept(note)}
                        disabled={isBusy}
                        className="flex items-center justify-center gap-1.5 rounded-xl bg-teal-500 py-2 text-[10px] font-black uppercase text-slate-950 disabled:opacity-50"
                      >
                        <UserRoundCheck className="h-3.5 w-3.5" />
                        Aceitar
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between border-t border-slate-900 pt-3 text-[9px] font-mono text-slate-500">
                      <span className="flex min-w-0 items-center gap-1.5 truncate">
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-teal-400" />
                        Participação ativa
                      </span>
                      <span className="flex items-center gap-1 text-slate-600">
                        <Check className="h-3 w-3" />
                        {note.checklist.filter(item => item.done).length}/{note.checklist.length}
                      </span>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}

        <button
          type="button"
          onClick={onClose}
          className="mt-5 w-full rounded-xl bg-slate-800 py-2.5 text-xs font-bold uppercase tracking-wider text-slate-300 transition-all hover:bg-slate-700"
        >
          Fechar painel
        </button>
      </div>
    </div>
  );
};
