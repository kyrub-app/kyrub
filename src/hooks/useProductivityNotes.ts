import React, { useEffect, useRef, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { Note, SocialPost } from '../types';
import { auth } from '../utils/firebase';

const LEGACY_NOTES_KEY = 'kyrub_notes';
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
  const [selectedFriendsForNote, setSelectedFriendsForNote] = useState<
    string[]
  >([]);
  const [showAddNoteForm, setShowAddNoteForm] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [newNoteMediaUrls, setNewNoteMediaUrls] = useState<string[]>([]);
  const [newNoteReminderDateTime, setNewNoteReminderDateTime] = useState('');
  const [newNoteIsPublishedToFeed, setNewNoteIsPublishedToFeed] =
    useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  const [activeAlarmNote, setActiveAlarmNote] = useState<Note | null>(null);
  const [dismissedAlarms, setDismissedAlarms] = useState<string[]>([]);
  const uploadGeneration = useRef(0);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, user => {
      uploadGeneration.current += 1;

      if (!user) {
        setActiveUserId(null);
        setNotesHydrated(false);
        setNotes([]);
        setEditingNoteId(null);
        setShowAddNoteForm(false);
        return;
      }

      const userStorageKey = getUserNotesKey(user.uid);
      const storedForUser = localStorage.getItem(userStorageKey);
      const legacyStoredNotes = localStorage.getItem(LEGACY_NOTES_KEY);
      const hydratedNotes = readStoredNotes(
        storedForUser ?? legacyStoredNotes
      );

      if (!storedForUser && legacyStoredNotes && hydratedNotes.length > 0) {
        try {
          localStorage.setItem(
            userStorageKey,
            JSON.stringify(hydratedNotes)
          );
        } catch (error) {
          console.warn('Não foi possível migrar as notas locais.', error);
        }
      }

      setActiveUserId(user.uid);
      setNotes(hydratedNotes);
      setNotesHydrated(true);
    });

    return unsubscribe;
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

    const remainingSlots =
      MAX_NOTE_ATTACHMENTS - newNoteMediaUrls.length;

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
        triggerToast(
          'Não foi possível adicionar um dos arquivos.',
          'error'
        );
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
            ? {
                ...post,
                content: postContent,
                mediaUrls,
                time: 'Agora mesmo',
              }
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

    if (!newNoteTitle.trim() || !newNoteContent.trim()) {
      triggerToast(
        'Preencha o título e o conteúdo da nota.',
        'error'
      );
      return;
    }

    const checklistItems = newNoteChecklist
      .split(',')
      .map(item => item.trim())
      .filter(Boolean)
      .map((text, index) => {
        const existingItem = editingNoteId
          ? notes
              .find(note => note.id === editingNoteId)
              ?.checklist.find(
                item =>
                  item.text.toLocaleLowerCase('pt-BR') ===
                  text.toLocaleLowerCase('pt-BR')
              )
          : undefined;

        return {
          id: existingItem?.id ?? `item-${Date.now()}-${index}`,
          text,
          done: existingItem?.done ?? false,
        };
      });

    const noteId = editingNoteId ?? `note-${Date.now()}`;
    const now = new Date().toLocaleString('pt-BR');

    if (editingNoteId) {
      setNotes(previousNotes =>
        previousNotes.map(note =>
          note.id === editingNoteId
            ? {
                ...note,
                title: newNoteTitle.trim().toUpperCase(),
                content: newNoteContent.trim(),
                associatedUsers: [
                  'Você',
                  ...selectedFriendsForNote,
                ],
                checklist: checklistItems,
                mediaUrls: newNoteMediaUrls,
                reminderDateTime:
                  newNoteReminderDateTime || null,
                isPublishedToFeed: newNoteIsPublishedToFeed,
                auditLogs: [
                  {
                    user: 'Você',
                    action: 'Editou a nota de trabalho',
                    timestamp: now,
                  },
                  ...note.auditLogs,
                ],
              }
            : note
        )
      );

      if (newNoteIsPublishedToFeed) {
        publishNoteToFeed(
          noteId,
          newNoteTitle,
          newNoteContent,
          checklistItems,
          newNoteMediaUrls
        );
      }

      resetComposer();
      setShowAddNoteForm(false);
      triggerToast(
        'Nota de trabalho atualizada com sucesso.',
        'success'
      );
      return;
    }

    const newNote: Note = {
      id: noteId,
      title: newNoteTitle.trim().toUpperCase(),
      content: newNoteContent.trim(),
      associatedUsers: ['Você', ...selectedFriendsForNote],
      checklist: checklistItems,
      mediaUrls: newNoteMediaUrls,
      reminderDateTime: newNoteReminderDateTime || null,
      isPublishedToFeed: newNoteIsPublishedToFeed,
      auditLogs: [
        {
          user: 'Você',
          action: 'Criou a nota de produtividade',
          timestamp: now,
        },
      ],
    };

    setNotes(previousNotes => [newNote, ...previousNotes]);

    if (newNoteIsPublishedToFeed) {
      publishNoteToFeed(
        noteId,
        newNoteTitle,
        newNoteContent,
        checklistItems,
        newNoteMediaUrls
      );
      triggerToast(
        'Nota salva e publicada no feed.',
        'success'
      );
    } else {
      triggerToast(
        'Nota e checklist criados com sucesso.',
        'success'
      );
    }

    resetComposer();
    setShowAddNoteForm(false);
  };

  const handleEditClick = (note: Note) => {
    setEditingNoteId(note.id);
    setNewNoteTitle(note.title);
    setNewNoteContent(note.content);
    setNewNoteChecklist(
      note.checklist.map(item => item.text).join(', ')
    );
    setSelectedFriendsForNote(
      note.associatedUsers.filter(user => user !== 'Você')
    );
    setNewNoteMediaUrls(note.mediaUrls ?? []);
    setNewNoteReminderDateTime(note.reminderDateTime ?? '');
    setNewNoteIsPublishedToFeed(
      note.isPublishedToFeed ?? false
    );
    setShowAddNoteForm(true);
    triggerToast(`Editando nota: ${note.title}`, 'info');
  };

  const handleDeleteNote = (noteId: string) => {
    setNotes(previous =>
      previous.filter(note => note.id !== noteId)
    );
    setPosts(previous =>
      previous.filter(post => post.id !== `post-shared-${noteId}`)
    );

    if (editingNoteId === noteId) {
      resetComposer();
    }

    triggerToast('Nota excluída com sucesso.', 'success');
  };

  const handleToggleChecklistItem = (
    noteId: string,
    itemId: string
  ) => {
    setNotes(previousNotes =>
      previousNotes.map(note => {
        if (note.id !== noteId) return note;

        const toggledItem = note.checklist.find(
          item => item.id === itemId
        );
        const checklist = note.checklist.map(item =>
          item.id === itemId
            ? { ...item, done: !item.done }
            : item
        );

        return {
          ...note,
          checklist,
          auditLogs: [
            {
              user: 'Você',
              action: toggledItem
                ? `Marcou "${toggledItem.text}" como ${
                    toggledItem.done
                      ? 'PENDENTE'
                      : 'CONCLUÍDO'
                  }`
                : 'Alterou item do checklist',
              timestamp: new Date().toLocaleString('pt-BR'),
            },
            ...note.auditLogs,
          ],
        };
      })
    );

    triggerToast('Tarefa atualizada.', 'success');
  };

  const handleShareNoteWithFriend = (
    noteId: string,
    friendName: string
  ) => {
    setNotes(previousNotes =>
      previousNotes.map(note => {
        if (note.id !== noteId) return note;
        if (note.associatedUsers.includes(friendName)) return note;

        return {
          ...note,
          associatedUsers: [
            ...note.associatedUsers,
            friendName,
          ],
          auditLogs: [
            {
              user: 'Você',
              action: `Compartilhou nota com ${friendName}`,
              timestamp: new Date().toLocaleString('pt-BR'),
            },
            ...note.auditLogs,
          ],
        };
      })
    );

    triggerToast(
      `Nota compartilhada com ${friendName}.`,
      'success'
    );
  };

  const handleShareNoteExternally = (noteId: string) => {
    const noteToShare = notes.find(note => note.id === noteId);
    if (!noteToShare) return;

    publishNoteToFeed(
      noteId,
      noteToShare.title,
      noteToShare.content,
      noteToShare.checklist,
      noteToShare.mediaUrls ?? []
    );

    setNotes(previousNotes =>
      previousNotes.map(note =>
        note.id === noteId
          ? {
              ...note,
              shared: true,
              auditLogs: [
                {
                  user: 'Você',
                  action:
                    'Compartilhou nota publicamente no feed',
                  timestamp:
                    new Date().toLocaleString('pt-BR'),
                },
                ...note.auditLogs,
              ],
            }
          : note
      )
    );

    triggerToast(
      'Nota compartilhada no feed com sucesso.',
      'success'
    );
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
            console.warn(
              'A notificação nativa não pôde ser exibida.',
              error
            );
          }
        }

        triggerToast(
          `Alarme de tarefa: ${note.title}`,
          'success'
        );
      });
    }, 4000);

    return () => window.clearInterval(interval);
  }, [
    activeAlarmNote,
    dismissedAlarms,
    notes,
    triggerToast,
  ]);

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
