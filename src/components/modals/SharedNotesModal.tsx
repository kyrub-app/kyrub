import React, { useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import {
  arrayRemove,
  arrayUnion,
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  where,
  writeBatch,
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
} from '../../utils/noteCollaboration';

interface SharedNotesModalProps {
  isOpen: boolean;
  onClose: () => void;
  notes: Note[];
  handleToggleChecklistItem: (noteId: string, itemId: string) => void;
}

type SharedView = 'requests' | 'participating';
type InvitationStatus = 'pending' | 'accepted' | 'declined' | 'revoked';

interface NoteInvitation {
  id: string;
  ownerId: string;
  ownerName: string;
  ownerEmail: string;
  recipientId: string;
  noteId: string;
  sourcePath: string;
  status: InvitationStatus;
}

interface SharedNoteRecord {
  invitation: NoteInvitation;
  note: Note | null;
}

const readString = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const readInvitationStatus = (value: unknown): InvitationStatus =>
  value === 'accepted' ||
  value === 'declined' ||
  value === 'revoked'
    ? value
    : 'pending';

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
  const [invitations, setInvitations] = useState<NoteInvitation[]>([]);
  const [notesByInvitationId, setNotesByInvitationId] = useState<
    Record<string, Note | null>
  >({});
  const [activeView, setActiveView] = useState<SharedView>('requests');
  const [isLoading, setIsLoading] = useState(false);
  const [syncError, setSyncError] = useState('');
  const [busyInvitationId, setBusyInvitationId] = useState('');

  useEffect(() => {
    if (!isOpen) return;

    let unsubscribeInvitations = () => undefined;

    const unsubscribeAuth = onAuthStateChanged(auth, user => {
      unsubscribeInvitations();
      setSyncError('');
      setNotesByInvitationId({});

      if (!user) {
        setInvitations([]);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      const invitationQuery = query(
        collection(db, 'note_invitations'),
        where('recipientId', '==', user.uid)
      );

      unsubscribeInvitations = onSnapshot(
        invitationQuery,
        { includeMetadataChanges: true },
        snapshot => {
          const nextInvitations = snapshot.docs
            .map(snapshotDocument => {
              const data = snapshotDocument.data() as Record<string, unknown>;
              return {
                id: snapshotDocument.id,
                ownerId: readString(data.ownerId),
                ownerName: readString(data.ownerName) || 'Usuário Kyrub',
                ownerEmail: readString(data.ownerEmail),
                recipientId: readString(data.recipientId),
                noteId: readString(data.noteId),
                sourcePath: readString(data.sourcePath),
                status: readInvitationStatus(data.status),
              } satisfies NoteInvitation;
            })
            .filter(
              invitation =>
                invitation.ownerId &&
                invitation.noteId &&
                invitation.recipientId === user.uid &&
                (invitation.status === 'pending' ||
                  invitation.status === 'accepted')
            );

          setInvitations(nextInvitations);
          setIsLoading(false);
        },
        error => {
          console.warn('Não foi possível carregar os convites de notas.', error);
          setSyncError(
            'Não foi possível atualizar as solicitações agora. Verifique a conexão e tente novamente.'
          );
          setIsLoading(false);
        }
      );
    });

    return () => {
      unsubscribeAuth();
      unsubscribeInvitations();
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || invitations.length === 0) {
      setNotesByInvitationId({});
      return;
    }

    const unsubscribers = invitations.map(invitation =>
      onSnapshot(
        doc(db, 'users', invitation.ownerId, 'tasks', invitation.noteId),
        { includeMetadataChanges: true },
        snapshot => {
          setNotesByInvitationId(previous => ({
            ...previous,
            [invitation.id]: snapshot.exists()
              ? {
                  ...normalizeCloudNote(
                    snapshot.id,
                    snapshot.data() as Record<string, unknown>,
                    invitation.ownerId
                  ),
                  syncState: snapshot.metadata.hasPendingWrites
                    ? 'pending'
                    : 'synced',
                }
              : null,
          }));
        },
        error => {
          console.warn(
            `Não foi possível abrir a nota compartilhada ${invitation.noteId}.`,
            error
          );
          setNotesByInvitationId(previous => ({
            ...previous,
            [invitation.id]: null,
          }));
          setSyncError(
            'Um convite foi encontrado, mas a nota ainda não pôde ser carregada. Aguarde a sincronização do proprietário.'
          );
        }
      )
    );

    return () => {
      unsubscribers.forEach(unsubscribe => unsubscribe());
    };
  }, [invitations, isOpen]);

  const pendingRecords = useMemo<SharedNoteRecord[]>(
    () =>
      invitations
        .filter(invitation => invitation.status === 'pending')
        .map(invitation => ({
          invitation,
          note: notesByInvitationId[invitation.id] ?? null,
        })),
    [invitations, notesByInvitationId]
  );

  const participatingRecords = useMemo<SharedNoteRecord[]>(
    () =>
      invitations
        .filter(invitation => invitation.status === 'accepted')
        .map(invitation => ({
          invitation,
          note: notesByInvitationId[invitation.id] ?? null,
        })),
    [invitations, notesByInvitationId]
  );

  useEffect(() => {
    if (pendingRecords.length === 0 && participatingRecords.length > 0) {
      setActiveView('participating');
    }
  }, [participatingRecords.length, pendingRecords.length]);

  if (!isOpen) return null;

  const commitInvitationResponse = async (
    record: SharedNoteRecord,
    nextStatus: 'accepted' | 'declined'
  ): Promise<void> => {
    const user = auth.currentUser;
    const note = record.note;
    if (!user || !note) return;

    setBusyInvitationId(record.invitation.id);
    setSyncError('');
    const now = new Date().toISOString();
    const batch = writeBatch(db);
    const taskReference = doc(
      db,
      'users',
      record.invitation.ownerId,
      'tasks',
      record.invitation.noteId
    );
    const invitationReference = doc(
      db,
      'note_invitations',
      record.invitation.id
    );
    const action =
      nextStatus === 'accepted'
        ? 'Aceitou o convite para colaborar na nota'
        : 'Recusou o convite para colaborar na nota';

    batch.update(taskReference, {
      ...(nextStatus === 'accepted'
        ? { acceptedWith: arrayUnion(user.uid) }
        : {
            sharedWith: arrayRemove(user.uid),
            acceptedWith: arrayRemove(user.uid),
          }),
      auditLogs: [
        createAuditLog(getCurrentUserName(), action, user.uid, now),
        ...note.auditLogs,
      ],
      updatedAtIso: now,
      serverUpdatedAt: serverTimestamp(),
    });
    batch.update(invitationReference, {
      status: nextStatus,
      respondedAtIso: now,
      updatedAt: serverTimestamp(),
    });

    try {
      await batch.commit();
      if (nextStatus === 'accepted') {
        setActiveView('participating');
      }
    } catch (error) {
      console.warn('Falha ao responder ao convite de nota.', error);
      setSyncError(
        'A resposta não pôde ser confirmada agora. Tente novamente quando a conexão estiver disponível.'
      );
    } finally {
      setBusyInvitationId('');
    }
  };

  const handleToggleSharedChecklist = async (
    record: SharedNoteRecord,
    itemId: string
  ) => {
    const user = auth.currentUser;
    const note = record.note;
    if (!user || !note || record.invitation.status !== 'accepted') return;

    const toggledItem = note.checklist.find(item => item.id === itemId);
    const checklist = note.checklist.map(item =>
      item.id === itemId ? { ...item, done: !item.done } : item
    );
    const now = new Date().toISOString();

    setBusyInvitationId(record.invitation.id);
    setSyncError('');
    try {
      const batch = writeBatch(db);
      batch.update(
        doc(
          db,
          'users',
          record.invitation.ownerId,
          'tasks',
          record.invitation.noteId
        ),
        {
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
          updatedAtIso: now,
          serverUpdatedAt: serverTimestamp(),
        }
      );
      batch.update(doc(db, 'note_invitations', record.invitation.id), {
        noteUpdatedAtIso: now,
        updatedAt: serverTimestamp(),
      });
      await batch.commit();
    } catch (error) {
      console.warn('Falha ao atualizar checklist compartilhado.', error);
      setSyncError(
        'A alteração não pôde ser sincronizada agora. Tente novamente quando houver conexão.'
      );
    } finally {
      setBusyInvitationId('');
    }
  };

  const visibleRecords =
    activeView === 'requests' ? pendingRecords : participatingRecords;

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
              Convites diretos e notas em que você já participa.
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
            Solicitações ({pendingRecords.length})
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
            Participando ({participatingRecords.length})
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
            Atualizando convites...
          </div>
        ) : visibleRecords.length === 0 ? (
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
            {visibleRecords.map(record => {
              const note = record.note;
              const latestLog = note?.auditLogs[0];
              const isBusy = busyInvitationId === record.invitation.id;

              return (
                <article
                  key={record.invitation.id}
                  className="space-y-3 rounded-2xl border border-slate-800 bg-slate-950 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <span className="block truncate text-[9px] font-bold font-mono uppercase text-orange-400">
                        {activeView === 'requests' ? 'Convite de' : 'Criada por'}: {record.invitation.ownerName}
                      </span>
                      <h4 className="mt-0.5 truncate text-sm font-black uppercase text-white">
                        {note?.title || 'Carregando nota...'}
                      </h4>
                    </div>
                    <span className="shrink-0 rounded-full border border-teal-500/20 bg-teal-500/10 px-2 py-1 text-[8px] font-bold font-mono uppercase text-teal-300">
                      Convite direto
                    </span>
                  </div>

                  {note ? (
                    <>
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
                                onChange={() =>
                                  handleToggleSharedChecklist(record, item.id)
                                }
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
                    </>
                  ) : (
                    <div className="flex items-center justify-center gap-2 rounded-xl border border-slate-900 bg-slate-900/50 py-6 text-[10px] text-slate-500">
                      <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                      Sincronizando conteúdo da nota...
                    </div>
                  )}

                  {activeView === 'requests' ? (
                    <div className="grid grid-cols-2 gap-2 border-t border-slate-900 pt-3">
                      <button
                        type="button"
                        onClick={() =>
                          void commitInvitationResponse(record, 'declined')
                        }
                        disabled={isBusy || !note}
                        className="flex items-center justify-center gap-1.5 rounded-xl border border-red-500/25 bg-red-500/10 py-2 text-[10px] font-bold uppercase text-red-300 disabled:opacity-50"
                      >
                        <UserRoundX className="h-3.5 w-3.5" />
                        Recusar
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          void commitInvitationResponse(record, 'accepted')
                        }
                        disabled={isBusy || !note}
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
                        {note
                          ? `${note.checklist.filter(item => item.done).length}/${note.checklist.length}`
                          : '—'}
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
