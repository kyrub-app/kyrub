import React, { useState, useEffect } from 'react';
import { Note, SocialPost } from '../types';
import { initialNotes } from '../constants/initialMocks';

const NOTES_KEY = 'kyrub_notes';

interface UseProductivityNotesOptions {
  profileName: string;
  profilePhotoUrl: string;
  posts: SocialPost[];
  setPosts: React.Dispatch<React.SetStateAction<SocialPost[]>>;
  triggerToast: (msg: string, type: 'success' | 'error' | 'info' | 'warning') => void;
  isLoggedIn?: boolean;
}

export function useProductivityNotes({
  profileName,
  profilePhotoUrl,
  posts,
  setPosts,
  triggerToast,
  isLoggedIn = false
}: UseProductivityNotesOptions) {
  // NOTES STATE
  const [notes, setNotes] = useState<Note[]>(() => {
    const saved = localStorage.getItem(NOTES_KEY);
    return saved ? JSON.parse(saved) : initialNotes;
  });

  // NEW/EDITING NOTE STATES
  const [newNoteTitle, setNewNoteTitle] = useState('');
  const [newNoteContent, setNewNoteContent] = useState('');
  const [newNoteChecklist, setNewNoteChecklist] = useState('');
  const [selectedFriendsForNote, setSelectedFriendsForNote] = useState<string[]>([]);
  const [showAddNoteForm, setShowAddNoteForm] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [newNoteMediaUrls, setNewNoteMediaUrls] = useState<string[]>([]);
  const [newNoteReminderDateTime, setNewNoteReminderDateTime] = useState<string>('');
  const [newNoteIsPublishedToFeed, setNewNoteIsPublishedToFeed] = useState<boolean>(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  // ALARM STATES
  const [activeAlarmNote, setActiveAlarmNote] = useState<Note | null>(null);
  const [dismissedAlarms, setDismissedAlarms] = useState<string[]>([]);

  // Persistence
  useEffect(() => {
    localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
  }, [notes]);

  // Simulated Upload
  const handleSimulatedUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const filesArray = Array.from(e.target.files);
    
    setIsUploading(true);
    setUploadProgress(0);
    
    let currentProgress = 0;
    const interval = setInterval(() => {
      currentProgress += 10;
      setUploadProgress(currentProgress);
      if (currentProgress >= 100) {
        clearInterval(interval);
        
        const uploadedUrls = filesArray.map((file: File, i: number) => {
          if (file.type && file.type.startsWith('video')) {
            return 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4';
          } else {
            const randoms = [
              'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=600&fit=crop&q=80',
              'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=600&fit=crop&q=80',
              'https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?w=600&fit=crop&q=80'
            ];
            return randoms[i % randoms.length] || `https://picsum.photos/id/${Math.floor(Math.random() * 100)}/600/400`;
          }
        });
        
        setNewNoteMediaUrls(prev => [...prev, ...uploadedUrls]);
        setIsUploading(false);
        triggerToast(`Simulado upload para Firebase Storage: /users/custom-user/notes/${editingNoteId || 'nova-nota'}/`, 'success');
      }
    }, 150);
  };

  // Handle Note Create/Update
  const handleCreateNote = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNoteTitle.trim() || !newNoteContent.trim()) {
      triggerToast('Preencha o título e conteúdo da nota!', 'error');
      return;
    }

    const checklistItems = newNoteChecklist
      ? newNoteChecklist.split(',').map((item, idx) => {
          const trimmedText = item.trim();
          // Keep completed state if editing
          const existingItem = editingNoteId 
            ? notes.find(n => n.id === editingNoteId)?.checklist.find(i => i.text.toLowerCase() === trimmedText.toLowerCase())
            : undefined;
          return {
            id: existingItem?.id || `item-${Date.now()}-${idx}`,
            text: trimmedText,
            done: existingItem?.done || false
          };
        })
      : [];

    const noteIdToUse = editingNoteId || `note-${Date.now()}`;

    if (editingNoteId) {
      setNotes(prev =>
        prev.map(note => {
          if (note.id !== editingNoteId) return note;
          const updatedNote: Note = {
            ...note,
            title: newNoteTitle.toUpperCase(),
            content: newNoteContent,
            associatedUsers: ['Você', ...selectedFriendsForNote],
            checklist: checklistItems,
            mediaUrls: newNoteMediaUrls,
            reminderDateTime: newNoteReminderDateTime || null,
            isPublishedToFeed: newNoteIsPublishedToFeed,
            auditLogs: [
              { user: 'Você', action: 'Editou a nota de trabalho', timestamp: new Date().toLocaleString('pt-BR') },
              ...note.auditLogs
            ]
          };

          console.log(`[Local] Atualizando documento em 'tasks/${note.id}'`, {
            id: note.id,
            title: updatedNote.title,
            content: updatedNote.content,
            mediaUrls: updatedNote.mediaUrls,
            reminderDateTime: updatedNote.reminderDateTime,
            isPublishedToFeed: updatedNote.isPublishedToFeed,
            checklist: updatedNote.checklist,
            updatedAt: new Date().toISOString()
          });

          return updatedNote;
        })
      );

      // If published to feed is enabled, trigger public post
      if (newNoteIsPublishedToFeed) {
        const checklistStr = checklistItems.length > 0 
          ? `\n\n📋 TAREFAS:\n${checklistItems.map(item => `${item.done ? '✓' : '☐'} ${item.text}`).join('\n')}`
          : '';
        const existsPost = posts.some(p => p.id === `post-shared-${editingNoteId}`);
        if (!existsPost) {
          const newPost: SocialPost = {
            id: `post-shared-${editingNoteId}`,
            user: profileName || 'Você',
            avatar: profilePhotoUrl || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&h=100&fit=crop&q=80',
            time: 'Agora mesmo',
            content: `📢 [NOTA COMPARTILHADA] *${newNoteTitle.toUpperCase()}*\n\n"${newNoteContent}"${checklistStr}`,
            likes: 0,
            mediaUrls: newNoteMediaUrls
          };
          setPosts(prev => [newPost, ...prev]);
        } else {
          setPosts(prev => prev.map(p => p.id === `post-shared-${editingNoteId}` ? {
            ...p,
            content: `📢 [NOTA COMPARTILHADA] *${newNoteTitle.toUpperCase()}*\n\n"${newNoteContent}"${checklistStr}`,
            mediaUrls: newNoteMediaUrls
          } : p));
        }
      }

      setEditingNoteId(null);
      setNewNoteTitle('');
      setNewNoteContent('');
      setNewNoteChecklist('');
      setSelectedFriendsForNote([]);
      setNewNoteMediaUrls([]);
      setNewNoteReminderDateTime('');
      setNewNoteIsPublishedToFeed(false);
      setShowAddNoteForm(false);
      triggerToast('Nota de trabalho atualizada com sucesso!', 'success');
      return;
    }

    const newNote: Note = {
      id: noteIdToUse,
      title: newNoteTitle.toUpperCase(),
      content: newNoteContent,
      associatedUsers: ['Você', ...selectedFriendsForNote],
      checklist: checklistItems,
      mediaUrls: newNoteMediaUrls,
      reminderDateTime: newNoteReminderDateTime || null,
      isPublishedToFeed: newNoteIsPublishedToFeed,
      auditLogs: [
        { user: 'Você', action: 'Criou a nota de produtividade', timestamp: new Date().toLocaleString('pt-BR') }
      ]
    };

    console.log(`[Local] Salvando novo documento em 'tasks/${noteIdToUse}'`, {
      id: noteIdToUse,
      title: newNote.title,
      content: newNote.content,
      mediaUrls: newNote.mediaUrls,
      reminderDateTime: newNote.reminderDateTime,
      isPublishedToFeed: newNote.isPublishedToFeed,
      checklist: newNote.checklist,
      createdAt: new Date().toISOString()
    });

    setNotes([newNote, ...notes]);

    if (newNoteIsPublishedToFeed) {
      const checklistStr = checklistItems.length > 0 
        ? `\n\n📋 TAREFAS:\n${checklistItems.map(item => `${item.done ? '✓' : '☐'} ${item.text}`).join('\n')}`
        : '';
      const newPost: SocialPost = {
        id: `post-shared-${noteIdToUse}`,
        user: profileName || 'Você',
        avatar: profilePhotoUrl || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&h=100&fit=crop&q=80',
        time: 'Agora mesmo',
        content: `📢 [NOTA COMPARTILHADA] *${newNoteTitle.toUpperCase()}*\n\n"${newNoteContent}"${checklistStr}`,
        likes: 0,
        mediaUrls: newNoteMediaUrls
      };
      setPosts(prev => [newPost, ...prev]);
      triggerToast('Nota salva e publicada no feed!', 'success');
    } else {
      triggerToast('Nota e checklist de tarefas criados!', 'success');
    }

    setNewNoteTitle('');
    setNewNoteContent('');
    setNewNoteChecklist('');
    setSelectedFriendsForNote([]);
    setNewNoteMediaUrls([]);
    setNewNoteReminderDateTime('');
    setNewNoteIsPublishedToFeed(false);
    setShowAddNoteForm(false);
  };

  // Click to edit
  const handleEditClick = (note: Note) => {
    setEditingNoteId(note.id);
    setNewNoteTitle(note.title);
    setNewNoteContent(note.content);
    setNewNoteChecklist(note.checklist.map(item => item.text).join(', '));
    setSelectedFriendsForNote(note.associatedUsers.filter(u => u !== 'Você'));
    
    // Load existing fields on edit
    setNewNoteMediaUrls(note.mediaUrls || []);
    setNewNoteReminderDateTime(note.reminderDateTime || '');
    setNewNoteIsPublishedToFeed(note.isPublishedToFeed || false);

    setShowAddNoteForm(true);
    triggerToast(`Editando nota: ${note.title}`, 'info');
  };

  // Delete note
  const handleDeleteNote = (noteId: string) => {
    // Notes remain local until the private per-user sync is implemented.
    setNotes(prev => prev.filter(n => n.id !== noteId));
    if (editingNoteId === noteId) {
      setEditingNoteId(null);
      setNewNoteTitle('');
      setNewNoteContent('');
      setNewNoteChecklist('');
      setSelectedFriendsForNote([]);
      setNewNoteMediaUrls([]);
      setNewNoteReminderDateTime('');
      setNewNoteIsPublishedToFeed(false);
    }
    triggerToast('Nota excluída com sucesso!', 'success');
  };

  // Toggle checklist item within a note
  const handleToggleChecklistItem = (noteId: string, itemId: string) => {
    setNotes(prev =>
      prev.map(note => {
        if (note.id !== noteId) return note;
        const updatedChecklist = note.checklist.map(item =>
          item.id === itemId ? { ...item, done: !item.done } : item
        );
        const toggledItem = note.checklist.find(i => i.id === itemId);
        const actionText = toggledItem
          ? `Marcou "${toggledItem.text}" como ${!toggledItem.done ? 'CONCLUÍDO' : 'PENDENTE'}`
          : 'Alterou item do checklist';
        
        return {
          ...note,
          checklist: updatedChecklist,
          auditLogs: [
            { user: 'Você', action: actionText, timestamp: new Date().toLocaleString('pt-BR') },
            ...note.auditLogs
          ]
        };
      })
    );
    triggerToast('Tarefa atualizada e auditoria registrada!', 'success');
  };

  // Share Note with a friend directly
  const handleShareNoteWithFriend = (noteId: string, friendName: string) => {
    setNotes(prev =>
      prev.map(note => {
        if (note.id !== noteId) return note;
        if (note.associatedUsers.includes(friendName)) {
          triggerToast(`Esta nota já está compartilhada com ${friendName}.`, 'info');
          return note;
        }
        return {
          ...note,
          associatedUsers: [...note.associatedUsers, friendName],
          auditLogs: [
            { user: 'Você', action: `Compartilhou nota com ${friendName}`, timestamp: new Date().toLocaleString('pt-BR') },
            ...note.auditLogs
          ]
        };
      })
    );
    triggerToast(`Nota compartilhada with ${friendName}!`, 'success');
  };

  // Publish note externally to community/public feed
  const handleShareNoteExternally = (noteId: string) => {
    const noteToShare = notes.find(n => n.id === noteId);
    if (!noteToShare) return;

    if (noteToShare.shared) {
      triggerToast('Esta nota já foi compartilhada no feed!', 'info');
      return;
    }

    setNotes(prev =>
      prev.map(note => {
        if (note.id !== noteId) return note;
        return {
          ...note,
          shared: true,
          auditLogs: [
            { user: 'Você', action: 'Compartilhou nota publicamente no feed', timestamp: new Date().toLocaleString('pt-BR') },
            ...note.auditLogs
          ]
        };
      })
    );

    const checklistStr = noteToShare.checklist.length > 0 
      ? `\n\n📋 TAREFAS:\n${noteToShare.checklist.map(item => `${item.done ? '✓' : '☐'} ${item.text}`).join('\n')}`
      : '';

    const newPost: SocialPost = {
      id: `post-shared-${noteId}`,
      user: profileName || 'Você',
      avatar: profilePhotoUrl || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&h=100&fit=crop&q=80',
      time: 'Agora mesmo',
      content: `📢 [NOTA COMPARTILHADA] *${noteToShare.title.toUpperCase()}*\n\n"${noteToShare.content}"${checklistStr}`,
      likes: 0,
      mediaUrls: noteToShare.mediaUrls || []
    };
    setPosts(prev => [newPost, ...prev]);
    triggerToast('Nota compartilhada no feed com sucesso!', 'success');
  };

  // Real-time alarm checking useEffect
  useEffect(() => {
    const checkAlarms = setInterval(() => {
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      const hours = String(now.getHours()).padStart(2, '0');
      const minutes = String(now.getMinutes()).padStart(2, '0');
      const currentTimeString = `${year}-${month}-${day}T${hours}:${minutes}`;

      notes.forEach(note => {
        if (note.reminderDateTime && note.reminderDateTime === currentTimeString) {
          if (!dismissedAlarms.includes(note.id) && (!activeAlarmNote || activeAlarmNote.id !== note.id)) {
            setActiveAlarmNote(note);
            
            // Native sound attempt
            try {
              const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
              const osc = audioCtx.createOscillator();
              const gainNode = audioCtx.createGain();
              osc.type = 'sine';
              osc.frequency.value = 880; // A5 note
              gainNode.gain.setValueAtTime(0.3, audioCtx.currentTime);
              osc.connect(gainNode);
              gainNode.connect(audioCtx.destination);
              osc.start();
              osc.stop(audioCtx.currentTime + 1.2);
            } catch (e) {
              // audio context blocked or unsupported
            }

            // Standard Web API browser notification
            if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
              try {
                new Notification(`🔔 Alarme Kyrub: ${note.title}`, {
                  body: note.content,
                  icon: '/favicon.ico',
                  tag: note.id,
                });
              } catch (err) {
                console.log('Failing to fire native browser Notification:', err);
              }
            }
            triggerToast(`🔔 ALARME DE TAREFA ATIVO: ${note.title}`, 'success');
          }
        }
      });
    }, 4000);

    return () => clearInterval(checkAlarms);
  }, [notes, dismissedAlarms, activeAlarmNote, triggerToast]);

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
    handleShareNoteExternally
  };
}
