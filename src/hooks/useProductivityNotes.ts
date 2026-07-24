import React, { useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, type User as FirebaseUser } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { Note, SocialPost } from '../types';
import { auth, db } from '../utils/firebase';
import {
  createAuditLog,
  encodeNoteCollaborator,
  getNoteUpdatedAt,
  mergeNoteVersions,
  normalizeCloudNote,
  normalizeCollaboratorSelections,
  sanitizeCloudMediaUrls,
  sortNotesByUpdatedAt,
} from '../utils/noteCollaboration';

const getUserNotesKey = (uid: string) => `kyrub_notes_${uid}`;
const MAX_NOTE_ATTACHMENTS = 9;
const MAX_NOTE_ATTACHMENT_BYTES = 4 * 1024 * 1024;

interface UseProductivityNotesOptions {
  profileName: string;
  profilePhotoUrl: string;
  posts: SocialPost[];
  setPosts: React.Dispatch<React.SetStateAction<SocialPost[]>>;
  triggerToast: (
    msg: string,
    type: 'success' | 'error' | 'info' | 'warning'
  ) => void;
  isLoggedIn?: boolean;
}

const readStoredNotes = (rawValue: string | null): Note[] => {
  if (!rawValue) return [];

  try {
    const parsedValue = JSON.parse(rawValue);
    return Array.isArray(parsedValue) ? (parsedValue as Note[]) : [];
  } catch (error) {
    console.warn('Não foi possível ler as notas salvas.', error);
    return [];
  }
};

const fileToDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === 'string'
        ? resolve(reader.result)
        : reject(new Error('Arquivo inválido.'));
    reader.onerror = () =>
      reject(reader.error ?? new Error('Falha ao ler o arquivo.'));
    reader.readAsDataURL(file);
  });

const getOwnerName = (
  user: FirebaseUser,
  profileName: string
): string => user.displayName?.trim() || profileName.trim() || user.email || 'Você';

const normalizeLocalNote = (
  note: Note,
  user: FirebaseUser,
  profileName: string,
  profilePhotoUrl: string
): Note => {
  const ownerName = getOwnerName(user, profileName);
  const createdAt =
    note.createdAt || note.auditLogs[note.auditLogs.length - 1]?.timestamp || new Date().toISOString();
  const updatedAt =
    note.updatedAt || note.auditLogs[0]?.timestamp || createdAt;

  return {
    ...note,
    ownerId: note.ownerId || user.uid,
    ownerName: note.ownerName || ownerName,
    ownerEmail: note.ownerEmail || user.email || '',
    ownerAvatar: note.ownerAvatar || user.photoURL || profilePhotoUrl || '',
    collaborators: note.collaborators ?? [],
    sharedWith: note.sharedWith ?? note.collaborators?.map(item => item.uid).filter(Boolean) ?? [],
    acceptedWith: note.acceptedWith ?? [],
    createdAt,
    updatedAt,
    syncState: note.syncState ?? 'local',
    mediaUrls: note.mediaUrls ?? [],
  };
};

const mapTaskSnapshot = (
  snapshot: QueryDocumentSnapshot<DocumentData>
): Note => {
  const ownerId = snapshot.ref.parent.parent?.id ?? '';
  return {
    ...normalizeCloudNote(
      snapshot.id,
      snapshot.data() as Record<string, unknown>,
      ownerId
    ),
    syncState: snapshot.metadata.hasPendingWrites ? 'pending' : 'synced',
  };
};

const buildCloudNoteDocument = (
  note: Note,
  user: FirebaseUser,
  profileName: string,
  profilePhotoUrl: string
): Record<string, unknown> => {
  const ownerName = note.ownerName || getOwnerName(user, profileName);
  const collaborators = (note.collaborators ?? [])
    .filter(item => item.uid && item.name)
    .map(item => ({
      uid: item.uid,
      name: item.name,
      email: item.email ?? '',
      avatar: item.avatar ?? '',
    }));
  const sharedWith = [...new Set([
    ...(note.sharedWith ?? []),
    ...collaborators.map(item => item.uid),
  ].filter(Boolean))];
  const acceptedWith = (note.acceptedWith ?? []).filter(uid =>
    sharedWith.includes(uid)
  );
  const createdAtIso = note.createdAt || new Date().toISOString();
  const updatedAtIso = note.updatedAt || createdAtIso;

  return {
    schemaVersion: 1,
    id: note.id,
    ownerId: user.uid,
    ownerName,
    ownerEmail: note.ownerEmail || user.email || '',
    ownerAvatar: note.ownerAvatar || user.photoURL || profilePhotoUrl || '',
    title: note.title,
    content: note.content,
    associatedUsers: note.associatedUsers,
    checklist: note.checklist.map(item => ({
      id: item.id,
      text: item.text,
      done: item.done,
    })),
    auditLogs: note.auditLogs.map(log => ({
      user: log.user,
      action: log.action,
      timestamp: log.timestamp,
      userId: log.userId ?? '',
    })),
    shared: note.shared === true,
    mediaUrls: sanitizeCloudMediaUrls(note.mediaUrls ?? []),
    reminderDateTime: note.reminderDateTime ?? null,
    isPublishedToFeed: note.isPublishedToFeed === true,
    collaborators,
    sharedWith,
    acceptedWith,
    createdAtIso,
    updatedAtIso,
    serverUpdatedAt: serverTimestamp(),
  };
};

export function useProductivityNotes({
  profileName,
  profilePhotoUrl,
  setPosts,
  triggerToast,
  isLoggedIn = false,
}: UseProductivityNotesOptions) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [activeUserId, setActiveUserId] = useState<string | null>(null);
  const [notesHydrated, setNotesHydrated] = useState(false);

  const [newNoteTitle, setNewNoteTitle] = useState('');
  const [newNoteContent, setNewNoteContent] = useState('');
  const [newNoteChecklist, setNewNoteChecklist] = useState('');
  const [selectedFriendsForNote, setSelectedFriendsForNote] = useState<string[]>([]);
  const [showAddNoteForm, setShowAddNoteForm] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [newNoteMediaUrls, setNewNoteMediaUrls] = useState<string[]>([]);
  const [newNoteReminderDateTime, setNewNoteReminderDateTime] = useState('');
  const [newNoteIsPublishedToFeed, setNewNoteIsPublishedToFeed] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  const [activeAlarmNote, setActiveAlarmNote] = useState<Note | null>(null);
  const [dismissedAlarms, setDismissedAlarms] = useState<string[]>([]);
  const uploadGeneration = useRef(0);
  const profileNameRef = useRef(profileName);
  const profilePhotoUrlRef = useRef(profilePhotoUrl);
  const initialLocalNotesRef = useRef<Note[]>([]);
  const initialSnapshotHandledRef = useRef(false);

  useEffect(() => {
    profileNameRef.current = profileName;
  }, [profileName]);

  useEffect(() => {
    profilePhotoUrlRef.current = profilePhotoUrl;
  }, [profilePhotoUrl]);

  const queueCloudWrite = (note: Note): void => {
    const user = auth.currentUser;
    if (!user || note.ownerId && note.ownerId !== user.uid) return;

    const normalized = normalizeLocalNote(
      { ...note, syncState: 'pending' },
      user,
      profileNameRef.current,
      profilePhotoUrlRef.current
    );

    void setDoc(
      doc(db, 'users', user.uid, 'tasks', note.id),
      buildCloudNoteDocument(
        normalized,
        user,
        profileNameRef.current,
        profilePhotoUrlRef.current
      ),
      { merge: true }
    ).catch(error => {
      console.warn('A nota permaneceu na fila local de sincronização.', error);
      setNotes(previous =>
        previous.map(item =>
          item.id === note.id ? { ...item, syncState: 'error' } : item
        )
      );
      triggerToast(
        'Nota salva no dispositivo. A sincronização será tentada novamente quando houver conexão.',
        'warning'
      );
    });
  };

  useEffect(() => {
    let unsubscribeTasks = () => undefined;

    const unsubscribeAuth = onAuthStateChanged(auth, user => {
      unsubscribeTasks();
      uploadGeneration.current += 1;
      initialSnapshotHandledRef.current = false;

      if (!user) {
        setActiveUserId(null);
        setNotesHydrated(false);
        setNotes([]);
        setEditingNoteId(null);
        setShowAddNoteForm(false);
        initialLocalNotesRef.current = [];
        return;
      }

      const hydratedNotes = readStoredNotes(
        localStorage.getItem(getUserNotesKey(user.uid))
      ).map(note =>
        normalizeLocalNote(
          note,
          user,
          profileNameRef.current,
          profilePhotoUrlRef.current
        )
      );

      initialLocalNotesRef.current = hydratedNotes;
      setActiveUserId(user.uid);
      setNotes(sortNotesByUpdatedAt(hydratedNotes));
      setNotesHydrated(true);

      unsubscribeTasks = onSnapshot(
        collection(db, 'users', user.uid, 'tasks'),
        { includeMetadataChanges: true },
        snapshot => {
          const remoteNotes = snapshot.docs.map(mapTaskSnapshot);
          const remoteById = new Map(remoteNotes.map(note => [note.id, note]));

          if (!initialSnapshotHandledRef.current) {
            initialSnapshotHandledRef.current = true;
            const localNotes = initialLocalNotesRef.current;
            const mergedById = new Map<string, Note>();

            for (const remoteNote of remoteNotes) {
              mergedById.set(remoteNote.id, remoteNote);
            }

            for (const localNote of localNotes) {
              const remoteNote = remoteById.get(localNote.id);
              if (!remoteNote) {
                mergedById.set(localNote.id, {
                  ...localNote,
                  syncState: 'pending',
                });
                queueCloudWrite(localNote);
                continue;
              }

              const merged = mergeNoteVersions(localNote, remoteNote);
              mergedById.set(localNote.id, merged);

              if (getNoteUpdatedAt(localNote) > getNoteUpdatedAt(remoteNote)) {
                queueCloudWrite(localNote);
              }
            }

            setNotes(sortNotesByUpdatedAt([...mergedById.values()]));
            return;
          }

          setNotes(previous => {
            const nextById = new Map<string, Note>();

            for (const remoteNote of remoteNotes) {
              const localNote = previous.find(item => item.id === remoteNote.id);
              nextById.set(
                remoteNote.id,
                localNote ? mergeNoteVersions(localNote, remoteNote) : remoteNote
              );
            }

            for (const localNote of previous) {
              if (
                !remoteById.has(localNote.id) &&
                localNote.syncState === 'pending'
              ) {
                nextById.set(localNote.id, localNote);
              }
            }

            return sortNotesByUpdatedAt([...nextById.values()]);
          });
        },
        error => {
          console.warn('Sincronização em nuvem das notas indisponível.', error);
          triggerToast(
            'As notas continuam disponíveis offline. A nuvem será reconectada automaticamente.',
            'warning'
          );
        }
      );
    });

    return () => {
      unsubscribeAuth();
      unsubscribeTasks();
    };
  }, []);

  useEffect(() => {
    if (!isLoggedIn || !activeUserId || !notesHydrated) return;

    try {
      localStorage.setItem(
        getUserNotesKey(activeUserId),
        JSON.stringify(notes)
      );
    } catch (error) {
      console.warn('Não foi possível salvar as notas localmente.', error);
    }
  }, [activeUserId, isLoggedIn, notes, notesHydrated]);

  const resetComposer = () => {
    setEditingNoteId(null);
    setNewNoteTitle('');
    setNewNoteContent('');
    setNewNoteChecklist('');
    setSelectedFriendsForNote([]);
    setNewNoteMediaUrls([]);
    setNewNoteReminderDateTime('');
    setNewNoteIsPublishedToFeed(false);
    setIsUploading(false);
    setUploadProgress(0);
  };

  const handleSimulatedUpload = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const selectedFiles = event.target.files
      ? Array.from(event.target.files)
      : [];
    event.target.value = '';

    if (selectedFiles.length === 0) return;

    const remainingSlots = MAX_NOTE_ATTACHMENTS - newNoteMediaUrls.length;

    if (remainingSlots <= 0) {
      triggerToast(
        `Cada nota aceita até ${MAX_NOTE_ATTACHMENTS} anexos.`,
        'warning'
      );
      return;
    }

    const acceptedFiles = selectedFiles
      .filter(file => file.size <= MAX_NOTE_ATTACHMENT_BYTES)
      .slice(0, remainingSlots);

    if (acceptedFiles.length !== selectedFiles.length) {
      triggerToast(
        `Foram aceitos até ${remainingSlots} arquivos de no máximo 4 MB cada.`,
        'warning'
      );
    }

    if (acceptedFiles.length === 0) return;

    const currentGeneration = ++uploadGeneration.current;
    setIsUploading(true);
    setUploadProgress(10);

    void Promise.all(acceptedFiles.map(fileToDataUrl))
      .then(uploadedUrls => {
        if (uploadGeneration.current !== currentGeneration) return;

        setUploadProgress(100);
        setNewNoteMediaUrls(previous => [
          ...previous,
          ...uploadedUrls,
        ].slice(0, MAX_NOTE_ATTACHMENTS));
        triggerToast(
          `${uploadedUrls.length} arquivo(s) adicionado(s) à nota.`,
          'success'
        );
      })
      .catch(error => {
        console.warn('Falha ao preparar anexos da nota.', error);
        triggerToast('Não foi possível adicionar um dos arquivos.', 'error');
      })
      .finally(() => {
        if (uploadGeneration.current !== currentGeneration) return;
        window.setTimeout(() => {
          setIsUploading(false);
          setUploadProgress(0);
        }, 250);
      });
  };

  const publishNoteToFeed = (
    noteId: string,
    title: string,
    content: string,
    checklist: Note['checklist'],
    mediaUrls: string[]
  ) => {
    const checklistText =
      checklist.length > 0
        ? `\n\n📋 TAREFAS:\n${checklist
            .map(item => `${item.done ? '✓' : '☐'} ${item.text}`)
            .join('\n')}`
        : '';

    const postId = `post-shared-${noteId}`;
    const postContent =
      `📢 [NOTA COMPARTILHADA] *${title.toUpperCase()}*` +
      `\n\n"${content}"${checklistText}`;

    setPosts(previousPosts => {
      const existingPost = previousPosts.some(post => post.id === postId);

      if (existingPost) {
        return previousPosts.map(post =>
          post.id === postId
            ? { ...post, content: postContent, mediaUrls, time: 'Agora mesmo' }
            : post
        );
      }

      return [
        {
          id: postId,
          user: profileName || 'Você',
          avatar: profilePhotoUrl || '',
          time: 'Agora mesmo',
          content: postContent,
          likes: 0,
          mediaUrls,
        },
        ...previousPosts,
      ];
    });
  };

  const handleCreateNote = (event: React.FormEvent) => {
    event.preventDefault();

    const user = auth.currentUser;
    if (!user) {
      triggerToast('Faça login novamente para salvar a nota.', 'error');
      return;
    }

    if (!newNoteTitle.trim() || !newNoteContent.trim()) {
      triggerToast('Preencha o título e o conteúdo da nota.', 'error');
      return;
    }

    const existingNote = editingNoteId
      ? notes.find(note => note.id === editingNoteId)
      : undefined;
    const checklistItems = newNoteChecklist
      .split(',')
      .map(item => item.trim())
      .filter(Boolean)
      .map((text, index) => {
        const existingItem = existingNote?.checklist.find(
          item =>
            item.text.toLocaleLowerCase('pt-BR') ===
            text.toLocaleLowerCase('pt-BR')
        );

        return {
          id: existingItem?.id ?? `item-${Date.now()}-${index}`,
          text,
          done: existingItem?.done ?? false,
        };
      });
    const collaborators = normalizeCollaboratorSelections(
      selectedFriendsForNote
    ).filter(item => item.uid);
    const sharedWith = collaborators.map(item => item.uid);
    const acceptedWith = (existingNote?.acceptedWith ?? []).filter(uid =>
      sharedWith.includes(uid)
    );
    const noteId = editingNoteId ?? `note-${Date.now()}`;
    const now = new Date().toISOString();
    const ownerName = getOwnerName(user, profileName);
    const auditAction = editingNoteId
      ? 'Editou a nota de trabalho'
      : 'Criou a nota de produtividade';
    const nextNote: Note = {
      ...(existingNote ?? {}),
      id: noteId,
      title: newNoteTitle.trim().toUpperCase(),
      content: newNoteContent.trim(),
      associatedUsers: ['Você', ...collaborators.map(item => item.name)],
      checklist: checklistItems,
      mediaUrls: newNoteMediaUrls,
      reminderDateTime: newNoteReminderDateTime || null,
      isPublishedToFeed: newNoteIsPublishedToFeed,
      auditLogs: [
        createAuditLog(ownerName, auditAction, user.uid, now),
        ...(existingNote?.auditLogs ?? []),
      ],
      ownerId: user.uid,
      ownerName,
      ownerEmail: user.email ?? '',
      ownerAvatar: user.photoURL || profilePhotoUrl || '',
      collaborators,
      sharedWith,
      acceptedWith,
      createdAt: existingNote?.createdAt ?? now,
      updatedAt: now,
      syncState: 'pending',
    };

    setNotes(previous => {
      const withoutCurrent = previous.filter(note => note.id !== noteId);
      return sortNotesByUpdatedAt([nextNote, ...withoutCurrent]);
    });
    queueCloudWrite(nextNote);

    if (newNoteIsPublishedToFeed) {
      publishNoteToFeed(
        noteId,
        nextNote.title,
        nextNote.content,
        checklistItems,
        newNoteMediaUrls
      );
    }

    resetComposer();
    setShowAddNoteForm(false);
    triggerToast(
      editingNoteId
        ? 'Nota atualizada e sincronizada.'
        : collaborators.length > 0
          ? 'Nota salva e solicitações de colaboração enviadas.'
          : 'Nota e checklist criados com sucesso.',
      'success'
    );
  };

  const handleEditClick = (note: Note) => {
    setEditingNoteId(note.id);
    setNewNoteTitle(note.title);
    setNewNoteContent(note.content);
    setNewNoteChecklist(note.checklist.map(item => item.text).join(', '));
    setSelectedFriendsForNote(
      note.collaborators?.length
        ? note.collaborators.map(encodeNoteCollaborator)
        : note.associatedUsers
            .filter(userName => userName !== 'Você')
    );
    setNewNoteMediaUrls(note.mediaUrls ?? []);
    setNewNoteReminderDateTime(note.reminderDateTime ?? '');
    setNewNoteIsPublishedToFeed(note.isPublishedToFeed ?? false);
    setShowAddNoteForm(true);
    triggerToast(`Editando nota: ${note.title}`, 'info');
  };

  const handleDeleteNote = (noteId: string) => {
    const user = auth.currentUser;
    setNotes(previous => previous.filter(note => note.id !== noteId));
    setPosts(previous =>
      previous.filter(post => post.id !== `post-shared-${noteId}`)
    );

    if (editingNoteId === noteId) resetComposer();

    if (user) {
      void deleteDoc(doc(db, 'users', user.uid, 'tasks', noteId)).catch(error => {
        console.warn('Exclusão em nuvem permaneceu pendente.', error);
        triggerToast(
          'A nota foi removida deste dispositivo e será excluída da nuvem quando a conexão voltar.',
          'warning'
        );
      });
    }

    triggerToast('Nota excluída com sucesso.', 'success');
  };

  const handleToggleChecklistItem = (noteId: string, itemId: string) => {
    const user = auth.currentUser;
    const current = notes.find(note => note.id === noteId);
    if (!current || !user) return;

    const toggledItem = current.checklist.find(item => item.id === itemId);
    const now = new Date().toISOString();
    const updatedNote: Note = {
      ...current,
      checklist: current.checklist.map(item =>
        item.id === itemId ? { ...item, done: !item.done } : item
      ),
      auditLogs: [
        createAuditLog(
          getOwnerName(user, profileName),
          toggledItem
            ? `Marcou "${toggledItem.text}" como ${
                toggledItem.done ? 'PENDENTE' : 'CONCLUÍDO'
              }`
            : 'Alterou item do checklist',
          user.uid,
          now
        ),
        ...current.auditLogs,
      ],
      updatedAt: now,
      syncState: 'pending',
    };

    setNotes(previous =>
      sortNotesByUpdatedAt(
        previous.map(note => note.id === noteId ? updatedNote : note)
      )
    );
    queueCloudWrite(updatedNote);
    triggerToast('Tarefa atualizada.', 'success');
  };

  const handleShareNoteWithFriend = (noteId: string, friendName: string) => {
    const current = notes.find(note => note.id === noteId);
    const user = auth.currentUser;
    if (!current || !user || current.associatedUsers.includes(friendName)) return;

    const now = new Date().toISOString();
    const updatedNote: Note = {
      ...current,
      associatedUsers: [...current.associatedUsers, friendName],
      auditLogs: [
        createAuditLog(
          getOwnerName(user, profileName),
          `Adicionou ${friendName} à nota`,
          user.uid,
          now
        ),
        ...current.auditLogs,
      ],
      updatedAt: now,
      syncState: 'pending',
    };

    setNotes(previous =>
      previous.map(note => note.id === noteId ? updatedNote : note)
    );
    queueCloudWrite(updatedNote);
    triggerToast(`${friendName} adicionado à nota.`, 'success');
  };

  const handleShareNoteExternally = (noteId: string) => {
    const noteToShare = notes.find(note => note.id === noteId);
    const user = auth.currentUser;
    if (!noteToShare || !user) return;

    publishNoteToFeed(
      noteId,
      noteToShare.title,
      noteToShare.content,
      noteToShare.checklist,
      noteToShare.mediaUrls ?? []
    );

    const now = new Date().toISOString();
    const updatedNote: Note = {
      ...noteToShare,
      shared: true,
      auditLogs: [
        createAuditLog(
          getOwnerName(user, profileName),
          'Compartilhou a nota publicamente no feed',
          user.uid,
          now
        ),
        ...noteToShare.auditLogs,
      ],
      updatedAt: now,
      syncState: 'pending',
    };

    setNotes(previous =>
      previous.map(note => note.id === noteId ? updatedNote : note)
    );
    queueCloudWrite(updatedNote);
    triggerToast('Nota compartilhada no feed com sucesso.', 'success');
  };

  useEffect(() => {
    const interval = window.setInterval(() => {
      const now = new Date();
      const currentTimeString = [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, '0'),
        String(now.getDate()).padStart(2, '0'),
      ].join('-') +
        `T${String(now.getHours()).padStart(2, '0')}:${String(
          now.getMinutes()
        ).padStart(2, '0')}`;

      notes.forEach(note => {
        if (
          note.reminderDateTime !== currentTimeString ||
          dismissedAlarms.includes(note.id) ||
          activeAlarmNote?.id === note.id
        ) {
          return;
        }

        setActiveAlarmNote(note);

        if (
          typeof window !== 'undefined' &&
          'Notification' in window &&
          Notification.permission === 'granted'
        ) {
          try {
            new Notification(`Alarme Kyrub: ${note.title}`, {
              body: note.content,
              icon: '/favicon.ico',
              tag: note.id,
            });
          } catch (error) {
            console.warn('A notificação nativa não pôde ser exibida.', error);
          }
        }

        triggerToast(`Alarme de tarefa: ${note.title}`, 'success');
      });
    }, 4000);

    return () => window.clearInterval(interval);
  }, [activeAlarmNote, dismissedAlarms, notes, triggerToast]);

  return {
    notes,
    setNotes,
    newNoteTitle,
    setNewNoteTitle,
    newNoteContent,
    setNewNoteContent,
    newNoteChecklist,
    setNewNoteChecklist,
    selectedFriendsForNote,
    setSelectedFriendsForNote,
    showAddNoteForm,
    setShowAddNoteForm,
    editingNoteId,
    setEditingNoteId,
    newNoteMediaUrls,
    setNewNoteMediaUrls,
    newNoteReminderDateTime,
    setNewNoteReminderDateTime,
    newNoteIsPublishedToFeed,
    setNewNoteIsPublishedToFeed,
    isUploading,
    uploadProgress,
    activeAlarmNote,
    setActiveAlarmNote,
    dismissedAlarms,
    setDismissedAlarms,
    handleSimulatedUpload,
    handleCreateNote,
    handleEditClick,
    handleDeleteNote,
    handleToggleChecklistItem,
    handleShareNoteWithFriend,
    handleShareNoteExternally,
  };
}
