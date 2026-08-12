import {
  authorityForKyrubActivitySource,
  type KyrubActivityEvent,
  type KyrubActivityEventInput,
  type KyrubActivityMetadataValue,
} from '../../shared/kyrubActivityEvents';

export interface KyrubActivityStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

const MAX_EVENTS = 80;
const MAX_METADATA_KEYS = 12;
const MAX_METADATA_STRING_LENGTH = 120;
const FORBIDDEN_METADATA_KEYS = new Set([
  'content',
  'message',
  'text',
  'prompt',
  'response',
  'email',
  'phone',
  'address',
  'token',
  'secret',
  'password',
  'authorization',
]);

const storageKey = (actorUid: string): string =>
  `kyrub_activity_events_v1_${actorUid.trim()}`;

const createEventId = (): string => {
  try {
    return globalThis.crypto.randomUUID();
  } catch {
    return `kyrub-event-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
};

const cleanIdentifier = (value: string | undefined, max = 120): string | undefined => {
  const normalized = value?.trim().slice(0, max);
  return normalized || undefined;
};

const sanitizeMetadata = (
  metadata: KyrubActivityEventInput['metadata']
): Record<string, KyrubActivityMetadataValue> | undefined => {
  if (!metadata) return undefined;
  const entries = Object.entries(metadata)
    .filter(([key]) => /^[a-z][a-z0-9_]{0,39}$/.test(key))
    .filter(([key]) => !FORBIDDEN_METADATA_KEYS.has(key))
    .slice(0, MAX_METADATA_KEYS)
    .map(([key, value]) => {
      if (typeof value === 'string') {
        return [key, value.trim().slice(0, MAX_METADATA_STRING_LENGTH)] as const;
      }
      if (typeof value === 'number') {
        return [key, Number.isFinite(value) ? value : null] as const;
      }
      return [key, value] as const;
    });
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
};

const parseStoredEvents = (value: string | null): KyrubActivityEvent[] => {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is KyrubActivityEvent =>
      Boolean(
        item &&
          typeof item === 'object' &&
          item.schemaVersion === 1 &&
          typeof item.id === 'string' &&
          typeof item.actorUid === 'string' &&
          typeof item.occurredAt === 'string' &&
          (item.authority === 'context_only' || item.authority === 'confirmed_result')
      )
    );
  } catch {
    return [];
  }
};

export const recordKyrubActivityEvent = (
  storage: KyrubActivityStorage,
  actorUid: string,
  input: KyrubActivityEventInput,
  now = new Date()
): KyrubActivityEvent => {
  const normalizedUid = actorUid.trim();
  if (!normalizedUid) throw new Error('Actor UID is required for activity events.');

  const event: KyrubActivityEvent = {
    schemaVersion: 1,
    id: createEventId(),
    actorUid: normalizedUid,
    type: input.type,
    domain: input.domain,
    source: input.source,
    authority: authorityForKyrubActivitySource(input.source),
    occurredAt: now.toISOString(),
    ...(cleanIdentifier(input.screenId) ? { screenId: cleanIdentifier(input.screenId) } : {}),
    ...(cleanIdentifier(input.actionId) ? { actionId: cleanIdentifier(input.actionId) } : {}),
    ...(cleanIdentifier(input.entityType, 80)
      ? { entityType: cleanIdentifier(input.entityType, 80) }
      : {}),
    ...(cleanIdentifier(input.entityId, 160)
      ? { entityId: cleanIdentifier(input.entityId, 160) }
      : {}),
    ...(sanitizeMetadata(input.metadata)
      ? { metadata: sanitizeMetadata(input.metadata) }
      : {}),
  };

  const key = storageKey(normalizedUid);
  const current = parseStoredEvents(storage.getItem(key));
  storage.setItem(key, JSON.stringify([...current, event].slice(-MAX_EVENTS)));
  return event;
};

export const readRecentKyrubActivityEvents = (
  storage: KyrubActivityStorage,
  actorUid: string,
  limit = 20
): KyrubActivityEvent[] => {
  const normalizedUid = actorUid.trim();
  if (!normalizedUid) return [];
  const safeLimit = Math.max(1, Math.min(MAX_EVENTS, Math.floor(limit)));
  return parseStoredEvents(storage.getItem(storageKey(normalizedUid))).slice(-safeLimit);
};

export const clearKyrubActivityEvents = (
  storage: KyrubActivityStorage,
  actorUid: string
): void => {
  const normalizedUid = actorUid.trim();
  if (!normalizedUid) return;
  const key = storageKey(normalizedUid);
  if (storage.removeItem) {
    storage.removeItem(key);
    return;
  }
  storage.setItem(key, '[]');
};
