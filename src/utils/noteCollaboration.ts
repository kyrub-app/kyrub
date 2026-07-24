import type { Note, NoteAuditLog, NoteCollaborator } from '../types';

const COLLABORATOR_TOKEN_PREFIX = 'kyrub-collaborator:';

const readString = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback;

const readStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];

const normalizeChecklist = (value: unknown): Note['checklist'] =>
  Array.isArray(value)
    ? value.flatMap((item, index) => {
        if (!item || typeof item !== 'object') return [];
        const data = item as Record<string, unknown>;
        const text = readString(data.text).trim();
        if (!text) return [];
        return [
          {
            id: readString(data.id, `item-${index}`),
            text,
            done: data.done === true,
          },
        ];
      })
    : [];

const normalizeAuditLogs = (value: unknown): NoteAuditLog[] =>
  Array.isArray(value)
    ? value.flatMap(item => {
        if (!item || typeof item !== 'object') return [];
        const data = item as Record<string, unknown>;
        const action = readString(data.action).trim();
        if (!action) return [];
        const userId = readString(data.userId).trim();
        return [
          {
            user: readString(data.user, 'Usuário Kyrub'),
            action,
            timestamp: readString(data.timestamp, new Date(0).toISOString()),
            ...(userId ? { userId } : {}),
          },
        ];
      })
    : [];

const normalizeCollaborators = (value: unknown): NoteCollaborator[] =>
  Array.isArray(value)
    ? value.flatMap(item => {
        if (!item || typeof item !== 'object') return [];
        const data = item as Record<string, unknown>;
        const uid = readString(data.uid).trim();
        const name = readString(data.name).trim();
        if (!uid || !name) return [];
        return [
          {
            uid,
            name,
            email: readString(data.email),
            avatar: readString(data.avatar),
          },
        ];
      })
    : [];

export const encodeNoteCollaborator = (
  collaborator: NoteCollaborator
): string =>
  `${COLLABORATOR_TOKEN_PREFIX}${encodeURIComponent(
    JSON.stringify(collaborator)
  )}`;

export const decodeNoteCollaborator = (
  selection: string
): NoteCollaborator => {
  if (!selection.startsWith(COLLABORATOR_TOKEN_PREFIX)) {
    return { uid: '', name: selection };
  }

  try {
    const raw = decodeURIComponent(
      selection.slice(COLLABORATOR_TOKEN_PREFIX.length)
    );
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      uid: readString(parsed.uid),
      name: readString(parsed.name, 'Usuário Kyrub'),
      email: readString(parsed.email),
      avatar: readString(parsed.avatar),
    };
  } catch {
    return { uid: '', name: selection };
  }
};

export const getCollaboratorSelectionName = (selection: string): string =>
  decodeNoteCollaborator(selection).name;

export const normalizeCollaboratorSelections = (
  selections: string[]
): NoteCollaborator[] => {
  const unique = new Map<string, NoteCollaborator>();

  for (const selection of selections) {
    const collaborator = decodeNoteCollaborator(selection);
    const key = collaborator.uid || collaborator.name.toLocaleLowerCase('pt-BR');
    if (!key || unique.has(key)) continue;
    unique.set(key, collaborator);
  }

  return [...unique.values()];
};

export const sanitizeCloudMediaUrls = (mediaUrls: string[] = []): string[] =>
  mediaUrls.filter(url => /^https?:\/\//i.test(url));

export const getNoteUpdatedAt = (note: Note): number => {
  const candidates = [
    note.updatedAt,
    note.auditLogs[0]?.timestamp,
    note.createdAt,
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const timestamp = Date.parse(candidate);
    if (Number.isFinite(timestamp)) return timestamp;
  }

  return 0;
};

export const mergeNoteVersions = (local: Note, remote: Note): Note => {
  const preferred =
    getNoteUpdatedAt(local) > getNoteUpdatedAt(remote) ? local : remote;
  const localDataMedia = (local.mediaUrls ?? []).filter(url =>
    url.startsWith('data:')
  );
  const syncedMedia = new Set([
    ...(preferred.mediaUrls ?? []),
    ...localDataMedia,
  ]);

  return {
    ...preferred,
    mediaUrls: [...syncedMedia],
    syncState:
      preferred.syncState === 'pending' ? 'pending' : remote.syncState ?? 'synced',
  };
};

export const sortNotesByUpdatedAt = (notes: Note[]): Note[] =>
  [...notes].sort((first, second) =>
    getNoteUpdatedAt(second) - getNoteUpdatedAt(first)
  );

export const normalizeCloudNote = (
  id: string,
  rawData: Record<string, unknown>,
  fallbackOwnerId = ''
): Note => {
  const ownerId = readString(rawData.ownerId, fallbackOwnerId);
  const collaborators = normalizeCollaborators(rawData.collaborators);
  const associatedUsers = readStringArray(rawData.associatedUsers);
  const ownerName = readString(rawData.ownerName, 'Usuário Kyrub');

  return {
    id,
    title: readString(rawData.title, 'NOTA').toUpperCase(),
    content: readString(rawData.content),
    associatedUsers:
      associatedUsers.length > 0
        ? associatedUsers
        : [ownerName, ...collaborators.map(item => item.name)],
    checklist: normalizeChecklist(rawData.checklist),
    auditLogs: normalizeAuditLogs(rawData.auditLogs),
    shared: rawData.shared === true,
    mediaUrls: readStringArray(rawData.mediaUrls),
    reminderDateTime:
      typeof rawData.reminderDateTime === 'string'
        ? rawData.reminderDateTime
        : null,
    isPublishedToFeed: rawData.isPublishedToFeed === true,
    ownerId,
    ownerName,
    ownerEmail: readString(rawData.ownerEmail),
    ownerAvatar: readString(rawData.ownerAvatar),
    collaborators,
    sharedWith: readStringArray(rawData.sharedWith),
    acceptedWith: readStringArray(rawData.acceptedWith),
    createdAt: readString(rawData.createdAtIso),
    updatedAt: readString(rawData.updatedAtIso),
    syncState: 'synced',
  };
};

export const createAuditLog = (
  user: string,
  action: string,
  userId = '',
  timestamp = new Date().toISOString()
): NoteAuditLog => ({
  user: user || 'Usuário Kyrub',
  action,
  timestamp,
  ...(userId ? { userId } : {}),
});

export const formatNoteAuditTimestamp = (timestamp: string): string => {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp || 'Data não informada';
  return date.toLocaleString('pt-BR');
};
