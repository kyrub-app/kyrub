import { useEffect, useRef, useState } from 'react';
import {
  Check,
  FileText,
  History,
  Image as ImageIcon,
  MessageSquare,
  Paperclip,
  Send,
  Users,
  X,
} from 'lucide-react';
import { arrayUnion, doc, getDoc, updateDoc } from 'firebase/firestore';
import { auth, db } from '../utils/firebase';

interface VisibleChecklistItem {
  label: string;
  completed: boolean;
}

interface WorkspaceComment {
  id: string;
  text: string;
  author: string;
  createdAt: string;
}

interface WorkspaceAuditLog {
  user: string;
  action: string;
  timestamp: string;
}

interface WorkspacePerson {
  name: string;
  avatar?: string;
}

interface StoredNoteSnapshot {
  id: string;
  title: string;
  content: string;
  mediaUrls?: string[];
  ownerName?: string;
  ownerAvatar?: string;
  associatedUsers?: string[];
  collaborators?: Array<{ name?: string; avatar?: string }>;
  auditLogs?: WorkspaceAuditLog[];
}

interface VisibleNoteContent {
  noteId: string | null;
  title: string;
  content: string;
  checklist: VisibleChecklistItem[];
  mediaUrls: string[];
  people: WorkspacePerson[];
  auditLogs: WorkspaceAuditLog[];
  comments: WorkspaceComment[];
}

const PREVIEW_BUTTON_CLASS = 'kyrub-note-preview-open';
const PREVIEW_CONTENT_ATTRIBUTE = 'data-kyrub-note-content-preview';
const CHECKLIST_PROGRESS_CLASS = 'kyrub-note-checklist-progress';
const CHECKLIST_ROW_ATTRIBUTE = 'data-kyrub-checklist-row';
const STYLE_ELEMENT_ID = 'kyrub-note-card-layout-styles';
const MAX_PENDING_CHECKLIST_ITEMS = 3;
const MAX_NOTE_ATTACHMENTS = 9;
const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;

const ensurePreviewStyles = (): void => {
  if (document.getElementById(STYLE_ELEMENT_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ELEMENT_ID;
  style.textContent = `
    #notes-grid { display:block!important; column-count:2; column-gap:.9rem; }
    #notes-grid > article { display:inline-block!important; width:100%!important; height:auto!important; min-height:0!important; margin:0 0 .9rem!important; vertical-align:top; break-inside:avoid; -webkit-column-break-inside:avoid; page-break-inside:avoid; overflow:hidden; }
    #notes-grid > article > :first-child { height:auto!important; min-height:0!important; }
    #notes-grid > article [${PREVIEW_CONTENT_ATTRIBUTE}="true"] { max-height:11rem; overflow:hidden; white-space:pre-wrap; overflow-wrap:anywhere; }
    #notes-grid > article [${PREVIEW_CONTENT_ATTRIBUTE}="true"][data-overflowing="true"] { -webkit-mask-image:linear-gradient(to bottom,#000 0%,#000 72%,transparent 100%); mask-image:linear-gradient(to bottom,#000 0%,#000 72%,transparent 100%); }
    #notes-grid .${CHECKLIST_PROGRESS_CLASS} { display:inline-flex; align-items:center; gap:.3rem; margin:.35rem 0 .55rem; color:rgb(45 212 191); font-size:.625rem; font-weight:800; letter-spacing:.025em; text-transform:uppercase; }
    #notes-grid [${CHECKLIST_ROW_ATTRIBUTE}="hidden"] { display:none!important; }
    #notes-grid .${PREVIEW_BUTTON_CLASS} { display:block; width:100%; margin:0; border:0; border-top:1px solid rgb(30 41 59); background:rgb(15 23 42 / .72); padding:.8rem .75rem .85rem; color:rgb(45 212 191); cursor:pointer; font-size:.625rem; font-weight:900; letter-spacing:.05em; text-align:center; text-transform:uppercase; }
    #notes-grid > article > .${PREVIEW_BUTTON_CLASS} { border-radius:0 0 .9rem .9rem; }
    #notes-grid .${PREVIEW_BUTTON_CLASS}:hover, #notes-grid .${PREVIEW_BUTTON_CLASS}:focus-visible { color:rgb(94 234 212); outline:none; text-decoration:underline; text-underline-offset:.2rem; }
    @media (max-width:359px) { #notes-grid { column-count:1; } }
    @media (min-width:640px) { #notes-grid > article [${PREVIEW_CONTENT_ATTRIBUTE}="true"] { max-height:14rem; } }
    @media (min-width:768px) { #notes-grid { column-count:3; column-gap:1rem; } #notes-grid > article { margin-bottom:1rem!important; } }
    @media (min-width:1200px) { #notes-grid { column-count:4; } }
  `;
  document.head.appendChild(style);
};

const findChecklistHeading = (root: HTMLElement): HTMLElement | null =>
  Array.from(root.querySelectorAll<HTMLElement>('div, span, p, h4, h5')).find(
    candidate => candidate.textContent?.trim().toUpperCase() === 'CHECKLIST'
  ) ?? null;

const getChecklistRow = (input: HTMLInputElement, root: HTMLElement): HTMLElement | null => {
  const label = input.closest('label');
  if (label instanceof HTMLElement && root.contains(label)) return label;
  let current: HTMLElement | null = input.parentElement;
  while (current && current.parentElement && current.parentElement !== root) {
    if (
      current.querySelectorAll('input[type="checkbox"]').length === 1 &&
      (current.textContent?.trim().length ?? 0) > 0
    ) return current;
    current = current.parentElement;
  }
  return input.parentElement instanceof HTMLElement ? input.parentElement : null;
};

const readChecklist = (root: HTMLElement): VisibleChecklistItem[] =>
  Array.from(root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).map(input => {
    const row = getChecklistRow(input, root);
    return {
      label: row?.textContent?.replace(/\s+/g, ' ').trim() || 'Item da checklist',
      completed: input.checked,
    };
  });

const readStoredNote = (title: string, content: string): StoredNoteSnapshot | null => {
  const uid = auth.currentUser?.uid;
  if (!uid) return null;
  try {
    const raw = localStorage.getItem(`kyrub_notes_${uid}`);
    if (!raw) return null;
    const notes = JSON.parse(raw) as StoredNoteSnapshot[];
    return (
      notes.find(note => note.title?.trim() === title.trim() && note.content === content) ??
      notes.find(note => note.title?.trim() === title.trim()) ??
      null
    );
  } catch {
    return null;
  }
};

const buildPeople = (note: StoredNoteSnapshot | null): WorkspacePerson[] => {
  if (!note) return [];
  const people: WorkspacePerson[] = [];
  if (note.ownerName) people.push({ name: note.ownerName, avatar: note.ownerAvatar });
  for (const collaborator of note.collaborators ?? []) {
    if (collaborator.name && !people.some(person => person.name === collaborator.name)) {
      people.push({ name: collaborator.name, avatar: collaborator.avatar });
    }
  }
  for (const name of note.associatedUsers ?? []) {
    if (name && !people.some(person => person.name === name)) people.push({ name });
  }
  return people;
};

const readComments = (value: unknown): WorkspaceComment[] => {
  if (!Array.isArray(value)) return [];
  return value
    .filter(item => item && typeof item === 'object')
    .map(item => {
      const row = item as Record<string, unknown>;
      return {
        id: typeof row.id === 'string' ? row.id : crypto.randomUUID(),
        text: typeof row.text === 'string' ? row.text : '',
        author: typeof row.author === 'string' ? row.author : 'Usuário',
        createdAt: typeof row.createdAt === 'string' ? row.createdAt : '',
      };
    })
    .filter(comment => comment.text);
};

const fileToDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Arquivo inválido'));
    reader.onerror = () => reject(reader.error ?? new Error('Falha ao ler arquivo'));
    reader.readAsDataURL(file);
  });

export function NoteCardLayoutBridge() {
  const [visibleNote, setVisibleNote] = useState<VisibleNoteContent | null>(null);
  const [commentText, setCommentText] = useState('');
  const [savingComment, setSavingComment] = useState(false);
  const [uploading, setUploading] = useState(false);
  const activeContentRootRef = useRef<HTMLElement | null>(null);

  const refreshWorkspaceFromCard = () => {
    const root = activeContentRootRef.current;
    if (!root) return;
    setVisibleNote(previous => previous ? { ...previous, checklist: readChecklist(root) } : previous);
  };

  useEffect(() => {
    ensurePreviewStyles();
    let frame = 0;
    let stopped = false;

    const enhanceCards = () => {
      frame = 0;
      if (stopped) return;
      const grid = document.getElementById('notes-grid');
      if (!grid) return;
      const cards = Array.from(grid.children).filter(
        (node): node is HTMLElement => node instanceof HTMLElement
      );

      cards.forEach(card => {
        const contentRoot = card.firstElementChild;
        if (!(contentRoot instanceof HTMLElement)) return;
        const paragraph = Array.from(contentRoot.children).find(element => element.tagName === 'P');
        if (!(paragraph instanceof HTMLParagraphElement)) return;

        paragraph.setAttribute(PREVIEW_CONTENT_ATTRIBUTE, 'true');
        paragraph.dataset.overflowing = paragraph.scrollHeight > paragraph.clientHeight + 1 ? 'true' : 'false';

        const inputs = Array.from(contentRoot.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
        const checklist = readChecklist(contentRoot);
        const completed = checklist.filter(item => item.completed).length;
        let pendingShown = 0;
        inputs.forEach(input => {
          const row = getChecklistRow(input, contentRoot);
          if (!row) return;
          const hidden = input.checked || pendingShown >= MAX_PENDING_CHECKLIST_ITEMS;
          row.setAttribute(CHECKLIST_ROW_ATTRIBUTE, hidden ? 'hidden' : 'visible');
          if (!input.checked && !hidden) pendingShown += 1;
        });

        const heading = findChecklistHeading(contentRoot);
        let progress = contentRoot.querySelector<HTMLElement>(`.${CHECKLIST_PROGRESS_CLASS}`);
        if (checklist.length && heading) {
          if (!progress) {
            progress = document.createElement('span');
            progress.className = CHECKLIST_PROGRESS_CLASS;
            heading.insertAdjacentElement('afterend', progress);
          }
          progress.textContent = `${completed}/${checklist.length} concluídos`;
        } else {
          progress?.remove();
        }

        let button = card.querySelector<HTMLButtonElement>(`.${PREVIEW_BUTTON_CLASS}`);
        if (!button) {
          button = document.createElement('button');
          button.type = 'button';
          button.className = PREVIEW_BUTTON_CLASS;
          button.textContent = 'Ver nota completa';
          button.setAttribute('aria-label', 'Ver nota completa');
          button.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            activeContentRootRef.current = contentRoot;
            const title = card.querySelector('h3')?.textContent?.trim() || 'Nota';
            const content = paragraph.textContent ?? '';
            const stored = readStoredNote(title, content);
            const initial: VisibleNoteContent = {
              noteId: stored?.id ?? null,
              title,
              content,
              checklist: readChecklist(contentRoot),
              mediaUrls: stored?.mediaUrls ?? [],
              people: buildPeople(stored),
              auditLogs: stored?.auditLogs ?? [],
              comments: [],
            };
            setVisibleNote(initial);
            setCommentText('');

            const uid = auth.currentUser?.uid;
            if (uid && stored?.id) {
              void getDoc(doc(db, 'users', uid, 'tasks', stored.id)).then(snapshot => {
                if (!snapshot.exists()) return;
                const data = snapshot.data();
                setVisibleNote(current => current && current.noteId === stored.id ? {
                  ...current,
                  mediaUrls: Array.isArray(data.mediaUrls) ? data.mediaUrls.filter((item): item is string => typeof item === 'string') : current.mediaUrls,
                  comments: readComments(data.workspaceComments),
                } : current);
              }).catch(() => undefined);
            }
          });
        }
        if (card.lastElementChild !== button) card.appendChild(button);
      });
    };

    const schedule = () => {
      if (frame || stopped) return;
      frame = window.requestAnimationFrame(enhanceCards);
    };
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    document.addEventListener('change', schedule);
    window.addEventListener('resize', schedule);
    schedule();
    return () => {
      stopped = true;
      observer.disconnect();
      document.removeEventListener('change', schedule);
      window.removeEventListener('resize', schedule);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    if (!visibleNote) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const keydown = (event: KeyboardEvent) => event.key === 'Escape' && setVisibleNote(null);
    window.addEventListener('keydown', keydown);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', keydown);
    };
  }, [visibleNote]);

  const toggleWorkspaceChecklist = (index: number) => {
    const root = activeContentRootRef.current;
    const input = root?.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[index];
    if (!input) return;
    input.click();
    window.setTimeout(refreshWorkspaceFromCard, 0);
    window.setTimeout(() => {
      const title = visibleNote?.title ?? '';
      const content = visibleNote?.content ?? '';
      const stored = readStoredNote(title, content);
      if (!stored) return;
      setVisibleNote(current => current ? {
        ...current,
        auditLogs: stored.auditLogs ?? current.auditLogs,
      } : current);
    }, 250);
  };

  const addComment = async () => {
    const text = commentText.trim();
    const uid = auth.currentUser?.uid;
    if (!text || !uid || !visibleNote?.noteId || savingComment) return;
    const comment: WorkspaceComment = {
      id: crypto.randomUUID(),
      text,
      author: auth.currentUser?.displayName || auth.currentUser?.email || 'Você',
      createdAt: new Date().toISOString(),
    };
    setSavingComment(true);
    try {
      await updateDoc(doc(db, 'users', uid, 'tasks', visibleNote.noteId), {
        workspaceComments: arrayUnion(comment),
      });
      setVisibleNote(current => current ? { ...current, comments: [...current.comments, comment] } : current);
      setCommentText('');
    } finally {
      setSavingComment(false);
    }
  };

  const addAttachments = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const uid = auth.currentUser?.uid;
    const noteId = visibleNote?.noteId;
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (!uid || !noteId || files.length === 0 || uploading) return;
    const remaining = Math.max(0, MAX_NOTE_ATTACHMENTS - (visibleNote?.mediaUrls.length ?? 0));
    const accepted = files.filter(file => file.size <= MAX_ATTACHMENT_BYTES).slice(0, remaining);
    if (!accepted.length) return;
    setUploading(true);
    try {
      const urls = await Promise.all(accepted.map(fileToDataUrl));
      await updateDoc(doc(db, 'users', uid, 'tasks', noteId), {
        mediaUrls: arrayUnion(...urls),
      });
      setVisibleNote(current => current ? {
        ...current,
        mediaUrls: [...current.mediaUrls, ...urls].slice(0, MAX_NOTE_ATTACHMENTS),
      } : current);
    } finally {
      setUploading(false);
    }
  };

  if (!visibleNote) return null;
  const completed = visibleNote.checklist.filter(item => item.completed).length;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-end justify-center bg-slate-950/85 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="full-note-title"
      onMouseDown={event => event.currentTarget === event.target && setVisibleNote(null)}
    >
      <div className="flex max-h-[96vh] w-full flex-col overflow-hidden rounded-t-3xl border border-slate-800 bg-slate-900 shadow-2xl sm:max-h-[90vh] sm:max-w-2xl sm:rounded-3xl">
        <header className="flex items-start justify-between gap-3 border-b border-slate-800 px-5 py-4">
          <div className="min-w-0">
            <span className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wider text-teal-400"><FileText className="h-3.5 w-3.5" /> Central da nota</span>
            <h2 id="full-note-title" className="mt-1 break-words text-base font-black uppercase text-white">{visibleNote.title}</h2>
          </div>
          <button type="button" onClick={() => setVisibleNote(null)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-950 text-slate-400 hover:text-white" aria-label="Fechar nota completa"><X className="h-4 w-4" /></button>
        </header>

        <div className="overflow-y-auto px-5 py-5">
          <section>
            <p className="whitespace-pre-wrap break-words text-sm leading-7 text-slate-300">{visibleNote.content}</p>
          </section>

          {visibleNote.checklist.length > 0 && (
            <section className="mt-6 border-t border-slate-800 pt-5">
              <div className="mb-3 flex items-center justify-between gap-3">
                <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Checklist</span>
                <span className="text-[10px] font-black uppercase tracking-wide text-teal-400">{completed}/{visibleNote.checklist.length} concluídos</span>
              </div>
              <div className="space-y-2.5">
                {visibleNote.checklist.map((item, index) => (
                  <button key={`${item.label}-${index}`} type="button" onClick={() => toggleWorkspaceChecklist(index)} className="flex w-full items-start gap-2.5 rounded-xl bg-slate-950/55 px-3 py-2.5 text-left hover:bg-slate-950">
                    <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${item.completed ? 'border-teal-400 bg-teal-400/15 text-teal-300' : 'border-slate-600 text-transparent'}`}><Check className="h-3.5 w-3.5" /></span>
                    <span className={`text-sm leading-5 ${item.completed ? 'text-slate-500 line-through' : 'text-slate-200'}`}>{item.label}</span>
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[9px] text-slate-600">Toque em qualquer item para marcar ou desmarcar. A alteração usa a mesma sincronização da nota.</p>
            </section>
          )}

          <section className="mt-6 border-t border-slate-800 pt-5">
            <div className="mb-3 flex items-center justify-between"><span className="flex items-center gap-2 text-[10px] font-black uppercase tracking-wider text-slate-400"><Paperclip className="h-3.5 w-3.5" /> Anexos</span><span className="text-[9px] text-slate-600">{visibleNote.mediaUrls.length}/{MAX_NOTE_ATTACHMENTS}</span></div>
            {visibleNote.mediaUrls.length > 0 ? (
              <div className="grid grid-cols-3 gap-2">
                {visibleNote.mediaUrls.map((url, index) => url.startsWith('data:image') || /\.(png|jpe?g|webp|gif)(\?|$)/i.test(url) ? (
                  <img key={`${url.slice(0, 24)}-${index}`} src={url} alt={`Anexo ${index + 1}`} className="aspect-square w-full rounded-xl object-cover" />
                ) : (
                  <a key={`${url.slice(0, 24)}-${index}`} href={url} target="_blank" rel="noreferrer" className="flex aspect-square items-center justify-center rounded-xl bg-slate-950 text-slate-400"><ImageIcon className="h-5 w-5" /></a>
                ))}
              </div>
            ) : <p className="text-xs text-slate-600">Nenhum anexo nesta nota.</p>}
            <label className="mt-3 flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-slate-700 px-3 py-2.5 text-[10px] font-bold uppercase text-slate-400 hover:border-teal-500/40 hover:text-teal-300"><Paperclip className="h-3.5 w-3.5" /> {uploading ? 'Adicionando...' : 'Adicionar anexos'}<input type="file" multiple accept="image/*,video/*" className="hidden" onChange={addAttachments} disabled={uploading} /></label>
          </section>

          <section className="mt-6 border-t border-slate-800 pt-5">
            <span className="mb-3 flex items-center gap-2 text-[10px] font-black uppercase tracking-wider text-slate-400"><Users className="h-3.5 w-3.5" /> Responsáveis e colaboradores</span>
            {visibleNote.people.length > 0 ? <div className="flex flex-wrap gap-2">{visibleNote.people.map((person, index) => <span key={`${person.name}-${index}`} className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-300">{person.name}</span>)}</div> : <p className="text-xs text-slate-600">Nenhum colaborador vinculado.</p>}
          </section>

          <section className="mt-6 border-t border-slate-800 pt-5">
            <span className="mb-3 flex items-center gap-2 text-[10px] font-black uppercase tracking-wider text-slate-400"><MessageSquare className="h-3.5 w-3.5" /> Comentários</span>
            <div className="space-y-2">{visibleNote.comments.length ? visibleNote.comments.map(comment => <div key={comment.id} className="rounded-xl bg-slate-950/70 px-3 py-2.5"><div className="flex items-center justify-between gap-2"><span className="text-[10px] font-bold text-slate-300">{comment.author}</span><span className="text-[8px] text-slate-600">{comment.createdAt ? new Date(comment.createdAt).toLocaleString('pt-BR') : ''}</span></div><p className="mt-1 text-xs leading-5 text-slate-400">{comment.text}</p></div>) : <p className="text-xs text-slate-600">Ainda não há comentários.</p>}</div>
            <div className="mt-3 flex gap-2"><textarea value={commentText} onChange={event => setCommentText(event.target.value)} rows={2} placeholder="Adicionar comentário..." className="min-w-0 flex-1 resize-none rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white focus:border-teal-500/50 focus:outline-none" /><button type="button" onClick={() => void addComment()} disabled={!commentText.trim() || savingComment || !visibleNote.noteId} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-500 text-slate-950 disabled:opacity-40" aria-label="Enviar comentário"><Send className="h-4 w-4" /></button></div>
          </section>

          <section className="mt-6 border-t border-slate-800 pt-5">
            <span className="mb-3 flex items-center gap-2 text-[10px] font-black uppercase tracking-wider text-slate-400"><History className="h-3.5 w-3.5" /> Histórico</span>
            {visibleNote.auditLogs.length > 0 ? <div className="space-y-2">{visibleNote.auditLogs.slice(0, 8).map((log, index) => <div key={`${log.timestamp}-${index}`} className="rounded-xl border border-slate-800 bg-slate-950/55 px-3 py-2.5"><div className="flex items-center justify-between gap-2"><span className="text-[10px] font-bold text-slate-300">{log.user}</span><span className="text-[8px] text-slate-600">{new Date(log.timestamp).toLocaleString('pt-BR')}</span></div><p className="mt-1 text-[10px] leading-4 text-slate-500">{log.action}</p></div>)}</div> : <p className="text-xs text-slate-600">Nenhuma alteração registrada.</p>}
          </section>
        </div>

        <footer className="border-t border-slate-800 p-4"><button type="button" onClick={() => setVisibleNote(null)} className="w-full rounded-xl bg-slate-800 py-2.5 text-xs font-bold uppercase text-slate-200 hover:bg-slate-700">Voltar às notas</button></footer>
      </div>
    </div>
  );
}
