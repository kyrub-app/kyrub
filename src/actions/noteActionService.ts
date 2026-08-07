import { doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import type {
  KyrubActionExecutionResult,
  KyrubActionOrigin,
  KyrubAiCreateNoteProposal,
} from '../../shared/kyrubActions';
import { createAuditLog } from '../utils/noteCollaboration';
import { db } from '../utils/firebase';

const MAX_TITLE_CHARACTERS = 120;
const MAX_CONTENT_CHARACTERS = 8_000;
const MAX_CHECKLIST_ITEMS = 20;
const MAX_CHECKLIST_ITEM_CHARACTERS = 180;

const cleanText = (value: string, maximum: number): string =>
  value.replace(/\s+/g, ' ').trim().slice(0, maximum);

const safeActionId = (value: string): string => {
  const normalized = value
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);

  if (normalized) return normalized;

  try {
    return globalThis.crypto.randomUUID();
  } catch {
    return `action-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
};

const ownerNameFor = (user: User): string =>
  user.displayName?.trim() || user.email?.split('@')[0] || 'Usuário do Kyrub';

const resolveOrigin = (
  proposal: KyrubAiCreateNoteProposal
): KyrubActionOrigin => proposal.origin ?? 'kyrubia';

const resolveIdempotencyKey = (
  user: User,
  proposal: KyrubAiCreateNoteProposal,
  actionId: string,
  origin: KyrubActionOrigin
): string =>
  proposal.idempotencyKey?.trim().slice(0, 240) ||
  `${origin}:create_note:${user.uid}:${actionId}`;

export const executeConfirmedCreateNoteAction = async (
  user: User,
  proposal: KyrubAiCreateNoteProposal
): Promise<KyrubActionExecutionResult> => {
  const title = cleanText(proposal.title, MAX_TITLE_CHARACTERS);
  const content = proposal.content.trim().slice(0, MAX_CONTENT_CHARACTERS);

  if (!title || !content) {
    throw new Error('A nota precisa ter título e conteúdo antes da confirmação.');
  }

  const checklist = proposal.checklist
    .map(item => cleanText(item, MAX_CHECKLIST_ITEM_CHARACTERS))
    .filter(Boolean)
    .slice(0, MAX_CHECKLIST_ITEMS);
  const actionId = safeActionId(proposal.id);
  const noteId = `kyrubia-note-${actionId}`;
  const origin = resolveOrigin(proposal);
  const idempotencyKey = resolveIdempotencyKey(
    user,
    proposal,
    actionId,
    origin
  );
  const noteReference = doc(db, 'users', user.uid, 'tasks', noteId);
  const now = new Date().toISOString();
  const ownerName = ownerNameFor(user);

  const status = await runTransaction(db, async transaction => {
    const existing = await transaction.get(noteReference);

    if (existing.exists()) {
      const existingKey = existing.data().actionIdempotencyKey;
      if (existingKey === idempotencyKey) return 'already_applied' as const;
      throw new Error(
        'Já existe uma nota vinculada a esta ação com outro identificador.'
      );
    }

    transaction.set(noteReference, {
      schemaVersion: 1,
      id: noteId,
      ownerId: user.uid,
      ownerName,
      ownerEmail: user.email ?? '',
      ownerAvatar: user.photoURL ?? '',
      title: title.toUpperCase(),
      content,
      associatedUsers: ['Você'],
      checklist: checklist.map((text, index) => ({
        id: `${noteId}-item-${index + 1}`,
        text,
        done: false,
      })),
      auditLogs: [
        createAuditLog(
          ownerName,
          'Criou a nota pela Kyrubia após confirmação',
          user.uid,
          now
        ),
      ],
      shared: false,
      mediaUrls: [],
      reminderDateTime: null,
      isPublishedToFeed: false,
      collaborators: [],
      sharedWith: [],
      acceptedWith: [],
      createdAtIso: now,
      updatedAtIso: now,
      serverUpdatedAt: serverTimestamp(),
      actionOrigin: origin,
      actionType: proposal.type,
      actionId,
      actionIdempotencyKey: idempotencyKey,
      actionConfirmedAtIso: now,
    });

    return 'success' as const;
  });

  return {
    actionId,
    type: proposal.type,
    status,
    entityId: noteId,
    origin,
    idempotencyKey,
  };
};
